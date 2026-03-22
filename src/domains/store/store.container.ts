import { prisma } from '@/config/prisma.js';
import { StoreController } from './store.controller.js';
import { StoreRepository } from './store.repository.js';
import { StoreService } from './store.service.js';

// 의존성 주입
const storeRepository = new StoreRepository(prisma);
const storeService = new StoreService(storeRepository);

export const storeController = new StoreController(storeService);
