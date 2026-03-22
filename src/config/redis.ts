import { Redis } from 'ioredis';
import { logger } from './logger.js';
import { env } from './constants.js';
import { Queue } from 'bullmq';

const redisUrl = env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new Redis(redisUrl);

export const orderQueue = new Queue('OrderExpireQueue', {
  connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
});

redisClient.on('connect', () => logger.info('Redis Connected!'));
redisClient.on('error', (err) => logger.error(`Redis Client Error: ${err}`));
