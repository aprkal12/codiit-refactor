import { PrismaClient } from '@prisma/client';
import { env } from '@/config/constants.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
