import axios from 'axios';
import { env } from '@/config/constants.js';
import { BadRequestError, InternalServerError, NotFoundError } from '@/common/utils/errors.js';
import { OrderStatus, PaymentMethod, PaymentProvider, PaymentStatus } from '@prisma/client';
import { OrderService } from '@/domains/order/order.service.js';
import { CreatePaymentServiceInput } from '@/domains/payment/payment.dto.js';
import { PaymentRepository } from '@/domains/payment/payment.repository.js';
import { logger } from '@/config/logger.js';
import { handleAxiosError } from '@/common/utils/axiosError.util.js';
import { putMetric } from '@/common/utils/cloudwatch.util.js';

export class PaymentService {
  constructor(
    private paymentRepository: PaymentRepository,
    private orderService: OrderService,
  ) {}
  private readonly PORTONE_BASE_URL = env.PORTONE_API_URL ?? 'https://api.iamport.kr';
  private async getPortoneToken() {
    const response = await axios.post(`${this.PORTONE_BASE_URL}/users/getToken`, {
      imp_key: env.PORTONE_API_KEY,
      imp_secret: env.PORTONE_API_SECRET,
    });
    return response.data.response.access_token;
  }
  private async getExpectedPrice(merchant_uid: string) {
    const payment = await this.paymentRepository.getPaymentPrice(merchant_uid);
    if (!payment) {
      // 이 시점에 결제 정보가 없는 건 서버 내부 문제
      throw new InternalServerError('결제 정보를 찾을 수 없습니다.');
    }
    return payment.price;
  }
  async createPayment({ orderId, ...rest }: CreatePaymentServiceInput) {
    const order = await this.paymentRepository.getOrderInfo(orderId);
    if (!order) {
      throw new NotFoundError();
    }
    if (order.status === OrderStatus.CompletedPayment) {
      throw new BadRequestError('이미 결제완료된 주문입니다.');
    }
    const paymentPrice = order.subtotal - order.usePoint;
    return await this.paymentRepository.createPayment({ orderId, price: paymentPrice, ...rest });
  }
  async paymentCallback(imp_uid: string, merchant_uid: string) {
    try {
      /**
       * STEP 1. 포트원 토큰 발급
       */
      logger.info('[WEBHOOK] 토큰 발급');
      const token = await this.getPortoneToken();

      /**
       * STEP 2. 결제 단건 조회
       */
      logger.info('[WEBHOOK] 결제 단건 조회');
      const { data } = await axios.get(`${this.PORTONE_BASE_URL}/payments/${imp_uid}`, {
        headers: { Authorization: token },
        params: {
          // 포트원의 보안조치로 추가된 파라미터
          // 테스트 채널을 악용한 결제 위변조를 방지하기 위해 기본적으로 테스트 결제 내역은
          // 콘솔이 아닌 api를 통해서는 결제 조회가 불가능 하게 변경됨
          // include_sandbox를 true로 설정해줘야 테스트 결제도 결제 조회 가능 내역에 포함됨
          include_sandbox: true,
        },
      });

      const payment = data.response;

      /**
       * STEP 3. 결제 상태 검증
       */
      if (payment.status === 'ready') {
        logger.info('[WEBHOOK] 결제 미완료 상태 → 무시');
        return { message: '결제 대기 중' };
      }
      if (payment.status === 'failed') {
        logger.info('[WEBHOOK] 결제 실패');
        const failedInfo = {
          errorCode: '400',
          errorMessage: payment.fail_reason,
          failedAt: new Date(payment.failed_at * 1000),
        };
        await this.paymentRepository.updateFailed(merchant_uid, failedInfo);
        return { message: '결제에 실패했습니다' };
      }
      if (payment.status !== 'paid') {
        logger.info('[WEBHOOK] 비정상적 결제 상태 수신');
        return { message: '결제 완료 상태가 아닙니다.' };
      }

      /**
       * STEP 4. 결제 id검증
       */
      if (payment.merchant_uid !== merchant_uid) {
        logger.error('[WEBHOOK ERROR] 결제 id 불일치');
        // 결제 실패라는 데이터를 남김
        const failedInfo = {
          errorCode: '400',
          errorMessage: '결제 id가 불일치 합니다.',
          failedAt: new Date(),
        };
        await this.paymentRepository.updateFailed(merchant_uid, failedInfo);
        return;
      }

      /**
       * STEP 5. 금액 검증
       */
      const expectedAmount = await this.getExpectedPrice(merchant_uid);
      if (payment.amount !== expectedAmount) {
        logger.error(
          `[WEBHOOK ERROR] 금액 불일치! 주문: ${expectedAmount}, 결제: ${payment.amount}`,
        );
        const failedInfo = {
          errorCode: '400',
          errorMessage: '결제 금액이 불일치 합니다.',
          failedAt: new Date(),
        };
        await this.paymentRepository.updateFailed(merchant_uid, failedInfo);
        return;
      }

      /**
       * STEP 6. 결제 정보 생성 (중복 결제 방지 -> pending 상태인 결제에만 업데이트)
       */
      const updateData = {
        merchantUid: payment.merchant_uid,
        impUid: payment.imp_uid,
        amount: payment.amount,
        status: PaymentStatus.paid,
        provider: payment.pg_provider as PaymentProvider,
        method: payment.pay_method as PaymentMethod,
        pgTid: payment.pg_tid,
        paidAt: new Date(payment.paid_at * 1000), // 유닉스 타임스탬프라 1000 곱해야함,
      };
      const updatedPayment = await this.paymentRepository.updatePayment(updateData);
      if (updatedPayment.count === 0) {
        return { message: '이미 처리된 결제입니다.' };
      }

      /**
       * STEP 7. 결제 확정 처리 (DB 저장)
       */
      await this.orderService.confirmPayment(merchant_uid);
      logger.info('[WEBHOOK] 결제 확정 처리 완료 ✅');
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'Unknown';
      // 결제 검증/승인 실패 시
      putMetric('codiit/Domain', 'Payment_ApprovalFailed', 1, 'Count', [
        // Dimension(태그)를 추가하여 원인 분류
        { Name: 'Reason', Value: errorName || 'Unknown' },
      ]);
      handleAxiosError(error, '결제 콜백 처리 중 에러 발생');
    }
  }
}
