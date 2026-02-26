import { Request, Response, NextFunction } from 'express';
import { putMetric } from '@/common/utils/cloudwatch.util.js';

export const metricMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    // 1. API 응답 지연 시간(Latency) 전송
    putMetric('codiit/API', 'ApiLatency', duration, 'Milliseconds');

    // 2. 5xx 에러 발생 시 카운트 증가
    if (statusCode >= 500) {
      putMetric('codiit/API', '5xxErrorCount', 1, 'Count');
    }
  });

  next();
};
