import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { pinoHttp } from 'pino-http';
import cookieParser from 'cookie-parser';
import { logger } from '@/config/logger.js';
import { prismaErrorHandler } from '@/common/middlewares/errorHandlers/prismaErrorHandler.js';
import { zodErrorHandler } from '@/common/middlewares/errorHandlers/zodErrorHandler.js';
import { catchAllErrorHandler } from '@/common/middlewares/errorHandlers/catchAllErrorHandler.js';
import { businessErrorHandler } from '@/common/middlewares/errorHandlers/businessErrorHandler.js';
import { uploadErrorHandler } from '@/common/middlewares/errorHandlers/uploadErrorHandler.js';
import { env } from '@/config/constants.js';
import { globalRateLimiter } from '@/common/middlewares/rateLimit.middleware.js';

// 라우터 import
import authRouter from '@/domains/auth/auth.router.js';
import userRouter from '@/domains/user/user.router.js';
import { storeRouter } from '@/domains/store/store.router.js';
import productRouter from '@/domains/product/product.router.js';
import cartRouter from '@/domains/cart/cart.router.js';
import orderRouter from '@/domains/order/order.router.js';
import { inquiryRouter } from '@/domains/inquiry/inquiry.router.js';
import { reviewRouter } from '@/domains/review/review.router.js';
import { notificationRouter } from '@/domains/notification/notification.router.js';
import dashboardRouter from '@/domains/dashboard/dashboard.router.js';
import metadataRouter from '@/domains/metadata/metadata.router.js';
import s3Router from '@/domains/s3/s3.router.js';
import paymentRouter from '@/domains/payment/payment.router.js';
import testRouter from '@/domains/test/test.router.js';
import { metricMiddleware } from '@/common/middlewares/metric.middleware.js';

// Swagger
import swaggerUi from 'swagger-ui-express';
import { specs } from '@/documentation/swagger.config.js';

const app = express();

// trust proxy
app.set('trust proxy', 2);

// 보안 미들웨어
app.use(helmet());

// HTTP 요청 로깅 (환경별 분기)
if (env.NODE_ENV === 'development') {
  // 개발 환경: morgan으로 읽기 쉬운 컬러 로그
  app.use(morgan('dev'));
} else if (env.NODE_ENV === 'production') {
  // 프로덕션 환경: pino로 구조화된 JSON 로그
  app.use(
    pinoHttp({
      logger,
      // 로그 레벨 커스터마이징
      customLogLevel: (req: Request, res: Response, err?: Error) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Health check 요청은 로그 생략 (불필요한 로그 방지)
      autoLogging: {
        ignore: (req: Request) => req.url === '/api/health',
      },
    }),
  );
}
// 테스트 환경(test): HTTP 로거 사용하지 않음 (clean test output)

// 기본 미들웨어
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(metricMiddleware);

// Health check (Rate limit 제외)
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
  });
});

// Global Rate Limiting
app.use('/api', globalRateLimiter);

// 라우터 등록
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/stores', storeRouter);
app.use('/api/products', productRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', orderRouter);
app.use('/api/inquiries', inquiryRouter);
app.use('/api/review', reviewRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/s3', s3Router);
app.use('/api/payment', paymentRouter);

if (env.NODE_ENV !== 'production') {
  app.use('/api/test', testRouter);
}

// Swagger UI
app.use(
  '/api/swagger',
  swaggerUi.serve,
  swaggerUi.setup(specs, {
    customCss: '.swagger-ui .topbar .download-url-wrapper { display: none }',
    customSiteTitle: 'Codiit API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  }),
);

// 404 핸들러
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: 'Not Found' });
});

// 글로벌 에러 핸들러 (항상 마지막에 등록)
app.use(prismaErrorHandler);
app.use(zodErrorHandler);
app.use(uploadErrorHandler);
app.use(businessErrorHandler);
app.use(catchAllErrorHandler);

export { app };
