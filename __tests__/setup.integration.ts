import { jest } from '@jest/globals';
import { prisma } from '@/config/prisma.js';

// 테이블 TRUNCATE 순서 (FK 의존성 고려)
const tableNames = [
  'notifications',
  'point_history',
  'store_likes',
  'replies',
  'inquiries',
  'reviews',
  'payments',
  'order_items',
  'orders',
  'cart_items',
  'carts',
  'stocks',
  'products',
  'categories',
  'stores',
  'users',
  'grade',
  'size',
];

// Size 시딩 데이터 (Lookup 테이블 - 시스템 상수)
const SIZE_SEED_DATA = [
  { id: 1, en: 'XS', ko: '엑스스몰' },
  { id: 2, en: 'S', ko: '스몰' },
  { id: 3, en: 'M', ko: '미디엄' },
  { id: 4, en: 'L', ko: '라지' },
  { id: 5, en: 'XL', ko: '엑스라지' },
  { id: 6, en: 'FREE', ko: '프리' },
];

// Grade 시딩 데이터 (Lookup 테이블 - 회원 등급)
const GRADE_SEED_DATA = [
  { id: 'grade_vip', name: 'vip', minAmount: 1000000, rate: 0.1 },
  { id: 'grade_black', name: 'black', minAmount: 500000, rate: 0.07 },
  { id: 'grade_red', name: 'red', minAmount: 300000, rate: 0.05 },
  { id: 'grade_orange', name: 'orange', minAmount: 100000, rate: 0.03 },
  { id: 'grade_green', name: 'green', minAmount: 0, rate: 0.01 },
];

// 테스트 중 console 출력 억제 (디버깅 시 주석 처리)
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeAll(() => {
  console.error = jest.fn();
  console.log = jest.fn();
});

beforeEach(async () => {
  // 각 테스트 전 모든 테이블 초기화
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE;`,
  );

  // Size Lookup 테이블 시딩 (Cart, Order, Stock 테스트에 필요)
  await prisma.size.createMany({
    data: SIZE_SEED_DATA,
  });

  // Grade Lookup 테이블 시딩 (User 회원가입, 등급 관련 테스트에 필요)
  await prisma.grade.createMany({
    data: GRADE_SEED_DATA,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  // console 복원
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});
