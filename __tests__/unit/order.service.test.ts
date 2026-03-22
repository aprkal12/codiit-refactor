import { beforeEach, describe, it, jest } from '@jest/globals';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { OrderStatus, PointHistoryType, Prisma, PrismaClient } from '@prisma/client';
import { OrderRepository } from '@/domains/order/order.repository.js';
import { OrderService } from '@/domains/order/order.service.js';
import {
  createExpiredOrderRawDataMock,
  createGetOrderMock,
  createGetPointHistoryMock,
  createGetProductsInfoMock,
  createGetUserInfoMock,
  createOrderFromPaymentMock,
  createOrderItemMock,
  createOrderServiceInputMock,
  createPaymentMock,
  createPointHistoryInputMock,
  createPointInputMock,
  createScenarioItem,
  getOrdersServiceInputMock,
  updateOrderServiceInputMock,
} from '../mocks/order.mock.js';
import { NotificationService } from '@/domains/notification/notification.service.js';
import { TxMock } from '../helpers/test.type.js';
import { UserService } from '@/domains/user/user.service.js';
import {
  expectBaseOrderCreated,
  expectBuyerNotificationSend,
  expectCreateBuyerNotification,
  expectCreateSellerNotification,
  expectFinalPrice,
  expectPointEarn,
  expectPointHistory,
  expectPointUsed,
  expectSellerNotificationSend,
  setupDeleteOrderScenario,
  expectBaseOrderDeleted,
  setUpDeleteOrderMockRepos,
  setupOnlyCreateOrderScenario,
  setUpCreateOnlyOrderMockRepos,
  setupOrderTxScenario,
  setUpOrderTxMockRepos,
  expectBaseOrderTx,
} from '../mocks/order.helper.js';
import { SseManager } from '@/common/utils/sse.manager.js';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '@/common/utils/errors.js';
import { createSizeMock } from '../mocks/cart.mock.js';
import { Queue } from 'bullmq';

