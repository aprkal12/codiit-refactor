import { prisma } from '@/config/prisma.js';

export class MetadataRepository {
  async findAllGrades() {
    return prisma.grade.findMany({
      orderBy: {
        minAmount: 'asc',
      },
    });
  }
}
