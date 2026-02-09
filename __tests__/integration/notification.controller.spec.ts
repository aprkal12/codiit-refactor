import type { IncomingMessage } from 'http';
import { prisma } from '@/config/prisma.js';
import { testClient, authRequest } from '../helpers/testClient.js';
import { generateBuyerToken } from '../helpers/authHelper.js';
import {
  createTestContext,
  createTestNotification,
  type TestContext,
} from '../helpers/dataFactory.js';
import type { Notification } from '@prisma/client';

describe('Notification API Integration Test', () => {
  let ctx: TestContext;
  let otherCtx: TestContext;
  let buyerToken: string;
  let otherBuyerToken: string;

  let notification: Notification;

  beforeEach(async () => {
    // 기본 유저 생성
    ctx = await createTestContext();
    buyerToken = generateBuyerToken(ctx.buyer.id);
    // 다른 유저 생성
    otherCtx = await createTestContext();
    otherBuyerToken = generateBuyerToken(otherCtx.buyer.id);
  });

  // =================================================================
  // 사용자 모든 알림 조회
  // =================================================================
  describe('GET /api/notifications', () => {
    beforeEach(async () => {
      notification = await createTestNotification(ctx.buyer.id);
    });

    it('200: 알림 목록 조회 성공', async () => {
      const response = await authRequest(buyerToken).get('/api/notifications');

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get('/api/notifications');
      expect(response.status).toBe(401);
    });

    it('200: 페이지네이션 적용', async () => {
      await createTestNotification(ctx.buyer.id);
      await createTestNotification(ctx.buyer.id);

      const response = await authRequest(buyerToken).get('/api/notifications?page=1&pageSize=2');

      expect(response.status).toBe(200);
      expect(response.body.list).toHaveLength(2);
      expect(response.body.totalCount).toBe(3);
    });
  });

  // =================================================================
  // sse 연결
  // =================================================================
  describe('GET /api/notifications/sse', () => {
    it('200: SSE 연결 성공 및 헤더 검증', async () => {
      const req = authRequest(buyerToken)
        .get('/api/notifications/sse')
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache')
        .expect('Connection', 'keep-alive')
        .buffer(false);

      // sse 연결 강제 종료
      req.parse((res, callback) => {
        (res as unknown as IncomingMessage).destroy();
        callback(null, {});
      });

      // sse 강제 종료로 생길 수 있는 에러 무시 하는 로직
      try {
        await req;
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE')
        ) {
          return;
        }
        throw err;
      }
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.get('/api/notifications/sse');
      expect(response.status).toBe(401);
    });
  });

  // =================================================================
  // 알림 수정 (읽음 처리)
  // =================================================================
  describe('PATCH /api/notifications/:id/check', () => {
    beforeEach(async () => {
      notification = await createTestNotification(ctx.buyer.id);
    });

    it('200: 알림 수정 성공', async () => {
      const response = await authRequest(buyerToken).patch(
        `/api/notifications/${notification.id}/check`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(notification.id);
      expect(response.body.isChecked).toBe(true);

      // DB에 실제로 데이터가 수정되었는지 확인
      const dbNotification = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(dbNotification!.isChecked).toBe(true);
    });

    it('401: 인증 없이 요청 시 실패', async () => {
      const response = await testClient.patch(`/api/notifications/${notification.id}/check`);
      expect(response.status).toBe(401);
    });

    it('404: 존재하지 않는 알림 수정 실패', async () => {
      const response = await authRequest(buyerToken).patch(
        '/api/notifications/clx1j9v5o000008l4cz6g3sds/check',
      );
      expect(response.status).toBe(404);
    });

    it('403: 본인 아닌 다른 사용자는 알림 수정 실패', async () => {
      const response = await authRequest(otherBuyerToken).patch(
        `/api/notifications/${notification.id}/check`,
      );
      expect(response.status).toBe(403);
    });

    it('200: 이미 확인된 알림도 알림 수정 성공', async () => {
      // 1번째 수정
      const firstResponse = await authRequest(buyerToken).patch(
        `/api/notifications/${notification.id}/check`,
      );
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.isChecked).toBe(true);

      // 2번째 수정
      const secondResponse = await authRequest(buyerToken).patch(
        `/api/notifications/${notification.id}/check`,
      );
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.isChecked).toBe(true);

      // DB에 실제로 데이터가 수정되었는지 확인
      const dbNotification = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(dbNotification!.isChecked).toBe(true);
    });
  });
});
