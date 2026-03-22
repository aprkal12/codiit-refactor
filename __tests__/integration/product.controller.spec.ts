import { describe, it, expect, beforeEach } from '@jest/globals';
import { authRequest, testClient } from '../helpers/testClient.js';
import { prisma } from '@/config/prisma.js';
import { generateSellerToken, generateBuyerToken } from '../helpers/authHelper.js';
import { createTestContext, createTestStore, TestContext } from '../helpers/dataFactory.js';
import { CreateProductDto, UpdateProductDto } from '@/domains/product/product.dto.js';

describe('📦 Product API Integration Test', () => {
  let ctx: TestContext;
  let sellerToken: string;
  let otherSellerToken: string;
  let buyerToken: string;

  // 테스트에 필요한 공통 데이터 ID
  let categoryId: string;
  let categoryName: string;
  let sizeId: number;

  beforeEach(async () => {
    // 기본 유저 및 컨텍스트 생성
    ctx = await createTestContext();
    sellerToken = generateSellerToken(ctx.seller.id);
    buyerToken = generateBuyerToken(ctx.buyer.id);

    // 다른 판매자 생성 (권한 테스트용)
    const otherSellerCtx = await createTestContext();
    otherSellerToken = generateSellerToken(otherSellerCtx.seller.id);

    // 카테고리 생성 (CUID 형식)
    const category = await prisma.category.create({
      data: { name: `TOP_TEST_${Date.now()}` },
    });
    categoryId = category.id;
    categoryName = category.name;

    // 사이즈 ID 설정
    // 글로벌 setup.integration.ts에서 ID 1~6 사이즈가 미리 생성되므로 바로 사용합니다.
    sizeId = 1;
  });

  // --- 상품 등록 테스트 ---
  describe('POST /api/products', () => {
    it('201: 판매자가 상품을 정상적으로 등록한다', async () => {
      await createTestStore(ctx.seller.id);

      const requestBody: CreateProductDto = {
        name: '테스트용 가디건',
        price: 50000,
        content: '따뜻한 가디건입니다.',
        image: 'https://example.com/cardigan.jpg',
        discountRate: 10,
        discountStartTime: new Date().toISOString(),
        discountEndTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        categoryName: categoryName,
        stocks: [{ sizeId: sizeId, quantity: 100 }],
      };

      const res = await authRequest(sellerToken).post('/api/products').send(requestBody);

      expect(res.status).toBe(201);
      expect(res.body.name).toBe(requestBody.name);
      expect(res.body.storeId).toBeDefined();

      const savedProduct = await prisma.product.findUnique({
        where: { id: res.body.id },
        include: { stocks: true },
      });
      expect(savedProduct).not.toBeNull();
      expect(savedProduct?.stocks[0].quantity).toBe(100);
    });

    it('404: 스토어가 없는 판매자가 등록 시도 시 실패한다', async () => {
      const requestBody: CreateProductDto = {
        name: '스토어 없는 상품',
        price: 50000,
        content: '내용',
        image: 'https://example.com/img.jpg',
        discountRate: 0,
        discountStartTime: null,
        discountEndTime: null,
        categoryName: categoryName,
        stocks: [{ sizeId: sizeId, quantity: 10 }],
      };

      const res = await authRequest(sellerToken).post('/api/products').send(requestBody);
      expect(res.status).toBe(404);
    });

    it('403: 구매자가 등록 시도 시 권한 없음 에러 발생', async () => {
      const res = await authRequest(buyerToken).post('/api/products').send({});
      expect(res.status).toBe(403);
    });

    it('401: 인증 토큰이 없으면 실패한다', async () => {
      const res = await testClient.post('/api/products').send({});
      expect(res.status).toBe(401);
    });
  });

  // --- 상품 목록 조회 (심화 테스트: 필터/정렬/검색) ---
  describe('GET /api/products (Search & Filter)', () => {
    let bottomCategoryName: string;

    beforeEach(async () => {
      const store = await createTestStore(ctx.seller.id);

      const catTop = await prisma.category.create({ data: { name: `TOP_SEARCH_${Date.now()}` } });
      const catBottom = await prisma.category.create({
        data: { name: `BOTTOM_SEARCH_${Date.now()}` },
      });
      bottomCategoryName = catBottom.name;

      await prisma.product.createMany({
        data: [
          {
            storeId: store.id,
            name: '저렴한 반팔티',
            price: 10000,
            categoryId: catTop.id,
            image: 'img1',
            createdAt: new Date('2023-01-01'),
            reviewsCount: 10,
          },
          {
            storeId: store.id,
            name: '고급 가디건',
            price: 50000,
            categoryId: catTop.id,
            image: 'img2',
            createdAt: new Date('2023-01-02'),
            reviewsCount: 50,
          },
          {
            storeId: store.id,
            name: '청바지',
            price: 30000,
            categoryId: catBottom.id,
            image: 'img3',
            createdAt: new Date('2023-01-03'),
            reviewsCount: 5,
          },
        ],
      });
    });

    it('200: 카테고리로 필터링한다', async () => {
      const res = await testClient.get(`/api/products?categoryName=${bottomCategoryName}`);
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
      expect(res.body.list[0].name).toBe('청바지');
    });

    it('200: 가격 범위로 필터링한다 (priceMin, priceMax)', async () => {
      const res = await testClient.get('/api/products?priceMin=20000&priceMax=60000');

      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(2);

      const names = res.body.list.map((p: { name: string }) => p.name);
      expect(names).toContain('고급 가디건');
      expect(names).toContain('청바지');
    });

    it('200: 상품명으로 검색한다 (search)', async () => {
      const res = await testClient.get('/api/products?search=반팔티');
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(1);
      expect(res.body.list[0].name).toBe('저렴한 반팔티');
    });

    it('200: 가격 낮은 순으로 정렬한다 (lowPrice)', async () => {
      const res = await testClient.get('/api/products?sort=lowPrice');
      expect(res.status).toBe(200);
      const prices = res.body.list.map((p: { price: number }) => p.price);
      expect(prices).toEqual([10000, 30000, 50000]);
    });

    it('200: 최신 등록 순으로 정렬한다 (recent)', async () => {
      const res = await testClient.get('/api/products?sort=recent');
      expect(res.status).toBe(200);
      const names = res.body.list.map((p: { name: string }) => p.name);
      expect(names).toEqual(['청바지', '고급 가디건', '저렴한 반팔티']);
    });
  });

  // --- 상품 상세 조회 테스트 ---
  describe('GET /api/products/:productId', () => {
    it('200: 상품 상세 정보를 조회한다', async () => {
      const store = await createTestStore(ctx.seller.id);
      const product = await prisma.product.create({
        data: {
          storeId: store.id,
          name: '상세보기 상품',
          price: 10000,
          categoryId,
          image: 'img',
        },
      });

      const res = await testClient.get(`/api/products/${product.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(product.id);
      expect(res.body.name).toBe('상세보기 상품');
    });

    it('404: 존재하지 않는 상품 ID 조회 시 실패한다', async () => {
      const validCuid = 'clq5y6z8w000008l5gu9e0q1z';
      const res = await testClient.get(`/api/products/${validCuid}`);
      expect(res.status).toBe(404);
    });
  });

  // --- 상품 수정 테스트 ---
  describe('PATCH /api/products/:productId', () => {
    let productId: string;

    beforeEach(async () => {
      const store = await createTestStore(ctx.seller.id);
      const product = await prisma.product.create({
        data: {
          storeId: store.id,
          name: '수정 전 이름',
          price: 10000,
          categoryId,
          image: 'img',
        },
      });
      productId = product.id;
    });

    it('200: 판매자가 자신의 상품 정보를 수정한다', async () => {
      const updateBody: UpdateProductDto = {
        id: productId,
        name: '수정 후 이름',
        price: 20000,
        content: '수정된 내용',
        image: 'https://example.com/updated.jpg',
        categoryName: categoryName,
        discountRate: 0,
        discountStartTime: null,
        discountEndTime: null,
        isSoldOut: false,
        stocks: [{ sizeId: sizeId, quantity: 50 }],
      };

      const res = await authRequest(sellerToken)
        .patch(`/api/products/${productId}`)
        .send(updateBody);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('수정 후 이름');

      const updated = await prisma.product.findUnique({ where: { id: productId } });
      expect(updated?.price).toBe(20000);
    });

    it('403: 다른 판매자가 수정 시도 시 권한 없음 에러 발생', async () => {
      const updateBody: UpdateProductDto = {
        id: productId,
        name: '해킹 시도',
        price: 20000,
        content: '수정된 내용',
        image: 'https://example.com/updated.jpg',
        categoryName: categoryName,
        discountRate: 0,
        discountStartTime: null,
        discountEndTime: null,
        isSoldOut: false,
        stocks: [{ sizeId: sizeId, quantity: 50 }],
      };

      const res = await authRequest(otherSellerToken)
        .patch(`/api/products/${productId}`)
        .send(updateBody);

      expect(res.status).toBe(403);
    });

    it('401: 인증 토큰이 없으면 실패한다', async () => {
      const res = await testClient.patch(`/api/products/${productId}`).send({});
      expect(res.status).toBe(401);
    });
  });

  // --- 상품 삭제 테스트 ---
  describe('DELETE /api/products/:productId', () => {
    let productId: string;

    beforeEach(async () => {
      const store = await createTestStore(ctx.seller.id);
      const product = await prisma.product.create({
        data: {
          storeId: store.id,
          name: '삭제 대상',
          price: 10000,
          categoryId,
          image: 'img',
        },
      });
      productId = product.id;
    });

    it('204: 판매자가 자신의 상품을 삭제한다', async () => {
      const res = await authRequest(sellerToken).delete(`/api/products/${productId}`);

      // 명세에 따라 204 확인
      expect(res.status).toBe(204);

      const deleted = await prisma.product.findUnique({ where: { id: productId } });
      expect(deleted).toBeNull();
    });

    it('403: 구매자가 삭제 시도 시 권한 없음 에러 발생', async () => {
      const res = await authRequest(buyerToken).delete(`/api/products/${productId}`);
      expect(res.status).toBe(403);
    });

    it('401: 인증 토큰이 없으면 실패한다', async () => {
      const res = await testClient.delete(`/api/products/${productId}`);
      expect(res.status).toBe(401);
    });
  });
});
