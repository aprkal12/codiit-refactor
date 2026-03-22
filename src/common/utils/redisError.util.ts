import { logger } from '@/config/logger.js';

/**
 * Redis 및 Queue 관련 에러를 처리하고 로깅하는 유틸리티 함수.
 * 메인 비즈니스 로직(DB 트랜잭션 등)의 흐름을 끊지 않아야 하는 보조 작업에 사용.
 *
 * @param error - 처리할 에러 객체 (unknown 타입)
 * @param contextMessage - 에러 발생 상황을 설명하는 추가 메시지
 */
export const handleQueueError = (error: unknown, contextMessage?: string) => {
  const baseMessage = contextMessage || 'Queue/Redis operation failed';

  if (error instanceof Error) {
    logger.error(
      {
        err: {
          message: error.message,
          name: error.name,
          stack: error.stack, // 디버깅을 위해 스택 트레이스 포함
        },
      },
      `${baseMessage} - Queue Error`,
    );
  } else {
    // Error 객체가 아닌 예기치 않은 예외 타입이 던져진 경우
    logger.error({ err: error }, `${baseMessage} - Unknown Error`);
  }
};
