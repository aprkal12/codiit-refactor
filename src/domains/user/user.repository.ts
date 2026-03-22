import { prisma } from '@/config/prisma.js';
import type { UserType } from '@prisma/client';

interface CreateUserData {
  name: string;
  email: string;
  password: string;
  type: UserType;
  gradeId: string;
}

interface UpdateUserData {
  name?: string;
  password?: string;
  image?: string;
}

export class UserRepository {
  async create(data: CreateUserData) {
    return prisma.user.create({
      data,
      include: { grade: true },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: { grade: true },
    });
  }

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: { grade: true },
    });
  }

  async update(id: string, data: UpdateUserData) {
    return prisma.user.update({
      where: { id },
      data,
      include: { grade: true },
    });
  }

  async findLikedStores(userId: string) {
    return prisma.storeLike.findMany({
      where: { userId },
      include: {
        store: true,
      },
    });
  }

  async delete(id: string) {
    return prisma.user.delete({
      where: { id },
    });
  }

  // 등급 관련 메서드

  // 유저의 총 주문 금액 계산 (결제 완료된 주문만)
  async getTotalPurchaseAmount(userId: string): Promise<number> {
    const result = await prisma.order.aggregate({
      where: {
        buyerId: userId,
        status: 'CompletedPayment',
      },
      _sum: {
        subtotal: true,
      },
    });
    return result._sum.subtotal ?? 0;
  }

  // 누적 금액에 맞는 등급 조회
  async findGradeByAmount(amount: number) {
    return prisma.grade.findFirst({
      where: {
        minAmount: {
          lte: amount,
        },
      },
      orderBy: {
        minAmount: 'desc',
      },
    });
  }

  // 유저 등급 업데이트
  async updateGrade(userId: string, gradeId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { gradeId },
      include: { grade: true },
    });
  }
}
