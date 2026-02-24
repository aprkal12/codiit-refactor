import prisma from '@/config/prisma.js';
import { PaymentRepository } from '@/domains/payment/payment.repository.js';
import { PaymentService } from '@/domains/payment/payment.service.js';
import { PaymentController } from '@/domains/payment/payment.controller.js';
import { OrderService } from '@/domains/order/order.service.js';
import { OrderRepository } from '@/domains/order/order.repository.js';
import { notificationService } from '@/domains/notification/notification.container.js';
import { UserService } from '@/domains/user/user.service.js';
import { sseManager } from '@/common/utils/sse.manager.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { orderQueue } from '@/config/redis.js';

const paymentRepository = new PaymentRepository(prisma);
const orderRepository = new OrderRepository(prisma);
const userRepository = new UserRepository();
const userService = new UserService(userRepository);
const orderService = new OrderService(
  orderRepository,
  notificationService,
  prisma,
  userService,
  sseManager,
  orderQueue,
);
const paymentService = new PaymentService(paymentRepository, orderService);
export const paymentController = new PaymentController(paymentService);
