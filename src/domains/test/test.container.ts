import { orderService } from '@/domains/order/order.container.js';
import { TestController } from './test.controller.js';

export const testController = new TestController(orderService);
