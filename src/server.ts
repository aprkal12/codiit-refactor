import http from 'http';
import { loadEnvFromSSM } from '@/config/loadEnv.js';

async function startServer() {
  // aws ssm에서 환경변수 먼저 로드
  await loadEnvFromSSM();

  const { app } = await import('@/app.js');
  const { env } = await import('@/config/constants.js');
  const { logger } = await import('@/config/logger.js');
  const { prisma } = await import('@/config/prisma.js');
  const { sseManager } = await import('@/common/utils/sse.manager.js');

  // HTTP 서버 생성 (graceful shutdown을 위해 명시적 생성)
  const server = http.createServer(app);

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server is running on http://localhost:${env.PORT}`);
    logger.info(`📦 Environment: ${env.NODE_ENV}`);
  });

  // Graceful Shutdown 핸들러
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string, timeout: number = 30000) => {
    // 중복 shutdown 방지
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.warn(`\n⚠️  ${signal} received. Starting graceful shutdown...`);

    // SSE 연결 먼저 종료
    sseManager.closeAll();

    // 새 연결 거부 (진행 중인 요청은 완료까지 대기)
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, '❌ Error during server close');
        process.exit(1);
      }

      logger.info('✅ HTTP server closed (no new connections)');

      try {
        // Prisma 커넥션 종료
        await prisma.$disconnect();
        logger.info('✅ Database connections closed');

        logger.info('🎉 Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, '❌ Error during database disconnect');
        process.exit(1);
      }
    });

    // 타임아웃: 지정된 시간 내 종료 안 되면 강제 종료
    setTimeout(() => {
      logger.error(`⏰ Shutdown timeout (${timeout / 1000}s) - forcing exit`);
      process.exit(1);
    }, timeout);
  };

  // SIGTERM: Docker stop 시 수신 (정상 종료 - 30초 여유)
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 30000));

  // SIGINT: Ctrl+C (로컬 개발용 - 30초 여유)
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 30000));

  // 예상치 못한 에러 처리 (비정상 상태 - 10초만 대기)
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, '💥 Uncaught Exception');
    gracefulShutdown('uncaughtException', 10000);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, '💥 Unhandled Rejection');
    gracefulShutdown('unhandledRejection', 10000);
  });
}

startServer().catch((err) => {
  console.error('💥 Failed to start server:', err);
  process.exit(1);
});