describe('OrderService', () => {
  const buyerId = 'buyer-id-1';
  const userId = 'buyer-id-1';
  const otherId = 'other-id-1';
  const orderId = 'order-id-1';
  let mockOrderRepo: DeepMockProxy<OrderRepository>;
  let mockPrisma: DeepMockProxy<PrismaClient>;
  let mockNotificationService: DeepMockProxy<NotificationService>;
  let mockUserService: DeepMockProxy<UserService>;
  let mockOrderService: OrderService;
  let mockSseManager: DeepMockProxy<SseManager>;
  let mockQueue: DeepMockProxy<Queue>;

  beforeEach(() => {
    jest.resetAllMocks();

    mockOrderRepo = mockDeep<OrderRepository>();
    mockPrisma = mockDeep<PrismaClient>();
    mockNotificationService = mockDeep<NotificationService>();
    mockUserService = mockDeep<UserService>();
    mockSseManager = mockDeep<SseManager>();
    mockQueue = mockDeep<Queue>();

    mockOrderService = new OrderService(
      mockOrderRepo,
      mockNotificationService,
      mockPrisma,
      mockUserService,
      mockSseManager,
      mockQueue,
    );

    (mockPrisma.$transaction as jest.MockedFunction<TxMock>).mockImplementation(async (cb) =>
      cb(mockPrisma as Prisma.TransactionClient),
    );
  });
  describe('주문 조회', () => {
    it('주문 조회 성공', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        buyerId: userId,
        payments: [createPaymentMock()],
      });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);

      // when
      const result = await mockOrderService.getOrder(userId, orderId);

      // then
      expect(result).toEqual(getOrderOutput);
      expect(mockOrderRepo.findById).toHaveBeenCalledWith(orderId);
    });
    it('주문 조회 실패 (주문 조회 결과가 없는 경우 NotFoundError 발생)', async () => {
      // given
      mockOrderRepo.findById.mockResolvedValue(null);

      // when
      // then
      await expect(mockOrderService.getOrder(userId, orderId)).rejects.toThrow(NotFoundError);
    });
    it('주문 조회 실패 (본인 주문이 아닌 경우 ForbiddenError 발생)', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        buyerId: otherId,
        payments: [createPaymentMock()],
      });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);

      // when
      // then
      await expect(mockOrderService.getOrder(userId, orderId)).rejects.toThrow(ForbiddenError);
    });
  });
  describe('주문 목록 조회', () => {
    it('주문 목록 조회 성공', async () => {
      // given
      const input = getOrdersServiceInputMock();
      const countInput = {
        buyerId: input.userId,
        status: input.status,
      };
      const findManyInput = {
        ...countInput,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      };
      const getOrderOutput = createGetOrderMock({ payments: [createPaymentMock()] });
      const getOrdersOutput = [getOrderOutput];

      mockOrderRepo.findMany.mockResolvedValue(getOrdersOutput);
      mockOrderRepo.count.mockResolvedValue(1);

      // when
      const result = await mockOrderService.getOrders(input);

      // then
      expect(result).toEqual({ rawOrders: getOrdersOutput, totalCount: 1 });
      expect(mockOrderRepo.findMany).toHaveBeenCalledWith(findManyInput, mockPrisma);
      expect(mockOrderRepo.count).toHaveBeenCalledWith(countInput, mockPrisma);
    });
  });
  // 목 데이터들을 각 테스트 마다 너무 많이 만들어줘야하는 상황
  // object mother 패턴 적용 (학습 필요)
  describe('주문 생성 (주문, 주문 아이템만 생성)', () => {
    it('주문 성공 (할인 x)', async () => {
      // given
      const scenario = setupOnlyCreateOrderScenario({
        orderItems: [
          createScenarioItem({
            stockQuantity: 10,
            itemPrice: 10000,
          }),
          createScenarioItem({
            stockQuantity: 10,
            itemPrice: 10000,
          }),
        ],
      });
      const { input, mocks, verify } = scenario;

      // mock Repo
      setUpCreateOnlyOrderMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.createOrder(input);

      // then
      // 기본 주문 완료 검증
      expectBaseOrderCreated({
        result,
        mockOrderRepo,
        mockPrisma,
        scenario,
      });
      // 상품 최종 가격 검증
      expect(verify.finalPrice).toBe(20000);
    });
    it('주문 성공 (할인(기간 할인) O)', async () => {
      // given
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const scenario = setupOnlyCreateOrderScenario({
        orderItems: [
          createScenarioItem({
            stockQuantity: 10,
            itemPrice: 10000,
          }),
          createScenarioItem({
            productId: 'product-id-2',
            sizeId: 2,
            quantity: 2,
            stockQuantity: 10,
            itemPrice: 10000,
            discountRate: 10, // 10% 할인
            discountStartTime: yesterday,
            discountEndTime: tomorrow,
          }),
        ],
      });
      const { input, mocks, verify } = scenario;

      // mock Repo
      setUpCreateOnlyOrderMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.createOrder(input);

      // then
      // 기본 주문 완료 검증
      expectBaseOrderCreated({
        result,
        mockOrderRepo,
        mockPrisma,
        scenario,
      });
      // 상품 최종 가격 검증
      expect(verify.finalPrice).toBe(28000);
    });
    it('주문 성공 (할인(상시 할인) O)', async () => {
      // given
      const scenario = setupOnlyCreateOrderScenario({
        orderItems: [
          createScenarioItem({
            stockQuantity: 10,
            itemPrice: 10000,
          }),
          createScenarioItem({
            productId: 'product-id-2',
            sizeId: 2,
            quantity: 2,
            stockQuantity: 10,
            itemPrice: 10000,
            discountRate: 10,
          }),
        ],
      });
      const { input, mocks, verify } = scenario;

      // mock Repo
      setUpCreateOnlyOrderMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.createOrder(input);

      // then
      // 기본 주문 완료 검증
      expectBaseOrderCreated({
        result,
        mockOrderRepo,
        mockPrisma,
        scenario,
      });
      // 상품 최종 가격 검증
      expect(verify.finalPrice).toBe(28000);
    });
    it('주문 성공 (할인 기간이 지난 상품은 원가로 계산된다.)', async () => {
      // 1. 기간이 지난 날짜 생성
      const now = new Date();
      // pastStart: 2일 전 (그저께 할인 시작)
      const pastStart = new Date(now);
      pastStart.setDate(now.getDate() - 2);
      // pastEnd: 1일 전 (어제 종료됨)
      const pastEnd = new Date(now);
      pastEnd.setDate(now.getDate() - 1);

      // 2. 시나리오 생성
      const scenario = setupOnlyCreateOrderScenario({
        orderItems: [
          createScenarioItem({
            itemPrice: 10000,
            discountRate: 50, // 50% 할인 설정
            discountStartTime: pastStart, // 시작일: 그저께
            discountEndTime: pastEnd, // 종료일: 어제
          }),
        ],
      });

      const { input, mocks, verify } = scenario;
      // mockRepo
      setUpCreateOnlyOrderMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.createOrder(input);

      // then
      // 시나리오 생성하는 시점에 비즈니스 로직 흐름에 맞게 데이터를 고정해둬서 검증 순서는 상관 없음
      // 기본 주문 완료 검증
      expectBaseOrderCreated({
        result,
        mockOrderRepo,
        mockPrisma,
        scenario,
      });
      // 상품 최종 가격 검증
      expect(verify.finalPrice).toBe(10000);
    });
    it('주문 실패 (유저가 보유한 포인트보다 사용하려는 포인트가 많은 경우 BadRequestError 발생)', async () => {
      // given
      // 초반부에 검증되는 부분은 전체 시나리오 대신 개별 목으로 필요한 것만 사용
      const input = createOrderServiceInputMock({
        userId: 'buyer-error',
        usePoint: 5000,
      });
      const errorUser = createGetUserInfoMock({ point: 1000 });
      mockOrderRepo.findUserInfo.mockResolvedValue(errorUser);
      // when
      // then
      await expect(mockOrderService.createOrder(input)).rejects.toThrow(BadRequestError);
    });
    it('주문 실패 (존재하지 않는 상품인 경우 NotFoundError 발생)', async () => {
      // given
      const input = createOrderServiceInputMock({
        orderItems: [
          createScenarioItem({
            productId: 'error-product',
          }),
        ],
      });

      mockOrderRepo.findUserInfo.mockResolvedValue(createGetUserInfoMock());
      mockOrderRepo.findManyProducts.mockResolvedValue(createGetProductsInfoMock());

      // when
      // then
      await expect(mockOrderService.createOrder(input)).rejects.toThrow(NotFoundError);
    });
    it('주문 실패 (재고보다 주문 수량이 많은 경우 BadRequestError 발생)', async () => {
      // given
      // 성공 시나리오대로 생성한 후 실패 유도
      const { input, mocks } = setupOnlyCreateOrderScenario();
      input.orderItems[0].quantity = 50;
      // mockRepo
      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);
      mockOrderRepo.findManyProducts.mockResolvedValue(mocks.productsInfoOutput);
      mockOrderRepo.reserveStock.mockResolvedValue(0);

      // when
      // then
      await expect(mockOrderService.createOrder(input)).rejects.toThrow(BadRequestError);
    });
    it('주문 실패 (상품 총액 보다 사용하려는 포인트가 많을 경우 BadRequestError 발생)', async () => {
      // given
      // 성공 시나리오대로 생성한 후 실패 유도
      const { input, mocks } = setupOnlyCreateOrderScenario({
        itemsPrice: 5000,
        usePoint: 0,
      });
      input.usePoint = 100000; // 실패 상황 설정
      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);
      mockOrderRepo.findManyProducts.mockResolvedValue(mocks.productsInfoOutput);

      // when
      // then
      await expect(mockOrderService.createOrder(input)).rejects.toThrow(BadRequestError);
    });
    it('주문 실패 (존재하지 않는 사이즈로 주문한 경우 BadRequestError 발생)', async () => {
      // given
      const { input, mocks } = setupOnlyCreateOrderScenario();
      input.orderItems[0].sizeId = 9999;

      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);
      mockOrderRepo.findManyProducts.mockResolvedValue(mocks.productsInfoOutput);

      // when
      // then
      await expect(mockOrderService.createOrder(input)).rejects.toThrow(BadRequestError);
    });
  });
  describe('주문 확정 (주문 트랜잭션 처리)', () => {
    let paymentId: string;
    beforeEach(() => {
      paymentId = 'payment-id-1';
    });
    it('주문 성공 (단일 상품, 포인트 사용 x, 알림 발송 x)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        order: createOrderFromPaymentMock({
          orderItems: [
            createOrderItemMock({
              quantity: 1,
              price: 10000,
            }),
          ],
        }),
      });
      const { mocks } = scenario;
      // mockRepo
      // 기본 mockRepo 세팅
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      // 기본 검증
      expectBaseOrderTx({
        mockNotificationService,
        mockSseManager,
        mockOrderRepo,
        mockPrisma,
        mockUserService,
        scenario,
        result,
        paymentId,
      });
      // 포인트 적립 검증
      expectPointEarn({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 히스토리 검증
      expectPointHistory({ mockOrderRepo, mockPrisma, scenario });
      // 상품 최종 가격 검증
      expectFinalPrice(scenario, 10000);
    });
    it('주문 성공 (다중 상품, 포인트 사용 x, 알림 발송 x)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        order: createOrderFromPaymentMock({
          orderItems: [
            createOrderItemMock({
              quantity: 1,
              price: 10000,
            }),
            createOrderItemMock({
              price: 10000,
              productId: 'product-id-2',
              size: createSizeMock({ id: 2 }),
              quantity: 2,
            }),
          ],
        }),
      });
      const { mocks } = scenario;
      // mockRepo
      // 기본 mockRepo 세팅
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expectBaseOrderTx({
        mockNotificationService,
        mockSseManager,
        mockOrderRepo,
        mockPrisma,
        mockUserService,
        scenario,
        result,
        paymentId,
      });
      // 포인트 적립 검증
      expectPointEarn({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 히스토리 검증
      expectPointHistory({ mockOrderRepo, mockPrisma, scenario });
      // 상품 최종 가격 검증
      expectFinalPrice(scenario, 30000);
    });
    it('주문 성공 (다중 상품, 포인트 사용 O, 알림 발송 x)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        order: createOrderFromPaymentMock({
          usePoint: 1000,
          orderItems: [
            createOrderItemMock({
              quantity: 1,
              price: 10000,
            }),
            createOrderItemMock({
              price: 10000,
              productId: 'product-id-2',
              size: createSizeMock({ id: 2 }),
              quantity: 2,
            }),
          ],
        }),
      });
      const { mocks } = scenario;
      // mockRepo
      // 기본 mockRepo 세팅
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expectBaseOrderTx({
        mockNotificationService,
        mockSseManager,
        mockOrderRepo,
        mockPrisma,
        mockUserService,
        scenario,
        result,
        paymentId,
      });
      // 포인트 사용 검증
      expectPointUsed({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 적립 검증
      expectPointEarn({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 히스토리 검증
      expectPointHistory({ mockOrderRepo, mockPrisma, scenario });
      // 상품 최종 가격 검증
      expectFinalPrice(scenario, 29000);
    });
    it('주문 성공 (다중 상품, 포인트 사용 O, 알림 발송 O)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        stockQuantity: 1,
        order: createOrderFromPaymentMock({
          usePoint: 1000,
          orderItems: [
            createOrderItemMock({
              // 1개 사면 품절되는 상황 발생 -> 알림 발송
              price: 10000,
            }),
            createOrderItemMock({
              productId: 'product-id-2',
              size: createSizeMock({ id: 2 }),
              quantity: 1,
              price: 10000,
            }),
          ],
        }),
      });
      const { mocks } = scenario;
      // mockRepo
      // 기본 mockRepo 세팅
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expectBaseOrderTx({
        mockNotificationService,
        mockSseManager,
        mockOrderRepo,
        mockPrisma,
        mockUserService,
        scenario,
        result,
        paymentId,
      });
      // 포인트 사용 검증
      expectPointUsed({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 적립 검증
      expectPointEarn({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 히스토리 검증
      expectPointHistory({ mockOrderRepo, mockPrisma, scenario });
      // 판매자 알림 생성 검증
      expectCreateSellerNotification({ mockNotificationService, mockPrisma, scenario });
      // 장바구니에 담은 유저 알림 생성 검증
      expectCreateBuyerNotification({ mockNotificationService, mockPrisma, scenario });
      // 판매자 알림 발송 검증
      expectSellerNotificationSend({ mockSseManager, scenario });
      // 장바구니 유저 알림 발송 검증
      expectBuyerNotificationSend({ mockSseManager, scenario });
      // 상품 최종 가격 검증
      expectFinalPrice(scenario, 19000);
    });
    it('주문 성공 (최종 결제 금액이 0원이면 포인트도 0원 적립된다.)', async () => {
      const scenario = setupOrderTxScenario({
        userPoint: 10000,
        order: createOrderFromPaymentMock({
          usePoint: 5000,
          orderItems: [
            createOrderItemMock({
              price: 5000, // 이 시점에는 이미 할인이 적용된 가격이 있어야함
            }),
          ],
        }),
      });
      scenario.verify.decreasePointHistoryRepoInput!.amount = 5000;

      const { mocks } = scenario;
      // mockRepo
      // 기본 mockRepo 세팅
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expectBaseOrderTx({
        mockNotificationService,
        mockSseManager,
        mockOrderRepo,
        mockPrisma,
        mockUserService,
        scenario,
        result,
        paymentId,
      });
      // 적립 자체가 안되어야함
      expect(mockOrderRepo.increasePoint).not.toHaveBeenCalled();
      // 포인트 사용 검증
      expectPointUsed({ mockOrderRepo, mockPrisma, scenario });
      // 포인트 히스토리 검증 (사용 내역만)
      expect(mockOrderRepo.createPointHistory).toHaveBeenCalledTimes(1);
      expect(mockOrderRepo.createPointHistory).toHaveBeenCalledWith(
        scenario.verify.decreasePointHistoryRepoInput,
        mockPrisma,
      );
      // 상품 최종 가격 검증
      expectFinalPrice(scenario, 0);
    });
    it('주문 실패 (유저가 보유한 포인트보다 사용하려는 포인트가 많은 경우 BadRequestError 발생)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        userPoint: 1000,
        order: createOrderFromPaymentMock({
          usePoint: 5000,
          orderItems: [
            createOrderItemMock({
              price: 100000,
            }),
          ],
        }),
      });
      const { mocks } = scenario;

      mockOrderRepo.findPaymentWithOrder.mockResolvedValue(mocks.orderFromPaymentOutput);

      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);

      // when
      // then
      await expect(mockOrderService.confirmPayment(paymentId)).rejects.toThrow(BadRequestError);
    });
    it('주문 실패 (재고보다 주문 수량이 많은 경우 BadRequestError 발생)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        userPoint: 0,
        order: createOrderFromPaymentMock({
          orderItems: [
            createOrderItemMock({
              quantity: 100,
            }),
          ],
        }),
      });
      const { mocks } = scenario;

      mockOrderRepo.findPaymentWithOrder.mockResolvedValue(mocks.orderFromPaymentOutput);
      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(mocks.orderStatus);
      mockOrderRepo.findPaymentStatusById.mockResolvedValue(mocks.paymentStatus);
      mockOrderRepo.decreaseStock.mockResolvedValue(0);

      // when
      // then
      await expect(mockOrderService.confirmPayment(paymentId)).rejects.toThrow(BadRequestError);
    });
    it('주문 실패 (트랜잭션 실패시 알림 미발송)', async () => {
      // given
      const scenario = setupOrderTxScenario({
        order: createOrderFromPaymentMock({
          orderItems: [
            createOrderItemMock({
              productId: 'error-product',
            }),
          ],
        }),
      });
      const { mocks } = scenario;

      mockOrderRepo.findPaymentWithOrder.mockResolvedValue(mocks.orderFromPaymentOutput);
      mockOrderRepo.findUserInfo.mockResolvedValue(mocks.userInfoOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(mocks.orderStatus);
      mockOrderRepo.findPaymentStatusById.mockRejectedValue(new BadRequestError());

      // when
      // then
      await expect(mockOrderService.confirmPayment(paymentId)).rejects.toThrow(BadRequestError);
      expect(mockSseManager.sendMessage).not.toHaveBeenCalled();
    });
    it('중복 호출 방어 (이미 결제 완료된 주문인 경우 추가 로직 수행없이 종료)', async () => {
      // given
      const { mocks } = setupOrderTxScenario({
        orderStatus: { status: OrderStatus.CompletedPayment },
      });
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expect(result).toBeUndefined();
      expect(mockOrderRepo.decreasePoint).not.toHaveBeenCalled();
      expect(mockOrderRepo.decreaseStock).not.toHaveBeenCalled();
      expect(mockOrderRepo.increasePoint).not.toHaveBeenCalled();
    });
    it('동시성 제어 (이미 취소된 주문인 경우 추가 로직 수행 없이 종료)', async () => {
      // given
      const { mocks } = setupOrderTxScenario({
        orderStatus: { status: OrderStatus.Cancelled },
      });
      setUpOrderTxMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      const result = await mockOrderService.confirmPayment(paymentId);

      // then
      expect(result).toBeUndefined();
      expect(mockOrderRepo.decreasePoint).not.toHaveBeenCalled();
      expect(mockOrderRepo.decreaseStock).not.toHaveBeenCalled();
      expect(mockOrderRepo.increasePoint).not.toHaveBeenCalled();
    });
  });

  describe('주문 만료', () => {
    it('주문 만료 처리 성공', async () => {
      // given
      const expiredOrder = createExpiredOrderRawDataMock({
        id: 'expired-order-1',
        orderItems: [
          { productId: 'product-1', sizeId: 1, quantity: 2 },
          { productId: 'product-2', sizeId: 2, quantity: 1 },
        ],
      });
      const { id: expiredOrderId, orderItems: expiredOrderItems } = expiredOrder;
      mockOrderRepo.getExpiredOrderInfo.mockResolvedValue({ orderItems: expiredOrderItems });

      // when
      await mockOrderService.expireWaitingOrder(expiredOrderId);

      // then
      expect(mockOrderRepo.getExpiredOrderInfo).toHaveBeenCalledTimes(1);
      expect(mockOrderRepo.restoreReservedStock).toHaveBeenCalledTimes(2);
      expect(mockOrderRepo.restoreReservedStock).toHaveBeenCalledWith(
        {
          productId: 'product-1',
          sizeId: 1,
          quantity: 2,
        },
        mockPrisma,
      );
      expect(mockOrderRepo.restoreReservedStock).toHaveBeenCalledWith(
        {
          productId: 'product-2',
          sizeId: 2,
          quantity: 1,
        },
        mockPrisma,
      );
      expect(mockOrderRepo.updateStatus).toHaveBeenCalledWith(
        'expired-order-1',
        OrderStatus.Cancelled,
        mockPrisma,
      );
    });

    it('만료된 주문이 없는 경우 로직 수행 없이 종료', async () => {
      // given
      mockOrderRepo.getExpiredOrderInfo.mockResolvedValue(null);

      // when
      await mockOrderService.expireWaitingOrder('');

      // then
      expect(mockOrderRepo.getExpiredOrderInfo).toHaveBeenCalledTimes(1);
      expect(mockOrderRepo.restoreReservedStock).not.toHaveBeenCalled();
      expect(mockOrderRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('주문 수정', () => {
    it('주문 수정 성공', async () => {
      // given
      const orderStatus = OrderStatus.WaitingPayment; // 결제 대기 상태에서만 수정 가능
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      const getOrderOutput = createGetOrderMock({
        phoneNumber: input.phone,
        address: input.address,
        name: input.name,
        payments: [createPaymentMock()],
      });
      const { userId: _userId, ...repoInput } = input;

      mockOrderRepo.findOwnerById.mockResolvedValue({ buyerId });
      mockOrderRepo.findStatusById.mockResolvedValue({ status: orderStatus });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);

      // when
      const result = await mockOrderService.updateOrder(input);

      // then
      expect(result).toEqual(getOrderOutput);
      expect(mockOrderRepo.updateOrder).toHaveBeenCalledWith(repoInput);
      expect(mockOrderRepo.findById).toHaveBeenCalledWith(input.orderId);
    });
    it('주문 수정 실패 (본인의 주문 내역이 아닌 경우 ForbiddenError 발생)', async () => {
      // given
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      mockOrderRepo.findOwnerById.mockResolvedValue({ buyerId: otherId });

      // when
      // then
      await expect(mockOrderService.updateOrder(input)).rejects.toThrow(ForbiddenError);
    });
    it('주문 수정 실패 (해당 주문 건이 없는 경우 NotFoundError 발생)', async () => {
      // given
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      mockOrderRepo.findOwnerById.mockResolvedValue(null);

      // when
      // then
      await expect(mockOrderService.updateOrder(input)).rejects.toThrow(NotFoundError);
    });
    it('주문 수정 실패 (주문 상태 조회가 실패한 경우 InternalServerError 발생)', async () => {
      // given
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      mockOrderRepo.findOwnerById.mockResolvedValue({ buyerId });
      mockOrderRepo.findStatusById.mockResolvedValue(null);

      // when
      // then
      await expect(mockOrderService.updateOrder(input)).rejects.toThrow(InternalServerError);
    });
    it('주문 수정 실패 (주문 상태가 WaitingPayment 상태가 아닌 경우 BadRequestError 발생)', async () => {
      // given
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      mockOrderRepo.findOwnerById.mockResolvedValue({ buyerId });
      mockOrderRepo.findStatusById.mockResolvedValue({ status: OrderStatus.CompletedPayment });

      // when
      // then
      await expect(mockOrderService.updateOrder(input)).rejects.toThrow(BadRequestError);
    });
    it('주문 수정 실패 (주문 수정 후 주문 정보 조회가 실패한 경우 InternalServerError 발생)', async () => {
      // given
      const input = updateOrderServiceInputMock({
        userId: buyerId,
      });
      mockOrderRepo.findOwnerById.mockResolvedValue({ buyerId });
      mockOrderRepo.findStatusById.mockResolvedValue({ status: OrderStatus.WaitingPayment });
      mockOrderRepo.findById.mockResolvedValue(null);

      // when
      // then
      await expect(mockOrderService.updateOrder(input)).rejects.toThrow(InternalServerError);
    });
  });
  describe('주문 삭제', () => {
    it('주문 취소 성공 (사용한 포인트 x, 포인트 적립 x)', async () => {
      // given
      const { mocks, verify } = setupDeleteOrderScenario();

      setUpDeleteOrderMockRepos({ mockOrderRepo, mockData: mocks });

      // when
      await mockOrderService.deleteOrder(userId, orderId);

      // then
      // 기본 주문 취소 로직 검증
      expectBaseOrderDeleted({ mockOrderRepo, mockPrisma, mockUserService, mocks, verify });
    });
    it('주문 취소 성공 (사용한 포인트 x, 포인트 적립 O)', async () => {
      // given
      const { mocks, verify } = setupDeleteOrderScenario({
        userId,
        orderId,
      });
      const getPointHistoryRepoOutput = createGetPointHistoryMock({
        userId: verify.userId,
        orderId: verify.orderId,
        amount: 100,
      });
      const earnCancelPointRepoInput = createPointInputMock({ userId: verify.userId, amount: 100 });
      const earnCancelPointHistoryRepoInput = createPointHistoryInputMock({
        orderId: verify.orderId,
        userId: verify.userId,
        type: PointHistoryType.EARN_CANCEL,
        amount: 100,
      });

      setUpDeleteOrderMockRepos({ mockOrderRepo, mockData: mocks });
      mockOrderRepo.findPointHistory.mockResolvedValue(getPointHistoryRepoOutput);

      // when
      await mockOrderService.deleteOrder(userId, orderId);

      // then
      // 기본 주문 취소 로직 검증
      expectBaseOrderDeleted({ mockOrderRepo, mockPrisma, mocks, mockUserService, verify });
      // 주문시 사용한 포인트 환불 검증
      expect(mockOrderRepo.decreasePoint).toHaveBeenCalledWith(
        earnCancelPointRepoInput,
        mockPrisma,
      );
      expect(mockOrderRepo.createPointHistory).toHaveBeenCalledWith(
        earnCancelPointHistoryRepoInput,
        mockPrisma,
      );
    });
    it('주문 취소 성공 (사용한 포인트 O, 포인트 적립 O)', async () => {
      // 기본 시나리오 + 주문 시 사용한 포인트 환불 + 적립 됐던 포인트 적립 취소
      // given
      const { mocks, verify } = setupDeleteOrderScenario({
        userId,
        orderId,
        usePoint: 1000,
      });
      // 주문시 사용한 포인트 환불
      const refundPointRepoInput = createPointInputMock({ userId: verify.userId, amount: 1000 });
      const refundPointHistoryRepoInput = createPointHistoryInputMock({
        orderId: verify.orderId,
        userId: verify.userId,
        type: PointHistoryType.REFUND,
        amount: 1000,
      });
      // 포인트 적립 취소
      const getPointHistoryRepoOutput = createGetPointHistoryMock({
        userId: verify.userId,
        orderId: verify.orderId,
        amount: 100,
      });
      const earnCancelPointRepoInput = createPointInputMock({ userId: verify.userId, amount: 100 });
      const earnCancelPointHistoryRepoInput = createPointHistoryInputMock({
        orderId: verify.orderId,
        userId: verify.userId,
        type: PointHistoryType.EARN_CANCEL,
        amount: 100,
      });

      // repo mock
      setUpDeleteOrderMockRepos({ mockOrderRepo, mockData: mocks });
      mockOrderRepo.findPointHistory.mockResolvedValue(getPointHistoryRepoOutput);

      // when
      await mockOrderService.deleteOrder(userId, orderId);

      // then
      // 기본 주문 취소 로직 검증
      expectBaseOrderDeleted({ mockOrderRepo, mockPrisma, mocks, mockUserService, verify });
      // 주문시 사용한 포인트 환불 검증
      expect(mockOrderRepo.increasePoint).toHaveBeenCalledWith(refundPointRepoInput, mockPrisma);
      expect(mockOrderRepo.createPointHistory).toHaveBeenCalledWith(
        refundPointHistoryRepoInput,
        mockPrisma,
      );
      // 포인트 적립 취소 검증
      expect(mockOrderRepo.decreasePoint).toHaveBeenCalledWith(
        earnCancelPointRepoInput,
        mockPrisma,
      );
      expect(mockOrderRepo.createPointHistory).toHaveBeenCalledWith(
        earnCancelPointHistoryRepoInput,
        mockPrisma,
      );
    });
    it('주문 취소 성공 (결제 전 취소인 경우 주문 만료 로직 호출)', async () => {
      // given
      const { mocks } = setupDeleteOrderScenario({
        userId,
        orderId,
        usePoint: 1000,
        orderStatus: { status: OrderStatus.WaitingPayment },
      });
      // 만료 로직이 호출되었는지만 판단
      // 만료 로직 테스트는 별도로 진행
      const expireSpy = jest
        .spyOn(mockOrderService, 'expireWaitingOrder')
        .mockResolvedValue(undefined);

      mockOrderRepo.findById.mockResolvedValue(mocks.getOrderOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(mocks.orderStatus);

      // when
      await mockOrderService.deleteOrder(userId, orderId);

      // then
      expect(expireSpy).toHaveBeenCalledTimes(1);
      expect(mockOrderRepo.increaseStock).not.toHaveBeenCalled();
    });
    it('주문 취소 실패 (주문 정보 조회 결과가 없는 경우 NotFoundError 발생)', async () => {
      // given
      mockOrderRepo.findById.mockResolvedValue(null);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(NotFoundError);
    });
    it('주문 취소 실패 (본인 주문이 아닌 경우 ForbiddenError 발생)', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        id: orderId,
        buyerId: otherId,
        payments: [createPaymentMock({ status: 'completed' })],
      });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(ForbiddenError);
    });
    it('주문 취소 실패 (주문 상태 조회 실패한 경우 InternalServerError 발생)', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        id: orderId,
        buyerId: userId,
        payments: [createPaymentMock({ status: 'completed' })],
      });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(null);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(
        InternalServerError,
      );
    });
    it('주문 취소 실패 (결제 정보가 없는 경우 BadRequestError 발생)', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        id: orderId,
        buyerId: userId,
        payments: [createPaymentMock({ status: 'pending' })],
      });
      const orderStatus = { status: OrderStatus.CompletedPayment };
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(orderStatus);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(BadRequestError);
    });
    it('주문 취소 실패 (유저 정보 조회가 실패한 경우 InternalServerError 발생)', async () => {
      // given
      const getOrderOutput = createGetOrderMock({
        id: orderId,
        buyerId: userId,
        payments: [createPaymentMock({ status: 'completed' })],
      });
      const orderStatus = { status: OrderStatus.CompletedPayment };
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(orderStatus);
      mockOrderRepo.findUserInfo.mockResolvedValue(null);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(
        InternalServerError,
      );
    });
    it('주문 취소 실패 (유저가 현재 보유한 포인트보다 회수할 포인트 양이 더 많은 경우 BadRequestError 발생)', async () => {
      // 이런 경우를 방지하기 위해 포인트 적립은 결제 완료된 이후 적립하도록 추후 리팩토링 해야할 것 같음
      // 결제하고 배송 완료된 이후에도 사용자가 구매 취소, 교환 등 할 수 있기 때문에 포인트 적립 처리는 좀 더 정교해야할 것 같다.
      // 무신사처럼 구매자가 명시적으로 구매확정을 누르면 포인트 적립되도록 하는 등
      // 포인트 적립은 정책상 주문에서 트랜잭션 처리되지 않아야 할 것 같음
      // 주문 후 일정기간이 지나거나 사용자가 명시적으로 취소, 교환 등의 변동 여지가 없음을 표현한 후 포인트 적립해야할 것 같음
      // given
      const getOrderOutput = createGetOrderMock({
        id: orderId,
        buyerId: userId,
        payments: [createPaymentMock({ status: 'completed' })],
      });
      const orderStatus = { status: OrderStatus.CompletedPayment };
      const userInfoOutput = createGetUserInfoMock({
        point: 0,
      });
      const getPointHistoryRepoOutput = createGetPointHistoryMock({
        userId,
        orderId,
        amount: 100,
      });
      mockOrderRepo.findById.mockResolvedValue(getOrderOutput);
      mockOrderRepo.findStatusById.mockResolvedValue(orderStatus);
      mockOrderRepo.findUserInfo.mockResolvedValue(userInfoOutput);
      mockOrderRepo.findPointHistory.mockResolvedValue(getPointHistoryRepoOutput);
      // when
      // then
      await expect(mockOrderService.deleteOrder(userId, orderId)).rejects.toThrow(BadRequestError);
    });
  });
});
