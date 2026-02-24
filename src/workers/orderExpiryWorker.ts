import { logger } from '@/config/logger.js';
import { orderService } from '@/domains/order/order.container.js';
import { Worker } from 'bullmq';
import { redisClient } from '@/config/redis.js';

logger.info('👷 주문 만료 처리 워커(BullMQ)가 시작되었습니다.');

const worker = new Worker(
  'OrderExpireQueue',
  async (job) => {
    const { orderId } = job.data;

    logger.info(`🚨 만료된 주문 처리 시작! ID: ${orderId}`);

    try {
      // DB 트랜잭션으로 취소 및 재고 복구 처리
      await orderService.expireWaitingOrder(orderId);
      logger.info(`✅ 주문 ${orderId} 만료 처리 완료`);
    } catch (error) {
      logger.error(`❌ 주문 ${orderId} 처리 실패: ${error}`);
      throw error; // 에러를 던지면 BullMQ가 설정에 따라 자동 재시도(Retry) 함
    }
  },
  {
    connection: redisClient,
    concurrency: 5, // 이 워커 인스턴스 하나가 동시에 처리할 작업 수
  },
);

worker.on('failed', (job, err) => {
  logger.error(`작업 ${job?.id} 최종 실패: ${err.message}`);
});
