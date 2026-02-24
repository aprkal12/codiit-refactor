import {
  CreateOrderItemRepoInput,
  CreateOrderRepoInput,
  CreateOrderServiceInput,
  GetOrdersServiceInput,
  UpdateOrderServiceInput,
} from '@/domains/order/order.dto.js';
import { OrderRepository } from '@/domains/order/order.repository.js';
import type { NotificationService } from '@/domains/notification/notification.service.js';
import { OrderStatus, PaymentStatus, PointHistoryType, PrismaClient } from '@prisma/client';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from '@/common/utils/errors.js';
import { SseManager } from '@/common/utils/sse.manager.js';
import { UserService } from '@/domains/user/user.service.js';
import { buildOrderData } from '@/domains/order/order.utils.js';
import { logger } from '@/config/logger.js';
import { Queue } from 'bullmq';
import { handleQueueError } from '@/common/utils/redisError.util.js';

export class OrderService {
  constructor(
    private orderRepository: OrderRepository,
    private notificationService: NotificationService,
    private prisma: PrismaClient,
    private userService: UserService,
    private sseManager: SseManager,
    private orderQueue: Queue,
  ) {}
  private async validateOwner(userId: string, orderId: string) {
    const owner = await this.orderRepository.findOwnerById(orderId);
    if (!owner) {
      throw new NotFoundError('주문을 찾을 수 없습니다.');
    }
    if (owner.buyerId !== userId) {
      throw new ForbiddenError('접근 권한이 없습니다.');
    }
  }
  private async validateStatus(orderId: string) {
    const orderStatus = await this.orderRepository.findStatusById(orderId);
    if (!orderStatus) {
      throw new InternalServerError('주문 정보를 불러오던 중 오류가 발생했습니다.');
    }
    if (orderStatus.status !== OrderStatus.WaitingPayment) {
      throw new BadRequestError('현재 상태에서는 주문을 변경/취소할 수 없습니다.'); // 메시지는 주문 삭제 api 실제 리스폰스를 참고했습니다.
    }
  }
  async getOrder(userId: string, orderId: string) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new NotFoundError('주문을 찾을 수 없습니다.');
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenError('접근 권한이 없습니다.');
    }
    return order;
  }
  async getOrders({ userId, status, limit, page }: GetOrdersServiceInput) {
    const countInput = {
      buyerId: userId,
      status,
    };
    const findManyInput = {
      ...countInput,
      skip: (page - 1) * limit,
      take: limit,
    };
    const [rawOrders, totalCount] = await this.prisma.$transaction(async (tx) => {
      return await Promise.all([
        this.orderRepository.findMany(findManyInput, tx),
        this.orderRepository.count(countInput, tx),
      ]);
    });
    return { rawOrders, totalCount };
  }
  async createOrder({
    userId,
    name,
    phone,
    address,
    usePoint,
    orderItems,
  }: CreateOrderServiceInput) {
    let orderData = {} as CreateOrderRepoInput;
    let orderItemsData = [] as CreateOrderItemRepoInput[];
    // 사전 체크 (사용할 포인트가 현재 유저가 가지고 있는 총 포인트보다 같거나 작은지)
    // 프론트에서 이미 막히지만 방어적 코드
    const user = await this.orderRepository.findUserInfo(userId);
    if (!user) {
      throw new UnauthorizedError('사용자를 찾을 수 없습니다.');
    }
    if (usePoint > user.point) {
      // 유저가 보유한 포인트보다 사용하려는 포인트가 많은 경우
      throw new BadRequestError('잘못된 요청입니다.');
    }
    // 0. 주문 생성에 필요한 데이터들 추출
    const productIds = orderItems.map((item) => item.productId);
    const products = await this.orderRepository.findManyProducts(productIds);
    const builtData = buildOrderData(products, orderItems);

    const finalPaymentPrice = builtData.subtotal - usePoint; // 결제 금액은 총액 - 포인트 사용액
    if (finalPaymentPrice < 0) {
      throw new BadRequestError('사용 포인트가 상품 총액을 초과할 수 없습니다.');
    }

    // 1. 주문 생성
    const result = await this.prisma.$transaction(async (tx) => {
      // 주문 아이템 기준으로 재고 먼저 확보 (재고 locking)
      for (const item of builtData.matchedOrderItems) {
        const reservedResult = await this.orderRepository.reserveStock(
          {
            productId: item.productId,
            sizeId: item.sizeId,
            quantity: item.quantity,
          },
          tx,
        );
        if (reservedResult === 0) {
          throw new BadRequestError('재고가 부족합니다.');
        }
      }

      // 1-1 . 주문 생성
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분 설정
      orderData = {
        userId,
        name,
        phone,
        address,
        usePoint,
        subtotal: builtData.subtotal,
        totalQuantity: builtData.totalQuantity,
        expiresAt,
      };
      const order = await this.orderRepository.createOrder(orderData, tx);

      // 1-2. 주문 아이템들 생성 및 주문에 연결
      orderItemsData = builtData.matchedOrderItems.map((orderItem) => ({
        ...orderItem,
        orderId: order.id,
      }));
      await this.orderRepository.createOrderItems(orderItemsData, tx);

      return { orderId: order.id, expiresAt };
    });

    const delayMs = Math.max(result.expiresAt.getTime() - Date.now(), 0);

    await this.orderQueue.add(
      'order_expire_queue',
      { orderId: result.orderId.toString() },
      {
        delay: delayMs,
        jobId: `expire-${result.orderId.toString()}`,
        removeOnComplete: true,
      },
    );
    logger.info(`[Redis] 주문 ${result.orderId} 만료 예약 등록 완료`);

    // 2. 주문 생성 결과 조회
    const createdOrder = await this.orderRepository.findById(result.orderId);
    if (!createdOrder) {
      throw new InternalServerError();
    }

    return createdOrder;
  }

  async confirmPayment(paymentId: string) {
    logger.info('[confirmPayment] confirmPayment 진입');
    // 1. 주문 정보 조회
    const payment = await this.orderRepository.findPaymentWithOrder(paymentId);
    if (!payment) {
      return;
    }
    const order = payment.order;
    if (!order) {
      throw new NotFoundError('해당 주문을 찾을 수 없습니다.');
    }
    const { id: orderId, usePoint, buyerId, orderItems } = order;
    const user = await this.orderRepository.findUserInfo(buyerId);
    if (!user) {
      throw new UnauthorizedError('사용자를 찾을 수 없습니다.');
    }
    // 결제 대기 중 다른 주문에서 포인트를 사용했을 가능성 방어
    if (usePoint > user.point) {
      // 유저가 보유한 포인트보다 사용하려는 포인트가 많은 경우
      throw new BadRequestError('잘못된 요청입니다.');
    }

    // 트랜잭션 외부로 전달할 알림용 전송 데이터 배열
    const ssePayloads: { userId: string; content: string }[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      logger.info('[confirmPayment] 트랜잭션 진입');
      // 주문 상태 조회
      const orderStatus = await this.orderRepository.findStatusById(orderId, tx);
      if (!orderStatus) {
        throw new InternalServerError('주문 상태 정보 누락');
      }
      if (orderStatus.status === OrderStatus.CompletedPayment) {
        // 이미 결제 완료된 주문 요청이 올 시 종료
        return null;
      }
      logger.info('[confirmPayment] 중복 진입 방지 통과');
      if (orderStatus.status === OrderStatus.Cancelled) {
        // 결제 대기 상태로 만료되거나 취소된 주문이 올 시 종료
        return null;
      }
      logger.info('[confirmPayment] 취소/만료된 주문 체크');
      const paymentStatus = await this.orderRepository.findPaymentStatusById(paymentId, tx);
      if (!paymentStatus || paymentStatus.status !== PaymentStatus.paid) {
        // 중복 호출 방지
        // 이미 트랜잭션이 시작된 주문 처리의 결제 상태는 paid가 아님
        return null;
      }
      logger.info('[confirmPayment] 결제 상태 확인 완료, 주문 확정 처리 시작');
      // 결제 상태 locking
      await this.orderRepository.updatePaymentStatus(paymentId, PaymentStatus.processing, tx);
      if (usePoint > 0) {
        // 1-3-1. 포인트 차감
        await this.orderRepository.decreasePoint({ userId: buyerId, amount: usePoint }, tx);
        // 1-3-2. 포인트 히스토리 생성
        await this.orderRepository.createPointHistory(
          { userId: buyerId, orderId, amount: usePoint, type: PointHistoryType.USE },
          tx,
        );
      }
      logger.info('[confirmPayment] 포인트 차감 완료');
      const stockUpdatePromises = orderItems.map(async (orderItem) => {
        const stockData = {
          productId: orderItem.productId,
          sizeId: orderItem.size.id,
          quantity: orderItem.quantity,
        };

        const stockUpdateResult = await this.orderRepository.decreaseStock(stockData, tx);
        if (stockUpdateResult === 0) {
          throw new BadRequestError('재고 확정 처리 실패');
        }
        const updatedStock = await this.orderRepository.getStockData(
          {
            productId: stockData.productId,
            sizeId: stockData.sizeId,
          },
          tx,
        );
        if (!updatedStock) {
          throw new InternalServerError('재고 연관 데이터 조회 실패');
        }
        logger.info('[confirmPayment] 재고 감소 완료');
        if (updatedStock.quantity === 0) {
          // 1-5-1. 판매자 알림 생성
          const productName = updatedStock.product.name;
          const sellerId = updatedStock.product.store.userId;
          const sizeName = updatedStock.size.en;

          const sellerNotificationMsg = `${productName}의 ${sizeName} 사이즈가 품절되었습니다.`;

          await this.notificationService.createNotification(
            {
              userId: sellerId,
              content: sellerNotificationMsg,
            },
            tx,
          );

          // ssePayloads 데이터 추가
          ssePayloads.push({ userId: sellerId, content: sellerNotificationMsg });

          // 1-5-2. 장바구니 유저들 알림 생성
          // 특정 사이즈를 장바구니에 담은 유저들만 필터링하여 중복 제거 후 추출
          const cartUserIds = [
            ...new Set(
              updatedStock.product.cartItems
                .filter(
                  (item) => item.sizeId === updatedStock.sizeId && item.cart.buyerId !== buyerId,
                )
                .map((item) => item.cart.buyerId),
            ),
          ];
          const cartUserNotificationMsg = `장바구니에 담은 상품 ${productName}의 ${sizeName} 사이즈가 품절되었습니다.`;

          if (cartUserIds.length > 0) {
            // DB 성능을 위해 createMany로 한 번에 저장
            await this.notificationService.createBulkNotifications(
              cartUserIds.map((uid) => ({
                userId: uid,
                content: cartUserNotificationMsg,
              })),
              tx,
            );

            cartUserIds.forEach((uid) => {
              // ssePayloads 데이터 추가
              ssePayloads.push({ userId: uid, content: cartUserNotificationMsg });
            });
          }
        }

        return updatedStock;
      });
      logger.info('[confirmPayment] 재고 관련 알림 생성 완료');
      await Promise.all(stockUpdatePromises);
      // 장바구니 삭제는 따로 안하는 것 같음
      // 주문 성공 후 프론트쪽에서 /api/cart/{cartId} delete로 주문이 들어간 아이템들만 삭제 요청 보내는 것 확인
      // 유저의 장바구니가 생성되면 삭제하지 않고 주문할 때마다 주문한 아이템들만 삭제하는 방식인 것 같음

      // 1-6 포인트 적립
      // 현재 주문으로 등급이 변동된다고 해도 다음 주문부터 적용
      // 현재 주문에서는 현재 등급으로 적립 포인트 계산
      const userGrade = user.grade;
      if (!userGrade) {
        console.error('포인트 적립 중 유저 등급 조회 실패');
        throw new InternalServerError();
      }
      // 트랜잭션 외부에서 조회됐던 값을 사용하면 정합성 깨질 위험
      const paymentPrice = await this.orderRepository.getPaymentPrice(paymentId, tx);
      if (!paymentPrice) {
        throw new InternalServerError('결제 정보 누락');
      }
      const rawEarnedPoint = Math.floor(paymentPrice.price * userGrade.rate);
      const earnedPoint = rawEarnedPoint < 0 ? 0 : rawEarnedPoint;
      if (earnedPoint > 0) {
        await this.orderRepository.increasePoint({ userId: buyerId, amount: earnedPoint }, tx);
        await this.orderRepository.createPointHistory(
          {
            userId: buyerId,
            orderId: orderId,
            amount: earnedPoint,
            type: PointHistoryType.EARN,
          },
          tx,
        );
      }
      logger.info('[confirmPayment] 포인트 적립 완료');
      // 결제 상태 locking 해제
      await this.orderRepository.updatePaymentStatus(paymentId, PaymentStatus.completed, tx);
      // 주문 상태 최종 변경
      await this.orderRepository.updateStatus(orderId, OrderStatus.CompletedPayment, tx);
      return { orderId: orderId, ssePayloads };
    });
    if (!result) {
      return; // 이미 처리된 결제인경우 트랜잭션에서 에러대신 null 리턴
    }
    logger.info('[confirmPayment] 트랜잭션 성공');

    try {
      await this.orderQueue.remove(`expire-${orderId}`);
      logger.info(`[Redis] 결제 완료로 인한 주문 ${orderId} 만료 예약 작업 삭제 완료`);
    } catch (error) {
      // 큐 삭제 실패가 결제 확정이라는 메인 로직에 영향을 주지 않도록 유틸리티 함수로 위임
      handleQueueError(error, `주문 ${orderId} 만료 예약 작업 삭제 중 에러 발생`);
    }

    // 2. 최종 결과 조회
    const createdOrder = await this.orderRepository.findById(result.orderId);
    if (!createdOrder) {
      throw new InternalServerError();
    }

    // 주문 완료 알림 (구매자)
    const buyerNotificationMsg = `주문이 완료되었습니다. 주문번호: ${orderId}`;

    await this.notificationService.createNotification({
      userId: buyerId,
      content: buyerNotificationMsg,
    });

    // SSE payload 추가
    ssePayloads.push({
      userId: buyerId,
      content: buyerNotificationMsg,
    });
    logger.info('[confirmPayment] 주문 완료 알림 추가');
    // 3. SSE 알림 전송 (트랜잭션 성공 확인 후)
    // 판매자 알림(객체)과 구매자 알림(배열)이 모두 포함된 배열을 순회
    if (result.ssePayloads.length > 0) {
      result.ssePayloads.forEach((payload) => {
        this.sseManager.sendMessage(payload.userId, payload);
      });
    }
    logger.info('[confirmPayment] 알림 발송 완료');
    // 4. 유저 등급 업데이트
    // 포인트 적립은 사용한 포인트를 제외한 실제 결제 가격 기준으로 적립
    // 등급은 총 결제 가격(실제 결제 가격 + 사용한 포인트)을 기준으로 업데이트
    // 기준 통일 논의 필요

    // + 트랜잭션 내부로 추가?
    await this.userService.updateGradeByPurchase(buyerId);
    logger.info('[confirmPayment] 종료');
    return createdOrder;
  }
  async updateOrder({ orderId, userId, name, phone, address }: UpdateOrderServiceInput) {
    await this.validateOwner(userId, orderId);
    await this.validateStatus(orderId);
    await this.orderRepository.updateOrder({ orderId, name, phone, address });
    const updatedOrder = await this.orderRepository.findById(orderId);
    if (!updatedOrder) {
      throw new InternalServerError();
    }
    return updatedOrder;
  }
  async deleteOrder(userId: string, orderId: string) {
    // 일단 실제로 주문 내역 삭제
    // 추후 논리적 삭제로 리팩토링
    // 1. 주문 데이터 조회
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new NotFoundError('주문을 찾을 수 없습니다.');
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenError('접근 권한이 없습니다.');
    }
    const orderStatus = await this.orderRepository.findStatusById(orderId);
    if (!orderStatus) {
      throw new InternalServerError('주문 상태 조회 실패');
    }
    // 결제전 취소일 경우 주문 만료와 동일하게 처리
    if (orderStatus.status === OrderStatus.WaitingPayment) {
      return this.expireWaitingOrder(orderId);
    }
    // 2. 주문 삭제 트랜잭션
    await this.prisma.$transaction(async (tx) => {
      // 2-1. 재고 복구
      const restoreStockPromises = order.orderItems.map(async (item) => {
        const stockData = {
          productId: item.productId,
          sizeId: item.size.id,
          quantity: item.quantity,
        };
        return await this.orderRepository.increaseStock(stockData, tx);
      });
      await Promise.all(restoreStockPromises);
      // 2-2. 결제 정보 삭제 (추후 논리적 삭제로 상태만 변경하면 됨)
      if (!order.payments) {
        // 주문 취소 대상인 주문이 결제 정보가 없는 경우는 비정상적인 상태
        // WaitingPayment 상태로 존재해야함(현재 프로젝트에서는 그냥 CompletedPayment)
        throw new InternalServerError('주문 취소 중 에러가 발생했습니다.');
      }
      const targetPayment = order.payments.find(
        (payment) => payment.status === PaymentStatus.completed,
      );

      if (!targetPayment) {
        throw new BadRequestError('취소 가능한 결제 내역이 없습니다.');
      }
      // await this.orderRepository.updatePaymentStatus(targetPayment.id, PaymentStatus.cancelled, tx);
      await this.orderRepository.deletePayment(targetPayment.id, tx);

      const userInfo = await this.orderRepository.findUserInfo(userId, tx);
      if (!userInfo) {
        throw new InternalServerError('유저 정보를 찾을 수 없습니다.');
      }
      // 2-3. 사용한 포인트가 있다면 포인트 환불
      if (order.usePoint > 0) {
        const usePoint = order.usePoint;
        // 2-3-1. 포인트 환불
        await this.orderRepository.increasePoint({ userId, amount: usePoint }, tx);
        // 2-3-2. 포인트 히스토리 생성
        await this.orderRepository.createPointHistory(
          { userId, orderId: order.id, amount: usePoint, type: PointHistoryType.REFUND },
          tx,
        );
      }
      // 2-4 적립된 포인트 회수
      const earnedHistory = await this.orderRepository.findPointHistory(
        { orderId: order.id, userId, type: PointHistoryType.EARN },
        tx,
      );
      if (earnedHistory) {
        const earnedAmount = earnedHistory.amount;
        if (userInfo.point < earnedAmount) {
          throw new BadRequestError(
            '보유 포인트가 적립됐던 포인트보다 적어 주문 취소를 진행할 수 없습니다.',
          );
        }
        // 2-4-1. 포인트 차감 (회수)
        await this.orderRepository.decreasePoint({ userId, amount: earnedAmount }, tx);
        // 2-4-2. 적립 취소 히스토리 생성
        await this.orderRepository.createPointHistory(
          {
            userId,
            orderId: order.id,
            amount: earnedAmount,
            type: PointHistoryType.EARN_CANCEL,
          },
          tx,
        );
      }
      // 2-5. 최종 주문 삭제 (추후 논리적 삭제로 상태만 변경하면 됨)
      // await this.orderRepository.updateStatus(order.id, OrderStatus.Cancelled, tx);
      await this.orderRepository.deleteOrder(order.id, tx);
    });
    try {
      await this.orderQueue.remove(`expire-${orderId}`);
      logger.info(`[Redis] 주문 취소로 인한 주문 ${orderId} 만료 예약 작업 삭제 완료`);
    } catch (error) {
      handleQueueError(error, `주문 ${orderId} 만료 예약 작업 삭제 중 에러 발생`);
    }
    // 주문 취소 시 등급 변동 여부 계산
    // 주문을 취소해서 누적 주문 금액이 다시 미달되면 등급이 하락?
    // 한번 승급한 등급은 일정 기간 동안 그대로 유지시키기?
    await this.userService.updateGradeByPurchase(userId);
  }
  async expireWaitingOrder(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      const expiredOrderInfo = await this.orderRepository.getExpiredOrderInfo(orderId, tx);
      if (!expiredOrderInfo) {
        // 요청 하는 사이에 결제되거나 취소된 경우
        return;
      }
      // 1. 재고 복구
      for (const item of expiredOrderInfo.orderItems) {
        await this.orderRepository.restoreReservedStock(
          {
            productId: item.productId,
            sizeId: item.sizeId,
            quantity: item.quantity,
          },
          tx,
        );
      }

      // 2. 주문 상태 만료 처리
      await this.orderRepository.updateStatus(orderId, OrderStatus.Cancelled, tx);
    });
    try {
      await this.orderQueue.remove(`expire-${orderId}`);
      logger.info(`[Redis] 주문 취소/만료로 인한 주문 ${orderId} 만료 예약 작업 삭제 완료`);
    } catch (error) {
      handleQueueError(error, `주문 ${orderId} 만료 예약 작업 삭제 중 에러 발생`);
    }
  }

  async cancelAllWaitingPaymentOrders() {
    const waitingOrders = await this.orderRepository.findWaitingPaymentOrders();
    if (waitingOrders.length === 0) {
      return { message: 'No waiting payment orders to cancel.' };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const order of waitingOrders) {
        // 1. Restore stock
        for (const item of order.orderItems) {
          await this.orderRepository.restoreReservedStock(
            {
              productId: item.productId,
              sizeId: item.sizeId,
              quantity: item.quantity,
            },
            tx,
          );
        }

        // 2. Update order status to Cancelled
        await this.orderRepository.updateStatus(order.id, OrderStatus.Cancelled, tx);
      }
    });

    return { message: `${waitingOrders.length} orders have been cancelled.` };
  }
}
