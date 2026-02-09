import { prisma } from '@/config/prisma.js';
import { testClient, authRequest } from '../helpers/testClient.js';
import { generateSellerToken, generateBuyerToken } from '../helpers/authHelper.js';
import {
  createTestContext,
  createTestStore,
  createTestCategory,
  createTestSeller,
  createTestBuyer,
  type TestContext,
} from '../helpers/dataFactory.js';
import type { Store } from '@prisma/client';

describe('Store API Integration Test', () => {
  let ctx: TestContext;
  let sellerToken: string;
  let buyerToken: string;

  // 각 테스트 전 데이터 준비
  beforeEach(async () => {
    ctx = await createTestContext();
    sellerToken = generateSellerToken(ctx.seller.id);
    buyerToken = generateBuyerToken(ctx.buyer.id);
  });

  // ===== POST /api/stores - 스토어 생성 =====
  describe('POST /api/stores', () => {
    const validStoreData = {
      name: '테스트 스토어',
      address: '서울시 강남구',
      phoneNumber: '010-1234-5678',
      content: '테스트 스토어 설명입니다.',
    };

    it('201: 스토어 생성 성공', async () => {
      const response = await authRequest(sellerToken).post('/api/stores').send(validStoreData);

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('테스트 스토어');
      expect(response.body.address).toBe('서울시 강남구');
      expect(response.body.id).toBeDefined();

      // DB에 실제로 저장되었는지 확인
      const store = await prisma.store.findUnique({ where: { userId: ctx.seller.id } });
      expect(store).not.toBeNull();
      expect(store?.name).toBe('테스트 스토어');
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.post('/api/stores').send(validStoreData);

      expect(response.status).toBe(401);
    });

    it('403: 구매자가 스토어 생성 시도 시 실패', async () => {
      const response = await authRequest(buyerToken).post('/api/stores').send(validStoreData);

      expect(response.status).toBe(403);
    });

    it('400: 필수 필드 누락 시 실패', async () => {
      const response = await authRequest(sellerToken).post('/api/stores').send({
        name: '테스트 스토어',
        // address, phoneNumber, content 누락
      });

      expect(response.status).toBe(400);
    });

    it('409: 이미 스토어를 보유한 경우 실패', async () => {
      // 먼저 스토어 생성
      await createTestStore(ctx.seller.id);

      // 다시 생성 시도
      const response = await authRequest(sellerToken).post('/api/stores').send(validStoreData);

      expect(response.status).toBe(409);
    });
  });

  // ===== GET /api/stores/:storeId - 스토어 상세 조회 (공개) =====
  describe('GET /api/stores/:storeId', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id);
    });

    it('200: 스토어 상세 조회 성공 (인증 없이 가능)', async () => {
      const response = await testClient.get(`/api/stores/${store.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(store.id);
      expect(response.body.name).toBe('테스트 스토어');
      expect(response.body.favoriteCount).toBeDefined();
    });

    it('404: 존재하지 않는 스토어 조회', async () => {
      // cuid 형식의 존재하지 않는 ID 사용
      const response = await testClient.get('/api/stores/cmiwsr5gc0003rasojq3nrwqi');

      expect(response.status).toBe(404);
    });
  });

  // ===== GET /api/stores/detail/my - 내 스토어 상세 조회 =====
  describe('GET /api/stores/detail/my', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id, { name: '내 스토어' });
    });

    it('200: 내 스토어 상세 조회 성공', async () => {
      const response = await authRequest(sellerToken).get('/api/stores/detail/my');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(store.id);
      expect(response.body.name).toBe('내 스토어');
      expect(response.body.productCount).toBeDefined();
      expect(response.body.favoriteCount).toBeDefined();
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get('/api/stores/detail/my');

      expect(response.status).toBe(401);
    });

    it('403: 구매자가 요청 시 실패', async () => {
      const response = await authRequest(buyerToken).get('/api/stores/detail/my');

      expect(response.status).toBe(403);
    });

    it('404: 스토어가 없는 판매자', async () => {
      // 새로운 판매자 생성 (스토어 없음)
      const newSeller = await createTestSeller(ctx.grade.id, { email: 'newSeller@test.com' });
      const newSellerToken = generateSellerToken(newSeller.id);

      const response = await authRequest(newSellerToken).get('/api/stores/detail/my');

      expect(response.status).toBe(404);
    });
  });

  // ===== PATCH /api/stores/:storeId - 스토어 수정 =====
  describe('PATCH /api/stores/:storeId', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id, { name: '원래 스토어' });
    });

    it('200: 스토어 수정 성공', async () => {
      const response = await authRequest(sellerToken).patch(`/api/stores/${store.id}`).send({
        name: '수정된 스토어명',
        content: '수정된 스토어 설명입니다.', // 최소 10자 이상 필요
      });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('수정된 스토어명');
      expect(response.body.content).toBe('수정된 스토어 설명입니다.');

      // DB에서 확인
      const updatedStore = await prisma.store.findUnique({ where: { id: store.id } });
      expect(updatedStore?.name).toBe('수정된 스토어명');
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.patch(`/api/stores/${store.id}`).send({
        name: '수정된 스토어명',
      });

      expect(response.status).toBe(401);
    });

    it('403: 구매자가 수정 시도 시 실패', async () => {
      const response = await authRequest(buyerToken).patch(`/api/stores/${store.id}`).send({
        name: '수정된 스토어명',
      });

      expect(response.status).toBe(403);
    });

    it('403: 본인 스토어가 아닌 경우 실패', async () => {
      // 다른 판매자 생성
      const otherSeller = await createTestSeller(ctx.grade.id, { email: 'otherSeller@test.com' });
      const otherSellerToken = generateSellerToken(otherSeller.id);

      const response = await authRequest(otherSellerToken).patch(`/api/stores/${store.id}`).send({
        name: '수정된 스토어명',
      });

      expect(response.status).toBe(403);
    });

    it('404: 존재하지 않는 스토어 수정 시도', async () => {
      // cuid 형식의 존재하지 않는 ID 사용
      const response = await authRequest(sellerToken)
        .patch('/api/stores/cmiwsr5gc0003rasojq3nrwqi')
        .send({
          name: '수정된 스토어명',
        });

      expect(response.status).toBe(404);
    });
  });

  // ===== GET /api/stores/detail/my/product - 내 스토어 상품 목록 =====
  describe('GET /api/stores/detail/my/product', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id);

      // 카테고리 생성
      const category = await createTestCategory();

      // 상품 2개 생성
      await prisma.product.createMany({
        data: [
          {
            name: '테스트 상품 1',
            price: 10000,
            image: 'https://example.com/image1.jpg',
            storeId: store.id,
            categoryId: category.id,
          },
          {
            name: '테스트 상품 2',
            price: 20000,
            image: 'https://example.com/image2.jpg',
            storeId: store.id,
            categoryId: category.id,
          },
        ],
      });
    });

    it('200: 내 스토어 상품 목록 조회 성공', async () => {
      const response = await authRequest(sellerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(200);
      expect(response.body.list).toBeDefined();
      expect(response.body.list.length).toBe(2);
      expect(response.body.totalCount).toBe(2);
    });

    it('200: 페이지네이션 적용', async () => {
      const response = await authRequest(sellerToken).get(
        '/api/stores/detail/my/product?page=1&pageSize=1',
      );

      expect(response.status).toBe(200);
      expect(response.body.list.length).toBe(1);
      expect(response.body.totalCount).toBe(2);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get('/api/stores/detail/my/product');

      expect(response.status).toBe(401);
    });

    it('403: 구매자가 요청 시 실패', async () => {
      const response = await authRequest(buyerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(403);
    });

    it('404: 스토어가 없는 판매자', async () => {
      const newSeller = await createTestSeller(ctx.grade.id, { email: 'noStoreSeller@test.com' });
      const newSellerToken = generateSellerToken(newSeller.id);

      const response = await authRequest(newSellerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(404);
    });

    it('200: 할인율은 있지만 기간이 null인 상품(상시 할인) isDiscount가 true', async () => {
      // 기존 상품 삭제
      await prisma.product.deleteMany({ where: { storeId: store.id } });

      const category = await createTestCategory('할인카테고리1');

      // 상시 할인 상품 생성
      await prisma.product.create({
        data: {
          name: '상시 할인 상품',
          price: 10000,
          image: 'https://example.com/discount.jpg',
          storeId: store.id,
          categoryId: category.id,
          discountRate: 10,
          discountStartTime: null,
          discountEndTime: null,
        },
      });

      const response = await authRequest(sellerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.list[0].name).toBe('상시 할인 상품');
      expect(response.body.list[0].price).toBe(10000); // 원가
      expect(response.body.list[0].isDiscount).toBe(true); // 할인 활성
    });

    it('200: 할인 기간 내 상품 isDiscount가 true', async () => {
      // 기존 상품 삭제
      await prisma.product.deleteMany({ where: { storeId: store.id } });

      const category = await createTestCategory('할인카테고리2');
      const now = new Date();

      // 할인 기간 내 상품 생성
      await prisma.product.create({
        data: {
          name: '기간 할인 상품',
          price: 20000,
          image: 'https://example.com/period-discount.jpg',
          storeId: store.id,
          categoryId: category.id,
          discountRate: 20,
          discountStartTime: new Date(now.getTime() - 1000 * 60 * 60), // 1시간 전
          discountEndTime: new Date(now.getTime() + 1000 * 60 * 60), // 1시간 후
        },
      });

      const response = await authRequest(sellerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.list[0].name).toBe('기간 할인 상품');
      expect(response.body.list[0].price).toBe(20000); // 원가
      expect(response.body.list[0].isDiscount).toBe(true); // 할인 활성
    });

    it('200: 할인 없는 상품 isDiscount가 false', async () => {
      // 기존 상품 삭제
      await prisma.product.deleteMany({ where: { storeId: store.id } });

      const category = await createTestCategory('할인카테고리3');

      // 할인 없는 상품 생성
      await prisma.product.create({
        data: {
          name: '일반 상품',
          price: 15000,
          image: 'https://example.com/normal.jpg',
          storeId: store.id,
          categoryId: category.id,
          discountRate: 0,
          discountStartTime: null,
          discountEndTime: null,
        },
      });

      const response = await authRequest(sellerToken).get('/api/stores/detail/my/product');

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.list[0].name).toBe('일반 상품');
      expect(response.body.list[0].price).toBe(15000);
      expect(response.body.list[0].isDiscount).toBe(false); // 할인 없음
    });
  });

  // ===== POST /api/stores/:storeId/favorite - 관심 스토어 등록 =====
  describe('POST /api/stores/:storeId/favorite', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id);
    });

    it('201: 관심 스토어 등록 성공', async () => {
      const response = await authRequest(buyerToken).post(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(201);
      expect(response.body.type).toBe('register');
      expect(response.body.store).toBeDefined();
      expect(response.body.store.id).toBe(store.id);

      // DB에서 확인
      const storeLike = await prisma.storeLike.findUnique({
        where: { userId_storeId: { userId: ctx.buyer.id, storeId: store.id } },
      });
      expect(storeLike).not.toBeNull();
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.post(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(401);
    });

    it('403: 판매자가 요청 시 실패', async () => {
      const response = await authRequest(sellerToken).post(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(403);
    });

    it('404: 존재하지 않는 스토어', async () => {
      const response = await authRequest(buyerToken).post(
        '/api/stores/cmiwsr5gc0003rasojq3nrwqi/favorite',
      );

      expect(response.status).toBe(404);
    });

    it('409: 이미 관심 등록한 스토어', async () => {
      // 먼저 관심 등록
      await prisma.storeLike.create({
        data: { userId: ctx.buyer.id, storeId: store.id },
      });

      const response = await authRequest(buyerToken).post(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(409);
    });
  });

  // ===== DELETE /api/stores/:storeId/favorite - 관심 스토어 해제 =====
  describe('DELETE /api/stores/:storeId/favorite', () => {
    let store: Store;

    beforeEach(async () => {
      store = await createTestStore(ctx.seller.id);

      // 미리 관심 등록
      await prisma.storeLike.create({
        data: { userId: ctx.buyer.id, storeId: store.id },
      });
    });

    it('200: 관심 스토어 해제 성공', async () => {
      const response = await authRequest(buyerToken).delete(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('delete');
      expect(response.body.store).toBeDefined();

      // DB에서 확인
      const storeLike = await prisma.storeLike.findUnique({
        where: { userId_storeId: { userId: ctx.buyer.id, storeId: store.id } },
      });
      expect(storeLike).toBeNull();
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.delete(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(401);
    });

    it('403: 판매자가 요청 시 실패', async () => {
      const response = await authRequest(sellerToken).delete(`/api/stores/${store.id}/favorite`);

      expect(response.status).toBe(403);
    });

    it('404: 존재하지 않는 스토어', async () => {
      const response = await authRequest(buyerToken).delete(
        '/api/stores/cmiwsr5gc0003rasojq3nrwqi/favorite',
      );

      expect(response.status).toBe(404);
    });

    it('404: 관심 등록하지 않은 스토어 해제 시도', async () => {
      // 다른 구매자 생성 (관심 등록 안함)
      const otherBuyer = await createTestBuyer(ctx.grade.id, { email: 'otherBuyer@test.com' });
      const otherBuyerToken = generateBuyerToken(otherBuyer.id);

      const response = await authRequest(otherBuyerToken).delete(
        `/api/stores/${store.id}/favorite`,
      );

      expect(response.status).toBe(404);
    });
  });
});
