import { OrderStatus, PointHistoryType, Prisma } from '@prisma/client';
import { prisma } from '@/config/prisma.js';
import { generateBuyerToken, generateSellerToken } from '../helpers/authHelper.js';
import {
  createTestBuyer,
  createTestCategory,
  createTestContext,
  createTestOrder,
  createTestProduct,
  createTestStore,
  TestContext,
} from '../helpers/dataFactory.js';
import { authRequest, testClient } from '../helpers/testClient.js';
import {
  baseOrderInputMock,
  createOrderItemInputMock,
  createOrderItemMock,
  createOrderServiceInputMock,
  createPaymentMock,
} from '../mocks/order.mock.js';
import { CreateOrderServiceInput } from '@/domains/order/order.dto.js';
import { StockRawData } from '@/domains/order/order.type.js';
import { UpdateOrderBody } from '@/domains/order/order.schema.js';

// 주문 통합 테스트 구현
describe('Order API Integration Test', () => {
  let ctx: TestContext;
  let buyerToken: string;
  let sellerToken: string;
  let otherToken: string;

  let buyerId: string;
  let sellerId: string;
  let otherId: string;
  let storeId: string;
  let categoryId: string;
  let productId: string;
  let sizeId: number;
  let initialPoint: number;

  beforeEach(async () => {
    ctx = await createTestContext();
    const otherBuyer = await createTestBuyer(ctx.grade.id);
    buyerId = ctx.buyer.id;
    sellerId = ctx.seller.id;
    otherId = otherBuyer.id;
    buyerToken = generateBuyerToken(buyerId);
    sellerToken = generateSellerToken(sellerId);
    otherToken = generateBuyerToken(otherId);

    const store = await createTestStore(sellerId);
    const category = await createTestCategory();
    storeId = store.id;
    categoryId = category.id;

    const product = await createTestProduct({ storeId, categoryId });
    productId = product.id;
    sizeId = 1;
    await prisma.product.update({
      where: { id: productId },
      data: {
        stocks: {
          create: { sizeId, quantity: 100 },
        },
      },
    });
    // 보유 포인트 설정
    initialPoint = 10000;
    await prisma.user.update({
      where: {
        id: buyerId,
      },
      data: {
        point: initialPoint,
      },
    });
  });

  describe('GET /api/orders', () => {
    it('200: 주문 상태로 필터링', async () => {
      // given
      await createTestOrder({
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });
      // 주문 2개를 만들어서 하나만 상태 변경
      await createTestOrder({
        status: OrderStatus.CompletedPayment,
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });

      // when
      const res = await authRequest(buyerToken).get(
        `/api/orders?status=${OrderStatus.CompletedPayment}`,
      );

      // then
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
    it('200: 페이지네이션 적용', async () => {
      // given
      // 주문 5개 생성
      const requests = Array.from({ length: 5 }).map(async () => {
        return await createTestOrder({
          buyerId,
          orderItems: [createOrderItemMock({ productId })],
          payments: [createPaymentMock()],
        });
      });

      await Promise.all(requests);

      // when
      const res = await authRequest(buyerToken).get(
        `/api/orders?status=${OrderStatus.WaitingPayment}&limit=2&page=1`,
      );

      // then
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(5);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(2);
      expect(res.body.meta.totalPages).toBe(3);
    });
    it('401: 인증되지 않은 사용자는 주문 목록을 조회 할 수 없다.', async () => {
      // when
      const res = await testClient.get('/api/orders');
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 주문 목록을 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).get('/api/orders');
      // then
      expect(res.status).toBe(403);
    });
  });
  describe('POST /api/orders', () => {
    let beforeStock: StockRawData;
    let requestBody: CreateOrderServiceInput;
    let usePoint: number;
    beforeEach(async () => {
      const product = await prisma.product.findUnique({
        where: {
          id: productId,
        },
        select: {
          name: true,
          stocks: {
            where: {
              sizeId: sizeId,
            },
          },
        },
      });
      if (!product) {
        throw new Error('테스트 상품 또는 재고 초기화 실패');
      }
      beforeStock = product.stocks[0];
      usePoint = 1000;
      requestBody = createOrderServiceInputMock({
        name: ctx.buyer.name,
        usePoint: usePoint,
        orderItems: [
          createOrderItemInputMock({
            productId,
          }),
        ],
      });
    });
    it('201: 구매자가 상품을 주문한다.', async () => {
      // when
      const res = await authRequest(buyerToken).post('/api/orders').send(requestBody);

      // then
      // 1. 응답 검증
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(requestBody.name);

      // 2. 주문 결과 db 검증
      const savedOrder = await prisma.order.findUnique({
        where: { id: res.body.id },
        include: { orderItems: true },
      });
      if (!savedOrder) {
        throw new Error('테스트 주문 생성 실패');
      }
      expect(savedOrder).not.toBeNull();
      expect(savedOrder.status).toBe(OrderStatus.WaitingPayment);
      expect(savedOrder.buyerId).toBe(buyerId);
      expect(savedOrder.orderItems).toHaveLength(1);
      expect(savedOrder.orderItems[0].productId).toBe(productId);

      // 3. 트랜잭션 (재고 예약) 검증
      const afterStock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!afterStock) {
        throw new Error('테스트 상품 조회 실패');
      }
      // 주문 생성 시점에는 재고가 변경되지 않고 예약 수량만 증가
      expect(afterStock.quantity).toBe(beforeStock.quantity);
      expect(afterStock.reservedQuantity).toBe(
        beforeStock.reservedQuantity + requestBody.orderItems[0].quantity,
      );

      // 4. 트랜잭션 (포인트) 검증
      // 주문 생성 시점에는 포인트가 변경되지 않음
      const afterBuyer = await prisma.user.findUnique({
        where: {
          id: buyerId,
        },
        select: {
          point: true,
        },
      });
      if (!afterBuyer) {
        throw new Error('테스트 유저 조회 실패');
      }
      expect(afterBuyer.point).toBe(initialPoint);
    });
    it('201: 상품 주문 시 알림은 결제 완료 시점에 발송된다.', async () => {
      // given
      // 품절 알림 테스트를 위해 재고 수량 변경
      await prisma.stock.update({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
        data: {
          quantity: 1,
        },
      });

      // 장바구니에 아이템을 담아놓은 other buyer 세팅
      await prisma.cartItem.create({
        data: {
          cart: {
            connectOrCreate: {
              where: {
                buyerId: otherId,
              },
              create: {
                buyerId: otherId,
              },
            },
          },
          product: { connect: { id: productId } },
          size: {
            connect: { id: sizeId },
          },
          quantity: 1,
        },
      });

      // when
      const res = await authRequest(buyerToken).post('/api/orders').send(requestBody);

      // then
      // 1. 응답 검증
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(requestBody.name);

      // 2. 주문 결과 db 검증
      const savedOrder = await prisma.order.findUnique({
        where: { id: res.body.id },
        include: { orderItems: true },
      });
      if (!savedOrder) {
        throw new Error('테스트 주문 조회 실패');
      }
      expect(savedOrder).not.toBeNull();
      expect(savedOrder.status).toBe(OrderStatus.WaitingPayment);

      // 3. 트랜잭션 (재고 예약) 검증
      const afterStock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!afterStock) {
        throw new Error('테스트 재고 조회 실패');
      }
      expect(afterStock.quantity).toBe(1);
      expect(afterStock.reservedQuantity).toBe(1);

      // 4. 알림 미발송 검증
      // 주문 생성 시점에는 알림이 발송되지 않음
      const sellerNotification = await prisma.notification.findFirst({
        where: {
          userId: sellerId,
        },
      });
      const cartUserNotification = await prisma.notification.findFirst({
        where: {
          userId: otherId,
        },
      });
      expect(sellerNotification).toBeNull();
      expect(cartUserNotification).toBeNull();
    });
    it('401: 인증되지 않은 사용자는 주문 할 수 없다.', async () => {
      // when
      const res = await testClient.post('/api/orders').send({});
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 주문 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).post('/api/orders').send({});
      // then
      expect(res.status).toBe(403);
    });
    it('동시성 테스트: 재고가 5개일 때 10명이 동시에 주문하면 5명만 성공해야 한다.', async () => {
      // 단일 프로세스 환경에서의 동시성 회귀 방지 테스트
      // node는 애초에 단일 프로세스라 멀티 프로세스 환경에서의 동시성 문제를 완전 커버하지는 않음
      // given
      // 재고 5개로 설정
      await prisma.stock.update({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
        data: { quantity: 5 },
      });

      // 10개의 주문 요청을 동시에 생성
      const requests = Array.from({ length: 10 }).map(() =>
        authRequest(buyerToken)
          .post('/api/orders')
          .send(
            createOrderServiceInputMock({
              name: ctx.buyer.name,
              usePoint: 0, // 동시성 테스트에서는 포인트 사용 제외
              orderItems: [
                createOrderItemInputMock({
                  productId,
                  quantity: 1,
                }),
              ],
            }),
          ),
      );

      // when
      // 동시 실행
      const responses = await Promise.all(requests);

      // then
      // 1. 결과 검증
      const successCount = responses.filter((res) => res.status === 201).length;
      const failCount = responses.filter((res) => res.status !== 201).length;

      // 성공은 딱 재고만큼(5명)이어야 함
      expect(successCount).toBe(5);
      expect(failCount).toBe(5);

      // 2. DB 재고 검증 (quantity는 그대로, reservedQuantity는 5)
      const finalStock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!finalStock) {
        throw new Error('테스트 재고 조회 실패');
      }
      expect(finalStock.quantity).toBe(5);
      expect(finalStock.reservedQuantity).toBe(5);
    });
    it('트랜잭션 롤백 테스트: 주문 생성 중 재고 예약에서 에러가 발생하면 생성된 주문도 롤백 된다.', async () => {
      // given
      const requestBody = createOrderServiceInputMock({
        name: ctx.buyer.name,
        orderItems: [
          createOrderItemInputMock({
            productId,
            quantity: 999, // 재고가 100개인데 999개 주문해서 에러 유도
          }),
        ],
      });

      // when
      const res = await authRequest(buyerToken).post('/api/orders').send(requestBody);

      // then
      // 1. 응답 검증
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('재고가 부족합니다.');

      // 2. 롤백 검증
      const rollbackedOrder = await prisma.order.findFirst({
        where: { buyerId },
        orderBy: { createdAt: 'desc' },
      });

      expect(rollbackedOrder).toBeNull(); // 데이터가 없어야 롤백 성공
    });
  });
  describe('GET /api/orders/:orderId', () => {
    let savedOrderId: string;
    beforeEach(async () => {
      const savedOrder = await createTestOrder({
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });
      savedOrderId = savedOrder.id;
    });
    it('200: 주문 상세 정보를 조회한다.', async () => {
      // when
      const res = await authRequest(buyerToken).get(`/api/orders/${savedOrderId}`);

      // then
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(savedOrderId);
      expect(res.body.subtotal).toBe(10000); // 기본값
      expect(res.body.orderItems).toBeDefined();
      expect(res.body.orderItems[0].isReviewed).toBeFalsy(); // 매퍼 검증
      expect(res.body.orderItems[0].product).toBeDefined();
      expect(res.body.orderItems[0].size).toBeDefined();
      expect(res.body.payments).toBeDefined();
    });
    it('401: 인증되지 않은 사용자는 주문을 조회 할 수 없다.', async () => {
      // when
      const res = await testClient.get(`/api/orders/test`); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 주문을 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).get(`/api/orders/test`); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(403);
    });
    it('403: 본인 주문이 아니면 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(otherToken).get(`/api/orders/${savedOrderId}`);
      // then
      expect(res.status).toBe(403);
    });
    it('404: 잘못된 id로 조회하면 실패한다.', async () => {
      // when
      const res = await authRequest(buyerToken).get(`/api/orders/${savedOrderId}error`); // cuid형식은 맞지만 db에 없는 id 설정
      // then
      expect(res.status).toBe(404);
    });
  });
  describe('PATCH /api/orders/:orderId', () => {
    let savedOrderId: string;
    let patchData: UpdateOrderBody;
    beforeEach(async () => {
      const savedOrder = await createTestOrder({
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });
      const { usePoint: _usePoint, ...rest } = baseOrderInputMock;
      savedOrderId = savedOrder.id;
      patchData = rest;
    });
    it('200: 주문자 정보 수정', async () => {
      // given
      const savedOrder = await createTestOrder({
        name: '수정 전 이름',
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });

      // when
      const res = await authRequest(buyerToken)
        .patch(`/api/orders/${savedOrder.id}`)
        .send(patchData);

      // then
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('테스트 주문');
    });
    it('400: 결제가 완료된 주문은 수정할 수 없다.', async () => {
      // 실제 쇼핑몰의 케이스를 생각해볼 때 배송이 시작됐을 때(배송 업체로 정보가 넘어간 후) 주문 정보 수정이 불가능한게 적절한 것 같음
      // 현재 구현 코드에서는 결제 완료 상태에서 주문 정보 수정이 불가능하게 처리
      // given
      const savedOrder = await createTestOrder({
        status: OrderStatus.CompletedPayment,
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });

      // when
      const res = await authRequest(buyerToken)
        .patch(`/api/orders/${savedOrder.id}`)
        .send(patchData);

      expect(res.status).toBe(400);
    });
    it('401: 인증되지 않은 사용자는 주문을 수정 할 수 없다.', async () => {
      // when
      const res = await testClient.patch(`/api/orders/test`).send({}); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 주문을 수정 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).patch(`/api/orders/test`).send({}); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(403);
    });
    it('403: 본인의 주문이 아니면 수정 할 수 없다.', async () => {
      // when
      const res = await authRequest(otherToken)
        .patch(`/api/orders/${savedOrderId}`)
        .send(patchData);

      // then
      expect(res.status).toBe(403);
    });
    it('404: 잘못된 id로 수정하면 실패한다.', async () => {
      // when
      const res = await authRequest(buyerToken)
        .patch(`/api/orders/${savedOrderId}error`)
        .send(patchData);

      // then
      expect(res.status).toBe(404);
    });
  });
  describe('DELETE /api/orders/:orderId', () => {
    let savedOrder: Prisma.OrderGetPayload<{ include: { payments: true } }>;
    let beforeStock: StockRawData;
    beforeEach(async () => {
      // deleteOrder 서비스 로직이 CompletedPayment 상태의 주문을 처리하므로 상태를 명시
      const order = await createTestOrder({
        status: OrderStatus.CompletedPayment,
        buyerId,
        orderItems: [createOrderItemMock({ productId, quantity: 1 })],
        payments: [createPaymentMock()],
      });

      // 테스트 데이터의 결제 상태를 수동으로 변경
      await prisma.payment.update({
        where: { id: order.payments[0].id },
        data: { status: 'completed' },
      });

      // confirmPayment가 실행되었다고 가정하고 재고 상태를 수동으로 변경
      await prisma.stock.update({
        where: { productId_sizeId: { productId, sizeId } },
        data: {
          quantity: { decrement: 1 },
        },
      });

      const stock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!stock) {
        throw new Error('테스트 재고 조회 실패');
      }
      savedOrder = order;
      beforeStock = stock;
    });
    it('200: 주문 취소시 사용한 포인트 환불', async () => {
      // 200 상태 코드는 codeit 제공 swagger 그대로 사용
      // given
      const usePoint = 1000;
      let orderToCancel = await createTestOrder({
        status: OrderStatus.CompletedPayment,
        usePoint,
        buyerId,
        orderItems: [createOrderItemMock({ productId })],
        payments: [createPaymentMock()],
      });
      // 테스트 데이터의 결제 상태를 수동으로 변경
      await prisma.payment.update({
        where: { id: orderToCancel.payments[0].id },
        data: { status: 'completed' },
      });

      // 포인트 사용, 히스토리 생성 (사용 취소 테스트용)
      await prisma.user.update({
        where: {
          id: buyerId,
        },
        data: {
          point: {
            decrement: usePoint, // 포인트 사용
          },
        },
      });
      await prisma.pointHistory.create({
        data: {
          userId: buyerId,
          orderId: orderToCancel.id,
          amount: usePoint,
          type: PointHistoryType.USE,
        },
      });

      // when
      const res = await authRequest(buyerToken).delete(`/api/orders/${orderToCancel.id}`);

      // then
      expect(res.status).toBe(200);

      // 재고 복구 확인
      const stock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!stock) {
        throw new Error('테스트 재고 조회 실패');
      }
      // 재고는 초기값으로 돌아와야하고
      // reservedQuantity가 0이 되어야함
      expect(stock.quantity).toBe(100);
      expect(stock.reservedQuantity).toBe(0);

      // 포인트 환불 확인
      const user = await prisma.user.findUnique({
        where: { id: buyerId },
      });
      if (!user) {
        throw new Error('테스트 유저 조회 실패');
      }
      // 초기 포인트 - 사용 포인트 + 환불 포인트 = 초기 포인트
      expect(user.point).toBe(initialPoint);

      // 포인트 히스토리 확인 (사용했던 포인트 반환)
      // 주문이 물리적으로 삭제되므로 orderId로 검색 불가, userId와 type으로 최신 내역을 조회
      const refundHistory = await prisma.pointHistory.findFirst({
        where: {
          userId: buyerId,
          type: PointHistoryType.REFUND,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(refundHistory).not.toBeNull();
      expect(refundHistory?.amount).toBe(usePoint);

      // 주문이 삭제됐는지 확인
      const deletedOrder = await prisma.order.findUnique({
        where: { id: orderToCancel.id },
      });
      expect(deletedOrder).toBeNull();
    });
    it('200: 구매 확정 이후 취소시 적립 포인트 회수된다.', async () => {
      // given
      const earnPoint = 100;

      await prisma.user.update({
        where: {
          id: buyerId,
        },
        data: {
          point: {
            increment: earnPoint, // 포인트 적립
          },
        },
      });
      await prisma.pointHistory.create({
        data: {
          userId: buyerId,
          orderId: savedOrder.id,
          amount: earnPoint,
          type: PointHistoryType.EARN,
        },
      });

      // when
      const res = await authRequest(buyerToken).delete(`/api/orders/${savedOrder.id}`);

      // then
      expect(res.status).toBe(200);

      // 재고 복구 확인
      const stock = await prisma.stock.findUnique({
        where: {
          productId_sizeId: {
            productId,
            sizeId,
          },
        },
      });
      if (!stock) {
        throw new Error('테스트 재고 조회 실패');
      }
      expect(stock.quantity).toBe(beforeStock.quantity + 1);
      expect(stock.reservedQuantity).toBe(beforeStock.reservedQuantity);

      // 포인트 회수 확인
      const user = await prisma.user.findUnique({
        where: { id: buyerId },
      });
      if (!user) {
        throw new Error('테스트 유저 조회 실패');
      }
      // 초기 포인트 + 적립 포인트 - 회수 포인트 = 초기 포인트
      expect(user.point).toBe(initialPoint);

      // 포인트 히스토리 확인 (적립됐던 포인트 회수)
      // 주문이 물리적으로 삭제되므로 orderId로 검색 불가, userId와 type으로 최신 내역을 조회
      const earnCancelHistory = await prisma.pointHistory.findFirst({
        where: {
          userId: buyerId,
          type: PointHistoryType.EARN_CANCEL,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(earnCancelHistory).not.toBeNull();
      expect(earnCancelHistory?.amount).toBe(earnPoint);

      // 주문이 삭제됐는지 확인
      const deletedOrder = await prisma.order.findUnique({
        where: { id: savedOrder.id },
      });
      expect(deletedOrder).toBeNull();
    });
    it('404: 이미 취소된 주문을 다시 취소하려고 하면 실패한다.', async () => {
      // 1차 취소
      await authRequest(buyerToken).delete(`/api/orders/${savedOrder.id}`);

      // when
      // 2차 취소 시도
      const res = await authRequest(buyerToken).delete(`/api/orders/${savedOrder.id}`);

      // then
      expect(res.status).toBe(404);
    });
    it('401: 인증되지 않은 사용자는 주문을 취소 할 수 없다.', async () => {
      // when
      const res = await testClient.delete(`/api/orders/test`); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 주문을 취소 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).delete(`/api/orders/test`); // zod 스키마 도달 전에 에러 발생하므로 cuid가 아니어도 됨
      // then
      expect(res.status).toBe(403);
    });
    it('403: 본인의 주문이 아니면 취소 할 수 없다.', async () => {
      // when
      const res = await authRequest(otherToken).delete(`/api/orders/${savedOrder.id}`);

      // then
      expect(res.status).toBe(403);
    });
    it('404: 잘못된 id로 취소하면 실패한다.', async () => {
      // when
      const res = await authRequest(buyerToken).delete(`/api/orders/${savedOrder.id}error`);

      // then
      expect(res.status).toBe(404);
    });
  });
});
