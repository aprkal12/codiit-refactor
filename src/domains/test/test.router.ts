import { Router } from 'express';
import { asyncHandler } from '@/common/middlewares/asyncHandler.js';
import { testController } from './test.container.js';

const testRouter = Router();

testRouter.delete('/orders', asyncHandler(testController.cancelAllWaitingPaymentOrders));

export default testRouter;
