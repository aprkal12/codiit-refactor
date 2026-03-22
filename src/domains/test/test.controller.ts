import { Request, Response } from 'express';
import { OrderService } from '@/domains/order/order.service.js';

export class TestController {
  constructor(private orderService: OrderService) {}

  cancelAllWaitingPaymentOrders = async (req: Request, res: Response) => {
    const result = await this.orderService.cancelAllWaitingPaymentOrders();
    res.status(200).json(result);
  };
}
