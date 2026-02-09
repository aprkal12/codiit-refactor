import { prisma } from '@/config/prisma.js';
import { generateBuyerToken, generateSellerToken } from '../helpers/authHelper.js';
import {
  createTestBuyer,
  createTestCart,
  createTestCategory,
  createTestContext,
  createTestProduct,
  createTestStore,
  TestContext,
} from '../helpers/dataFactory.js';
import { authRequest, testClient } from '../helpers/testClient.js';
import { createGetCartItemMock } from '../mocks/cart.mock.js';

describe('Cart API Integration Test', () => {
  let ctx: TestContext;
  let buyerId: string;
  let sellerId: string;
  let otherId: string;
  let buyerToken: string;
  let sellerToken: string;
  let otherToken: string;

  let storeId: string;
  let categoryId: string;
  let productId: string;
  let sizeId: number;

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
  });

  describe('GET /api/cart', () => {
    it('200: 장바구니 조회', async () => {
      // given
      await createTestCart({
        buyerId,
        items: [createGetCartItemMock({ productId })],
      });

      // when
      const res = await authRequest(buyerToken).get('/api/cart');

      // then
      expect(res.status).toBe(200);
      expect(res.body.items).not.toBeNull();
      expect(res.body.items[0].product).not.toBeNull();
      expect(res.body.items[0].product.store).not.toBeNull();
      expect(res.body.items[0].product.stocks).not.toBeNull();
      expect(res.body.items[0].product.stocks[0].size).not.toBeNull();
    });
    it('200: 장바구니가 없는 경우 빈 배열을 반환한다.', async () => {
      // when
      const res = await authRequest(buyerToken).get('/api/cart');

      // then
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
    it('401: 인증되지 않은 사용자는 장바구니를 조회 할 수 없다.', async () => {
      // when
      const res = await testClient.get('/api/cart');
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 장바구니를 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).get('/api/cart');
      // then
      expect(res.status).toBe(403);
    });
  });
  describe('POST /api/cart', () => {
    it('201: 장바구니 생성', async () => {
      // when
      const res = await authRequest(buyerToken).post('/api/cart');

      // then
      expect(res.status).toBe(201);
      expect(res.body.buyerId).toBe(buyerId);
    });
    it('201: 이미 장바구니가 존재하는 경우 해당 장바구니 반환', async () => {
      // given
      await createTestCart({
        buyerId,
        items: [createGetCartItemMock({ productId })],
      });

      // when
      const res = await authRequest(buyerToken).post('/api/cart');

      // then
      expect(res.status).toBe(201);
      expect(res.body.buyerId).toBe(buyerId);
    });
    it('401: 인증되지 않은 사용자는 장바구니를 생성 할 수 없다.', async () => {
      // when
      const res = await testClient.post('/api/cart');
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 장바구니를 생성 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).post('/api/cart');
      // then
      expect(res.status).toBe(403);
    });
  });
  describe('PATCH /api/cart', () => {
    it('200: 장바구니 아이템 추가', async () => {
      // 현재 상품의 재고보다 장바구니에 아이템 수량을 더 많이 담는 것도 가능
      // 장바구니는 여러 사용자들이 자주 담았다가 빼니 주문 시점에만 재고를 체크하는게 자연스러움
      // 주문에서 재고 체크를 엄격하게 하고 장바구니 담기 자체는 허용
      // given
      const savedCart = await createTestCart({
        buyerId,
        // 아이템 없는 빈 장바구니 생성
      });
      const input = {
        productId,
        sizes: [
          {
            sizeId,
            quantity: 1,
          },
        ],
      };

      // when
      const res = await authRequest(buyerToken).patch(`/api/cart`).send(input);

      // then
      expect(res.status).toBe(200);
      expect(res.body[0].cartId).toBe(savedCart.id);
      expect(res.body[0].productId).toBe(productId);
      expect(res.body[0].sizeId).toBe(1);
      expect(res.body[0].quantity).toBe(1);
    });
    it('200: 장바구니 아이템 수정', async () => {
      // given
      const savedCart = await createTestCart({
        buyerId,
        items: [createGetCartItemMock({ productId })],
      });
      const input = {
        productId,
        sizes: [
          {
            sizeId,
            quantity: 3, // 수량을 3개로 수정
          },
        ],
      };

      // when
      const res = await authRequest(buyerToken).patch(`/api/cart`).send(input);

      // then
      expect(res.status).toBe(200);
      expect(res.body[0].cartId).toBe(savedCart.id);
      expect(res.body[0].productId).toBe(productId);
      expect(res.body[0].sizeId).toBe(1);
      expect(res.body[0].quantity).toBe(3);
    });
    it('400: 수량이 0 이하면 장바구니에 추가 할 수 없다.', async () => {
      // given
      const input = {
        productId,
        sizes: [
          {
            sizeId,
            quantity: -1,
          },
        ],
      };

      // when
      const res = await authRequest(buyerToken).patch(`/api/cart`).send(input);

      // then
      expect(res.status).toBe(400);
    });
    it('400: 장바구니가 없는 경우 수정 할 수 없다.', async () => {
      // 현재 프론트에서는 장바구니 수정 전 무조건 생성부터 호출함
      // 일반적인 에러 케이스 테스트
      // given
      const input = {
        productId,
        sizes: [
          {
            sizeId,
            quantity: 1,
          },
        ],
      };

      // when
      const res = await authRequest(buyerToken).patch(`/api/cart`).send(input);

      // then
      expect(res.status).toBe(400);
    });
    it('401: 인증되지 않은 사용자는 장바구니를 수정 할 수 없다.', async () => {
      // when
      const res = await testClient.patch('/api/cart');
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 장바구니를 수정 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).patch('/api/cart');
      // then
      expect(res.status).toBe(403);
    });
  });
  describe('GET /api/cart/:cartItemId', () => {
    let savedCartId: string;
    let savedCartItemId: string;

    beforeEach(async () => {
      const savedCart = await createTestCart({
        buyerId,
        items: [createGetCartItemMock({ productId })],
      });
      savedCartId = savedCart.id;
      savedCartItemId = savedCart.items[0].id;
    });
    it('200: 장바구니 아이템 상세 조회', async () => {
      // when
      const res = await authRequest(buyerToken).get(`/api/cart/${savedCartItemId}`);

      // then
      expect(res.status).toBe(200);
      expect(res.body.cartId).toBe(savedCartId);
      expect(res.body.sizeId).toBe(sizeId);
      expect(res.body.quantity).toBe(1);
      expect(res.body.product).not.toBeNull();
      expect(res.body.cart.buyerId).toBe(buyerId);
    });
    it('401: 인증되지 않은 사용자는 장바구니 아이템을 조회 할 수 없다.', async () => {
      // when
      const res = await testClient.get('/api/cart/test'); // zod 스키마 도달 전 에러라 cuid 형식이 아니어도 됨
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 장바구니 아이템을 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).get('/api/cart/test'); // zod 스키마 도달 전 에러라 cuid 형식이 아니어도 됨
      // then
      expect(res.status).toBe(403);
    });
    it('403: 본인 장바구니가 아닌 경우 아이템을 상세 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(otherToken).get(`/api/cart/${savedCartItemId}`);

      // then
      expect(res.status).toBe(403);
    });
    it('404: 장바구니에 해당 아이템이 없을 경우 아이템을 상세 조회 할 수 없다.', async () => {
      // when
      const res = await authRequest(buyerToken).get(`/api/cart/${savedCartItemId}error`);

      // then
      expect(res.status).toBe(404);
    });
  });
  describe('DELETE /api/cart/:cartItemId', () => {
    let savedCartItemId: string;
    beforeEach(async () => {
      const savedCart = await createTestCart({
        buyerId,
        items: [createGetCartItemMock({ productId })],
      });
      savedCartItemId = savedCart.items[0].id;
    });
    it('204: 장바구니 아이템 삭제', async () => {
      // when
      const res = await authRequest(buyerToken).delete(`/api/cart/${savedCartItemId}`);

      // then
      expect(res.status).toBe(204);
      const deletedItem = await prisma.cartItem.findUnique({
        where: { id: savedCartItemId },
      });
      expect(deletedItem).toBeNull();
    });
    it('401: 인증되지 않은 사용자는 장바구니 아이템을 삭제 할 수 없다.', async () => {
      // when
      const res = await testClient.delete('/api/cart/test'); // zod 스키마 도달 전 에러라 cuid 형식이 아니어도 됨
      // then
      expect(res.status).toBe(401);
    });
    it('403: 판매자는 장바구니 아이템을 삭제 할 수 없다.', async () => {
      // when
      const res = await authRequest(sellerToken).delete('/api/cart/test'); // zod 스키마 도달 전 에러라 cuid 형식이 아니어도 됨
      // then
      expect(res.status).toBe(403);
    });
    it('403: 본인 장바구니가 아닌 경우 아이템을 삭제 할 수 없다.', async () => {
      // when
      const res = await authRequest(otherToken).delete(`/api/cart/${savedCartItemId}`);

      // then
      expect(res.status).toBe(403);
    });
    it('404: 장바구니에 해당 아이템이 없을 경우 아이템을 삭제 할 수 없다.', async () => {
      // when
      const res = await authRequest(buyerToken).delete(`/api/cart/${savedCartItemId}error`);

      // then
      expect(res.status).toBe(404);
    });
  });
});
