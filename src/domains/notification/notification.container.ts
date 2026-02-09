import { prisma } from '@/config/prisma.js';
import { NotificationController } from './notification.controller.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';

// 의존성 주입
const notificationRepository = new NotificationRepository(prisma);
export const notificationService = new NotificationService(notificationRepository);

export const notificationController = new NotificationController(notificationService);
