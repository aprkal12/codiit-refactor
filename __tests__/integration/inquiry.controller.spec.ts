import { jest } from '@jest/globals';
import { prisma } from '@/config/prisma.js';
import { testClient, authRequest } from '../helpers/testClient.js';
import { generateBuyerToken, generateSellerToken } from '../helpers/authHelper.js';
import {
  createTestContext,
  createTestStore,
  createTestCategory,
  createTestProduct,
  createTestInquiry,
  createTestReply,
  type TestContext,
} from '../helpers/dataFactory.js';
import type { Store, Category, Product, Inquiry, Reply } from '@prisma/client';
import { notificationService } from '@/domains/notification/notification.container.js';
import { sseManager } from '@/common/utils/sse.manager.js';

describe('Inquiry API Integration Test', () => {
  let ctx: TestContext;
  let otherCtx: TestContext;
  let sellerToken: string;
  let buyerToken: string;
  let otherBuyerToken: string;

  let store: Store;
  let category: Category;
  let product: Product;
  let inquiry: Inquiry;
  let reply: Reply;

  // Spy 생성을 위한 변수 선언
  let createNotificationSpy: jest.SpiedFunction<typeof notificationService.createNotification>;
  let sendMessageSpy: jest.SpiedFunction<typeof sseManager.sendMessage>;

  beforeAll(() => {
    createNotificationSpy = jest.spyOn(notificationService, 'createNotification');
    sendMessageSpy = jest.spyOn(sseManager, 'sendMessage');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    createNotificationSpy.mockReset();
    sendMessageSpy.mockReset();

    // createNotification이 호출되면 가짜 알림 객체를 반환하도록 설정
    createNotificationSpy.mockImplementation(async () => ({
      id: 'mock-notification-id',
      userId: 'mock-user-id',
      content: 'Mock Notification Content',
      isChecked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // sendMessage는 아무 동작도 하지 않도록 설정
    sendMessageSpy.mockImplementation(() => {});

    // 기본 유저 생성
    ctx = await createTestContext();
    sellerToken = generateSellerToken(ctx.seller.id);
    buyerToken = generateBuyerToken(ctx.buyer.id);
    // 다른 유저 생성
    otherCtx = await createTestContext();
    otherBuyerToken = generateBuyerToken(otherCtx.buyer.id);

    // 기본 스토어, 상품 생성
    store = await createTestStore(ctx.seller.id);
    category = await createTestCategory();
    const productOption = {
      storeId: store.id,
      categoryId: category.id,
    };
    product = await createTestProduct(productOption);
  });

  const createInquiry = {
    title: '테스트 문의',
    content: '테스트 문의 내용입니다.',
    isSecret: false,
  };

  const createReply = {
    content: '테스트 답변 내용입니다.',
  };

  // =================================================================
  // 문의 생성
  // =================================================================
  describe('POST /api/products/:productId/inquiries', () => {
    it('201: 문의 생성 성공 및 알림 전송', async () => {
      const response = await authRequest(buyerToken)
        .post(`/api/products/${product.id}/inquiries`)
        .send(createInquiry);

      expect(response.status).toBe(201);
      expect(response.body.content).toBe(createInquiry.content);
      expect(response.body.userId).toBe(ctx.buyer.id);
      expect(response.body.productId).toBe(product.id);

      // DB에 실제로 데이터가 생성되었는지 확인
      const dbInquiry = await prisma.inquiry.findUnique({
        where: { id: response.body.id },
      });
      expect(dbInquiry).not.toBeNull();
      expect(dbInquiry!.title).toBe(createInquiry.title);
      expect(dbInquiry!.content).toBe(createInquiry.content);
      expect(createNotificationSpy).toHaveBeenCalledTimes(1);
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient
        .post(`/api/products/${product.id}/inquiries`)
        .send(createInquiry);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 상품에 대한 문의 생성 실패', async () => {
      const response = await authRequest(buyerToken)
        .post('/api/products/clx1j9v5o000008l4cz6g3sds/inquiries')
        .send(createInquiry);
      expect(response.status).toBe(404);
    });
  });

  // ==================================================================
  // 특정 상품의 모든 문의 조회
  // ==================================================================
  describe('GET /api/products/:productId/inquiries', () => {
    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
    });

    it('200: 상품 문의 목록 조회 성공 (비로그인)', async () => {
      const response = await testClient.get(`/api/products/${product.id}/inquiries`);

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
    });

    it('200: 상품 문의 목록 조회 성공 (작성자)', async () => {
      const response = await authRequest(buyerToken).get(`/api/products/${product.id}/inquiries`);

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
    });

    it('200: 상품 문의 목록 조회 성공 (판매자)', async () => {
      const response = await authRequest(sellerToken).get(`/api/products/${product.id}/inquiries`);

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
    });

    it('200: 페이지네이션 적용', async () => {
      await createTestInquiry(ctx.buyer.id, product.id);
      await createTestInquiry(ctx.buyer.id, product.id);

      const response = await testClient.get(
        `/api/products/${product.id}/inquiries?page=1&pageSize=2`,
      );
      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(2);
      expect(response.body.totalCount).toBe(3);
    });
  });

  // ========================================================
  // 모든 문의 조회 (사용자 본인의 문의)
  // ========================================================
  describe('GET /api/inquiries', () => {
    beforeEach(async () => {
      await createTestInquiry(ctx.buyer.id, product.id);

      const productOption = {
        storeId: store.id,
        categoryId: category.id,
        name: '다른 상품',
      };
      const anotherProduct = await createTestProduct(productOption);
      await createTestInquiry(ctx.buyer.id, anotherProduct.id);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get('/api/inquiries');
      expect(response.status).toBe(401);
    });

    it('200: 내 문의 목록 조회 성공', async () => {
      const response = await authRequest(buyerToken).get('/api/inquiries');
      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(2);
      expect(response.body.totalCount).toBe(2);
    });
  });

  // ========================================================
  // 특정 문의 조회
  // ========================================================
  describe('GET /api/inquiries/:id', () => {
    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
    });

    it('200: 작성자가 자신의 문의 조회 성공', async () => {
      const response = await authRequest(buyerToken).get(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(inquiry.id);
    });

    it('200: 판매자가 상품에 대한 문의 조회 성공', async () => {
      const response = await authRequest(sellerToken).get(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(inquiry.id);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 문의 조회 실패', async () => {
      const response = await authRequest(buyerToken).get(
        '/api/inquiries/clx1j9v5o000008l4cz6g3sds',
      );
      expect(response.status).toBe(404);
    });
  });

  // ========================================================
  // 문의 수정
  // ========================================================
  describe('PATCH /api/inquiries/:id', () => {
    const updateInquiry = { content: '수정된 문의 내용입니다.' };

    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
    });

    it('200: 작성자가 자신의 문의 수정 성공', async () => {
      const response = await authRequest(buyerToken)
        .patch(`/api/inquiries/${inquiry.id}`)
        .send(updateInquiry);

      expect(response.status).toBe(200);
      expect(response.body.content).toBe(updateInquiry.content);

      // DB에 실제로 데이터가 수정되었는지 확인
      const dbInquiry = await prisma.inquiry.findUnique({
        where: { id: response.body.id },
      });
      expect(dbInquiry!.content).toBe(updateInquiry.content);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.patch(`/api/inquiries/${inquiry.id}`).send(updateInquiry);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 문의 수정 실패', async () => {
      const response = await authRequest(buyerToken)
        .patch('/api/inquiries/clx1j9v5o000008l4cz6g3sds')
        .send(updateInquiry);
      expect(response.status).toBe(404);
    });

    it('403: 작성자가 아닌 다른 사용자는 문의 수정 실패', async () => {
      const response = await authRequest(otherBuyerToken)
        .patch(`/api/inquiries/${inquiry.id}`)
        .send(updateInquiry);
      expect(response.status).toBe(403);
    });

    it('403: 답변이 달린 문의 수정 실패', async () => {
      await prisma.inquiry.update({
        where: { id: inquiry.id },
        data: { status: 'CompletedAnswer' },
      });

      const response = await authRequest(buyerToken)
        .patch(`/api/inquiries/${inquiry.id}`)
        .send(updateInquiry);

      expect(response.status).toBe(403);
    });

    it('400: 수정할 내용이 없을 시 문의 수정 실패', async () => {
      const response = await authRequest(buyerToken)
        .patch(`/api/inquiries/${inquiry.id}`)
        .send(createInquiry);
      expect(response.status).toBe(400);
    });
  });

  // ========================================================
  // 문의 삭제
  // ========================================================
  describe('DELETE /api/inquiries/:id', () => {
    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
    });

    it('200: 작성자가 자신의 문의 삭제 성공', async () => {
      const response = await authRequest(buyerToken).delete(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(200);

      // DB에 실제로 데이터가 삭제되었는지 확인
      const dbInquiry = await prisma.inquiry.findUnique({
        where: { id: response.body.id },
      });
      expect(dbInquiry).toBeNull();
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.delete(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 문의 삭제 실패', async () => {
      const response = await authRequest(buyerToken).delete(
        '/api/inquiries/clx1j9v5o000008l4cz6g3sds',
      );
      expect(response.status).toBe(404);
    });

    it('403: 작성자가 아닌 다른 사용자는 문의 삭제 실패', async () => {
      const response = await authRequest(otherBuyerToken).delete(`/api/inquiries/${inquiry.id}`);
      expect(response.status).toBe(403);
    });
  });

  // ============================================================
  // 답변 생성
  // ============================================================
  describe('POST /api/inquiries/:id/replies', () => {
    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
    });

    it('201: 판매자가 자신의 상품에 대한 문의에 답변 생성 성공 및 알림 전송', async () => {
      const response = await authRequest(sellerToken)
        .post(`/api/inquiries/${inquiry.id}/replies`)
        .send(createReply);

      expect(response.status).toBe(201);
      expect(response.body.content).toBe(createReply.content);

      // DB에 실제로 데이터가 생성되었는지 확인
      const dbReply = await prisma.reply.findUnique({
        where: { id: response.body.id },
      });
      // DB에 실제로 데이터가 수정되었는지 확인
      const dbInquiry = await prisma.inquiry.findUnique({
        where: { id: inquiry.id },
      });
      expect(dbReply).not.toBeNull();
      expect(dbReply!.content).toBe(createReply.content);
      expect(dbInquiry!.status).toBe('CompletedAnswer');
      expect(createNotificationSpy).toHaveBeenCalledTimes(1);
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient
        .post(`/api/inquiries/${inquiry.id}/replies`)
        .send(createReply);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 문의에 답변 생성 실패', async () => {
      const response = await authRequest(sellerToken)
        .post(`/api/inquiries/clx1j9v5o000008l4cz6g3sds/replies`)
        .send(createReply);
      expect(response.status).toBe(404);
    });

    it('403: 상품 생성자가 아닌 다른 사용자는 답변 생성 실패', async () => {
      const response = await authRequest(buyerToken)
        .post(`/api/inquiries/${inquiry.id}/replies`)
        .send(createReply);
      expect(response.status).toBe(403);
    });
  });

  // ============================================================
  // 답변 수정
  // ============================================================
  describe('PATCH /api/inquiries/:id/replies', () => {
    const updateReply = { content: '수정된 답변 내용입니다.' };

    beforeEach(async () => {
      inquiry = await createTestInquiry(ctx.buyer.id, product.id);
      reply = await createTestReply(ctx.seller.id, inquiry.id);
    });

    it('200: 판매자가 자신의 답변 수정 성공', async () => {
      const response = await authRequest(sellerToken)
        .patch(`/api/inquiries/${reply.id}/replies`)
        .send(updateReply);

      expect(response.status).toBe(200);
      expect(response.body.content).toBe(updateReply.content);

      // DB에 실제로 데이터가 수정되었는지 확인
      const dbReply = await prisma.reply.findUnique({
        where: { id: response.body.id },
      });
      expect(dbReply!.content).toBe(updateReply.content);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient
        .patch(`/api/inquiries/${reply.id}/replies`)
        .send(updateReply);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 답변 수정 실패', async () => {
      const response = await authRequest(sellerToken)
        .patch(`/api/inquiries/clx1j9v5o000008l4cz6g3sds/replies`)
        .send(updateReply);
      expect(response.status).toBe(404);
    });

    it('403: 상품 생성자가 아닌 다른 사용자는 답변 수정 실패', async () => {
      const response = await authRequest(buyerToken)
        .patch(`/api/inquiries/${reply.id}/replies`)
        .send(updateReply);
      expect(response.status).toBe(403);
    });

    it('400: 수정할 내용이 없을 시 답변 수정 실패', async () => {
      const response = await authRequest(sellerToken)
        .patch(`/api/inquiries/${reply.id}/replies`)
        .send(createReply);
      expect(response.status).toBe(400);
    });
  });
});
