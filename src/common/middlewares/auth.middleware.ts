import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '@/common/utils/errors.js';
import { verifyAccessToken } from '@/common/utils/jwt.util.js';
import type { UserType } from '@prisma/client';
import { prisma } from '@/config/prisma.js';

const TEST_ACCOUNT_EMAILS = new Set(['buyer@codiit.com', 'seller@codiit.com']);

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('인증 토큰이 필요합니다.');
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyAccessToken(token);

  req.user = {
    id: payload.userId,
    type: payload.type,
  };
  next();
};

export const authorize = (...allowedTypes: UserType[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('인증이 필요합니다.');
    }

    if (!allowedTypes.includes(req.user.type)) {
      throw new ForbiddenError('접근 권한이 없습니다.');
    }

    next();
  };
};

// 편의 미들웨어 (자주 사용하는 역할)
export const onlySeller = authorize('SELLER');
export const onlyBuyer = authorize('BUYER');

// 테스트 계정 보호 미들웨어
export const excludeTestAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = req.user?.id;

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user && TEST_ACCOUNT_EMAILS.has(user.email)) {
      throw new ForbiddenError('테스트 계정은 수정/삭제할 수 없습니다.');
    }
  }

  next();
};
