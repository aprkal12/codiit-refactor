import { prisma } from '@/config/prisma.js';
import { testClient, authRequest } from '../helpers/testClient.js';
import { generateBuyerToken, generateSellerToken } from '../helpers/authHelper.js';
import {
  createTestContext,
  createTestStore,
  createTestBuyer,
  TEST_PASSWORD,
  type TestContext,
} from '../helpers/dataFactory.js';

describe('User API Integration Test', () => {
  let ctx: TestContext;
  let buyerToken: string;
  let sellerToken: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    buyerToken = generateBuyerToken(ctx.buyer.id);
    sellerToken = generateSellerToken(ctx.seller.id);
  });

  // ===== POST /api/users - 회원가입 =====
  describe('POST /api/users', () => {
    const validUserData = {
      name: '신규 유저',
      email: 'newuser@test.com',
      password: 'test1234',
      type: 'BUYER',
    };

    it('201: 구매자 회원가입 성공', async () => {
      const response = await testClient.post('/api/users').send(validUserData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.email).toBe(validUserData.email);
      expect(response.body.name).toBe(validUserData.name);
      expect(response.body.type).toBe('BUYER');
      expect(response.body.points).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
      expect(response.body.image).toBeNull();

      // grade 상세 필드 검증
      expect(response.body.grade).toBeDefined();
      expect(response.body.grade.id).toBe('grade_green');
      expect(response.body.grade.name).toBe('green');
      expect(response.body.grade.rate).toBeDefined();
      expect(response.body.grade.minAmount).toBeDefined();

      // DB 검증
      const user = await prisma.user.findUnique({
        where: { email: validUserData.email },
      });
      expect(user).not.toBeNull();
      expect(user?.name).toBe(validUserData.name);
    });

    it('201: 판매자 회원가입 성공', async () => {
      const sellerData = {
        ...validUserData,
        email: 'newseller@test.com',
        type: 'SELLER',
      };

      const response = await testClient.post('/api/users').send(sellerData);

      expect(response.status).toBe(201);
      expect(response.body.type).toBe('SELLER');
    });

    it('400: 이름 누락', async () => {
      const response = await testClient.post('/api/users').send({
        email: 'noname@test.com',
        password: 'test1234',
        type: 'BUYER',
      });

      expect(response.status).toBe(400);
    });

    it('400: 이메일 누락', async () => {
      const response = await testClient.post('/api/users').send({
        name: '테스트',
        password: 'test1234',
        type: 'BUYER',
      });

      expect(response.status).toBe(400);
    });

    it('400: 비밀번호 누락', async () => {
      const response = await testClient.post('/api/users').send({
        name: '테스트',
        email: 'nopassword@test.com',
        type: 'BUYER',
      });

      expect(response.status).toBe(400);
    });

    it('400: 유저 타입 누락', async () => {
      const response = await testClient.post('/api/users').send({
        name: '테스트',
        email: 'notype@test.com',
        password: 'test1234',
      });

      expect(response.status).toBe(400);
    });

    it('400: 유효하지 않은 이메일 형식', async () => {
      const response = await testClient.post('/api/users').send({
        ...validUserData,
        email: 'invalid-email',
      });

      expect(response.status).toBe(400);
    });

    it('400: 비밀번호 8자 미만', async () => {
      const response = await testClient.post('/api/users').send({
        ...validUserData,
        email: 'shortpw@test.com',
        password: '1234567',
      });

      expect(response.status).toBe(400);
    });

    it('409: 중복 이메일', async () => {
      const response = await testClient.post('/api/users').send({
        ...validUserData,
        email: ctx.buyer.email, // 이미 존재하는 이메일
      });

      expect(response.status).toBe(409);
    });
  });

  // ===== GET /api/users/me - 내 정보 조회 =====
  describe('GET /api/users/me', () => {
    it('200: 내 정보 조회 성공', async () => {
      const response = await authRequest(buyerToken).get('/api/users/me');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(ctx.buyer.id);
      expect(response.body.email).toBe(ctx.buyer.email);
      expect(response.body.name).toBe(ctx.buyer.name);
      expect(response.body.type).toBe('BUYER');
      expect(response.body.points).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
      expect(response.body.image).toBeDefined();

      // grade 상세 필드 검증 (rate는 mapper에서 * 100 변환됨)
      expect(response.body.grade).toBeDefined();
      expect(response.body.grade.id).toBeDefined();
      expect(response.body.grade.name).toBeDefined();
      expect(response.body.grade.rate).toBeDefined();
      expect(response.body.grade.minAmount).toBeDefined();
    });

    it('200: 판매자 내 정보 조회 성공', async () => {
      const response = await authRequest(sellerToken).get('/api/users/me');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(ctx.seller.id);
      expect(response.body.type).toBe('SELLER');
    });

    it('401: 인증 없이 요청', async () => {
      const response = await testClient.get('/api/users/me');

      expect(response.status).toBe(401);
    });

    it('401: 유효하지 않은 토큰', async () => {
      const response = await testClient
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });

  // ===== PATCH /api/users/me - 내 정보 수정 =====
  describe('PATCH /api/users/me', () => {
    it('200: 이름 수정 성공', async () => {
      const updateData = {
        name: '변경된 이름',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('변경된 이름');

      // DB 검증
      const user = await prisma.user.findUnique({ where: { id: ctx.buyer.id } });
      expect(user?.name).toBe('변경된 이름');
    });

    it('200: 비밀번호 수정 성공', async () => {
      const updateData = {
        password: 'newpassword123',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(200);
    });

    it('200: 이름과 비밀번호 동시 수정 성공', async () => {
      const updateData = {
        name: '새로운 이름',
        password: 'newpassword123',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('새로운 이름');
    });

    it('400: 수정할 내용 없음 (currentPassword만 제공)', async () => {
      const updateData = {
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(400);
    });

    it('400: currentPassword 누락', async () => {
      const updateData = {
        name: '변경된 이름',
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(400);
    });

    it('400: 새 비밀번호 8자 미만', async () => {
      const updateData = {
        password: '1234567',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(400);
    });

    it('401: 인증 없이 요청', async () => {
      const response = await testClient.patch('/api/users/me').send({
        name: '변경된 이름',
        currentPassword: TEST_PASSWORD,
      });

      expect(response.status).toBe(401);
    });

    it('403: 현재 비밀번호 불일치', async () => {
      const updateData = {
        name: '변경된 이름',
        currentPassword: 'wrongpassword',
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(403);
    });

    it('200: 프로필 이미지 수정 성공', async () => {
      const updateData = {
        imageUrl: 'https://example.com/profile.jpg',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.image).toBe('https://example.com/profile.jpg');

      // DB 검증
      const user = await prisma.user.findUnique({ where: { id: ctx.buyer.id } });
      expect(user?.image).toBe('https://example.com/profile.jpg');
    });

    it('400: 유효하지 않은 imageUrl 형식', async () => {
      const updateData = {
        imageUrl: 'invalid-url',
        currentPassword: TEST_PASSWORD,
      };

      const response = await authRequest(buyerToken).patch('/api/users/me').send(updateData);

      expect(response.status).toBe(400);
    });
  });

  // ===== GET /api/users/me/likes - 관심 스토어 조회 =====
  describe('GET /api/users/me/likes', () => {
    it('200: 관심 스토어 목록 조회 성공', async () => {
      // 스토어 생성 및 관심 등록
      const store = await createTestStore(ctx.seller.id);
      await prisma.storeLike.create({
        data: { userId: ctx.buyer.id, storeId: store.id },
      });

      const response = await authRequest(buyerToken).get('/api/users/me/likes');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].store).toBeDefined();
      expect(response.body[0].store.id).toBe(store.id);
    });

    it('200: 관심 스토어 없음 - 빈 배열 반환', async () => {
      const response = await authRequest(buyerToken).get('/api/users/me/likes');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('200: 여러 관심 스토어 조회', async () => {
      // 다른 판매자 생성
      const anotherSeller = await createTestBuyer(ctx.grade.id, {
        email: 'seller2@test.com',
      });
      await prisma.user.update({
        where: { id: anotherSeller.id },
        data: { type: 'SELLER' },
      });

      // 스토어 2개 생성 및 관심 등록
      const store1 = await createTestStore(ctx.seller.id, { name: '스토어1' });
      const store2 = await createTestStore(anotherSeller.id, { name: '스토어2' });

      await prisma.storeLike.createMany({
        data: [
          { userId: ctx.buyer.id, storeId: store1.id },
          { userId: ctx.buyer.id, storeId: store2.id },
        ],
      });

      const response = await authRequest(buyerToken).get('/api/users/me/likes');

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
    });

    it('401: 인증 없이 요청', async () => {
      const response = await testClient.get('/api/users/me/likes');

      expect(response.status).toBe(401);
    });
  });

  // ===== DELETE /api/users/delete - 회원 탈퇴 =====
  describe('DELETE /api/users/delete', () => {
    it('200: 회원 탈퇴 성공', async () => {
      // 새로운 유저 생성 (기존 ctx.buyer는 다른 테스트에 영향)
      const newBuyer = await createTestBuyer(ctx.grade.id, { email: 'tobedeleted@test.com' });
      const newBuyerToken = generateBuyerToken(newBuyer.id);

      const response = await authRequest(newBuyerToken).delete('/api/users/delete');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('회원 탈퇴가 완료되었습니다.');

      // refreshToken 쿠키 클리어 확인
      const rawCookies = response.headers['set-cookie'];
      const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
      const refreshTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith('refreshToken='),
      );
      if (refreshTokenCookie) {
        expect(
          refreshTokenCookie.includes('refreshToken=;') ||
            refreshTokenCookie.includes('Expires=Thu, 01 Jan 1970'),
        ).toBe(true);
      }

      // DB에서 삭제 확인
      const deletedUser = await prisma.user.findUnique({ where: { id: newBuyer.id } });
      expect(deletedUser).toBeNull();
    });

    it('401: 인증 없이 요청', async () => {
      const response = await testClient.delete('/api/users/delete');

      expect(response.status).toBe(401);
    });

    it('200: 판매자 회원 탈퇴 성공', async () => {
      // 새로운 판매자 생성
      const newSeller = await prisma.user.create({
        data: {
          name: '탈퇴할 판매자',
          email: 'sellertodelete@test.com',
          password: 'hashedpassword',
          type: 'SELLER',
          gradeId: ctx.grade.id,
        },
      });
      const newSellerToken = generateSellerToken(newSeller.id);

      const response = await authRequest(newSellerToken).delete('/api/users/delete');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('회원 탈퇴가 완료되었습니다.');
    });
  });
});
