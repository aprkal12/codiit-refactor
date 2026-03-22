import { describe, it, expect, beforeEach } from '@jest/globals';
import { authRequest, testClient } from '../helpers/testClient.js';
import { prisma } from '@/config/prisma.js';
import { generateBuyerToken } from '../helpers/authHelper.js';
import { createTestContext, createTestStore, TestContext } from '../helpers/dataFactory.js';
import { CreateReviewDto, UpdateReviewDto } from '@/domains/review/review.dto.js';
import { OrderStatus } from '@prisma/client';

describe('⭐ Review API Integration Test', () => {
  let ctx: TestContext;
  let buyerToken: string;
  let otherBuyerToken: string;

  // 테스트에 필요한 데이터 ID
  let productId: string;
  let orderItemId: string;
  let reviewId: string;
  let sizeId: number;

  // Validation(Zod)을 통과하지만 DB에는 존재하지 않는 가짜 CUID
  let nonExistentCuid: string;

  beforeEach(async () => {
    // 기본 유저 및 컨텍스트 생성
    ctx = await createTestContext();
    buyerToken = generateBuyerToken(ctx.buyer.id);

    // 다른 구매자 생성 (권한 테스트용)
    const otherCtx = await createTestContext();
    otherBuyerToken = generateBuyerToken(otherCtx.buyer.id);

    // 스토어 및 카테고리 생성
    const store = await createTestStore(ctx.seller.id);
    const category = await prisma.category.create({
      data: { name: `REVIEW_TEST_${Date.now()}` },
    });

    // 상품 생성
    sizeId = 1;
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: '리뷰 테스트용 상품',
        price: 30000,
        content: '좋은 상품',
        image: 'http://example.com/img.jpg',
        categoryId: category.id,
        stocks: {
          create: { sizeId, quantity: 100 },
        },
      },
    });
    productId = product.id;

    // Zod 검증을 통과하는 완벽한 형식의 가짜 CUID 생성
    const lastChar = productId.slice(-1);
    const newLastChar = lastChar === 'a' ? 'b' : 'a';
    nonExistentCuid = productId.slice(0, -1) + newLastChar;

    // 주문 및 주문 상세 생성 (리뷰 작성을 위한 필수 조건)
    const order = await prisma.order.create({
      data: {
        buyerId: ctx.buyer.id,
        name: '구매자',
        phoneNumber: '010-1234-5678',
        address: '서울시 강남구',
        status: OrderStatus.Delivered,
        subtotal: 30000,
        totalQuantity: 1,
        orderItems: {
          create: {
            productId: product.id,
            sizeId: sizeId,
            quantity: 1,
            price: 30000,
          },
        },
      },
      include: { orderItems: true },
    });
    orderItemId = order.orderItems[0].id;
  });

  // --- 리뷰 작성 테스트 ---
  describe('POST /api/products/:productId/reviews', () => {
    it('201: 구매자가 주문한 상품에 대해 리뷰를 작성한다', async () => {
      const requestBody: CreateReviewDto = {
        rating: 5,
        content: '정말 마음에 드는 상품입니다!',
        orderItemId: orderItemId,
      };

      const res = await authRequest(buyerToken)
        .post(`/api/products/${productId}/reviews`)
        .send(requestBody);

      expect(res.status).toBe(201);
      expect(res.body.rating).toBe(5);
      expect(res.body.content).toBe(requestBody.content);
      expect(res.body.userId).toBe(ctx.buyer.id);
      expect(res.body.productId).toBe(productId);

      // DB 저장 확인
      const savedReview = await prisma.review.findUnique({
        where: { id: res.body.id },
      });
      expect(savedReview).not.toBeNull();
      reviewId = res.body.id;
    });

    it('400: 이미 리뷰를 작성한 주문 건으로 다시 작성 시도 시 실패한다', async () => {
      // 미리 리뷰 작성
      await prisma.review.create({
        data: {
          userId: ctx.buyer.id,
          productId: productId,
          orderItemId: orderItemId,
          rating: 5,
          content: '첫 번째 리뷰',
        },
      });

      // 중복 작성 시도
      const requestBody: CreateReviewDto = {
        rating: 3,
        content: '중복 작성 시도',
        orderItemId: orderItemId,
      };

      const res = await authRequest(buyerToken)
        .post(`/api/products/${productId}/reviews`)
        .send(requestBody);

      // [수정 2] 모호한 검증(>=400) 대신 명확한 400 Bad Request 검증으로 변경
      expect(res.status).toBe(400);
    });

    it('400: 존재하지 않는 상품(또는 주문과 일치하지 않는 상품)에 리뷰 작성 시 실패한다', async () => {
      const requestBody: CreateReviewDto = {
        rating: 5,
        content: '없는 상품 리뷰',
        orderItemId: orderItemId,
      };

      const res = await authRequest(buyerToken)
        .post(`/api/products/${nonExistentCuid}/reviews`)
        .send(requestBody);

      expect(res.status).toBe(400);
    });

    it('401: 로그인하지 않은 유저가 작성 시도 시 실패한다', async () => {
      const res = await testClient.post(`/api/products/${productId}/reviews`).send({});
      expect(res.status).toBe(401);
    });
  });

  // --- 리뷰 목록 조회 테스트 ---
  describe('GET /api/products/:productId/reviews', () => {
    beforeEach(async () => {
      // [수정 1] 불필요한 deleteMany 삭제 (global setup에서 처리됨)
      await prisma.review.create({
        data: {
          userId: ctx.buyer.id,
          productId: productId,
          orderItemId: orderItemId,
          rating: 5,
          content: '목록 조회용 리뷰',
        },
      });
    });

    it('200: 상품의 리뷰 목록을 조회한다', async () => {
      const res = await testClient.get(`/api/products/${productId}/reviews?page=1&limit=10`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items[0].content).toBe('목록 조회용 리뷰');
      expect(res.body.items[0].id).toBeDefined();
      expect(res.body.meta).toBeDefined();
    });

    it('404: 존재하지 않는 상품의 리뷰 조회 시 404를 반환한다', async () => {
      const res = await testClient.get(`/api/products/${nonExistentCuid}/reviews`);
      expect(res.status).toBe(404);
    });
  });

  // --- 리뷰 상세 조회 테스트 ---
  describe('GET /api/review/:reviewId', () => {
    beforeEach(async () => {
      const review = await prisma.review.create({
        data: {
          userId: ctx.buyer.id,
          productId: productId,
          orderItemId: orderItemId,
          rating: 4,
          content: '상세 조회용 리뷰',
        },
      });
      reviewId = review.id;
    });

    it('200: 리뷰 상세 정보를 조회한다', async () => {
      const res = await testClient.get(`/api/review/${reviewId}`);

      expect(res.status).toBe(200);
      expect(res.body.reviewId).toBe(reviewId);
      expect(res.body.content).toBe('상세 조회용 리뷰');
      expect(res.body.rating).toBe(4);
    });

    it('404: 존재하지 않는 리뷰 ID 조회 시 실패한다', async () => {
      const res = await testClient.get(`/api/review/${nonExistentCuid}`);
      expect(res.status).toBe(404);
    });
  });

  // --- 리뷰 수정 테스트 ---
  describe('PATCH /api/review/:reviewId', () => {
    beforeEach(async () => {
      const review = await prisma.review.create({
        data: {
          userId: ctx.buyer.id,
          productId: productId,
          orderItemId: orderItemId,
          rating: 3,
          content: '수정 전 내용',
        },
      });
      reviewId = review.id;
    });

    it('200: 작성자가 자신의 리뷰를 수정한다', async () => {
      const updateBody: UpdateReviewDto = {
        rating: 5,
        content: '수정 후 내용: 아주 만족합니다.',
      };

      const res = await authRequest(buyerToken).patch(`/api/review/${reviewId}`).send(updateBody);

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe(5);
      expect(res.body.content).toBe(updateBody.content);

      const updated = await prisma.review.findUnique({ where: { id: reviewId } });
      expect(updated?.rating).toBe(5);
    });

    it('403: 다른 유저가 리뷰 수정 시도 시 권한 없음 에러 발생', async () => {
      const updateBody: UpdateReviewDto = { rating: 1, content: '나쁜 리뷰로 변경' };

      const res = await authRequest(otherBuyerToken)
        .patch(`/api/review/${reviewId}`)
        .send(updateBody);

      expect(res.status).toBe(403);
    });

    it('401: 인증 토큰이 없으면 수정에 실패한다', async () => {
      const res = await testClient.patch(`/api/review/${reviewId}`).send({});
      expect(res.status).toBe(401);
    });
  });

  // --- 리뷰 삭제 테스트 ---
  describe('DELETE /api/review/:reviewId', () => {
    beforeEach(async () => {
      const review = await prisma.review.create({
        data: {
          userId: ctx.buyer.id,
          productId: productId,
          orderItemId: orderItemId,
          rating: 2,
          content: '삭제할 리뷰',
        },
      });
      reviewId = review.id;
    });

    it('204: 작성자가 자신의 리뷰를 삭제한다', async () => {
      const res = await authRequest(buyerToken).delete(`/api/review/${reviewId}`);

      expect(res.status).toBe(204);

      const deleted = await prisma.review.findUnique({ where: { id: reviewId } });
      expect(deleted).toBeNull();
    });

    it('403: 다른 유저가 삭제 시도 시 권한 없음 에러 발생', async () => {
      const res = await authRequest(otherBuyerToken).delete(`/api/review/${reviewId}`);
      expect(res.status).toBe(403);
    });

    it('404: 이미 삭제된 리뷰 삭제 시도 시 실패한다', async () => {
      await prisma.review.delete({ where: { id: reviewId } });

      const res = await authRequest(buyerToken).delete(`/api/review/${reviewId}`);
      expect(res.status).toBe(404);
    });
  });
});
