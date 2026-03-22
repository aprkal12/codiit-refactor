import { loadEnvFromSSM } from '@/config/loadEnv.js';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

export async function startOrderExpiryWorker() {
  await loadEnvFromSSM();

  // 환경변수가 세팅된 이후에 내부 모듈들 동적 임포트
  const { env } = await import('@/config/constants.js');
  const { logger } = await import('@/config/logger.js');
  const { orderService } = await import('@/domains/order/order.container.js');
  const { putMetric } = await import('@/common/utils/cloudwatch.util.js');
  const { orderQueue } = await import('@/config/redis.js');

  // 큐와 워커가 동일한 redis 인스턴스를 공유하면 안됨
  // 만료처리하느라 락 걸렸을 때 동시에 결제 대기 건이 생기는 경우 락 때문에 redis에 업로드 안되는 상황 발생 가능
  const workerConnection = new Redis(env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  setInterval(async () => {
    try {
      const jobCounts = await orderQueue.getJobCounts('wait', 'delayed', 'active', 'failed');

      putMetric('codiit/Worker', 'BullMQ_WaitQueueLength', jobCounts.wait, 'Count');
      putMetric('codiit/Worker', 'BullMQ_FailedQueueLength', jobCounts.failed, 'Count');
    } catch (error) {
      logger.error(`큐 상태 모니터링 중 에러: ${error}`);
    }
  }, 60000);

  logger.info('[Monitor] BullMQ 상태 모니터링이 시작되었습니다.');

  // BullMQ 워커 실행
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
        throw error; // 에러를 던지면 자동 재시도
      }
    },
    {
      connection: workerConnection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`작업 ${job?.id} 최종 실패: ${err.message}`);
  });
}

// 워커 실행
startOrderExpiryWorker();
