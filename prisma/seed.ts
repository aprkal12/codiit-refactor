import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seedGrades() {
  const grades = [
    { id: 'grade_vip', name: 'vip', minAmount: 1000000, rate: 0.1 },
    { id: 'grade_black', name: 'black', minAmount: 500000, rate: 0.07 },
    { id: 'grade_red', name: 'red', minAmount: 300000, rate: 0.05 },
    { id: 'grade_orange', name: 'orange', minAmount: 100000, rate: 0.03 },
    { id: 'grade_green', name: 'green', minAmount: 0, rate: 0.01 },
  ];

  // Grade 시딩
  for (const grade of grades) {
    await prisma.grade.upsert({
      where: { id: grade.id },
      update: {},
      create: grade,
    });
  }
  console.log('✅ Grade 시드 데이터 완료');
}

async function seedCategories() {
  const categories = [
    { name: 'top' },
    { name: 'bottom' },
    { name: 'dress' },
    { name: 'outer' },
    { name: 'skirt' },
    { name: 'shoes' },
    { name: 'acc' },
  ];

  // Category 시딩
  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: { name: category.name },
    });
  }
  console.log('✅ 카테고리 시딩 완료!');
}

async function seedSizes() {
  const sizes = [
    { id: 1, en: 'XS', ko: '엑스스몰' },
    { id: 2, en: 'S', ko: '스몰' },
    { id: 3, en: 'M', ko: '미디엄' },
    { id: 4, en: 'L', ko: '라지' },
    { id: 5, en: 'XL', ko: '엑스라지' },
    { id: 6, en: 'Free', ko: '프리' },
  ];

  // Size 시딩
  for (const size of sizes) {
    await prisma.size.upsert({
      where: { id: size.id },
      update: {},
      create: {
        id: size.id,
        en: size.en,
        ko: size.ko,
      },
    });
  }
  console.log('✅ 사이즈 시딩 완료!');
}

async function seedTestUsers() {
  // 테스트 계정 시딩 (로컬/개발 환경용)
  const hashedPassword = await bcrypt.hash('test1234', 10);

  const testUsers = [
    {
      email: 'buyer@codiit.com',
      password: hashedPassword,
      name: '테스트구매자',
      type: 'BUYER' as const,
      gradeId: 'grade_green',
    },
    {
      email: 'seller@codiit.com',
      password: hashedPassword,
      name: '테스트판매자',
      type: 'SELLER' as const,
      gradeId: 'grade_green',
    },
  ];

  for (const user of testUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        password: user.password, // 강제 리셋
        name: user.name,
      },
      create: user,
    });
  }
  console.log('✅ 테스트 계정 시딩 완료!');
}

async function main() {
  const NODE_ENV = process.env.NODE_ENV ?? 'development';

  // 1. 기초 데이터 (Grade, Category, Size)
  await Promise.all([seedGrades(), seedCategories(), seedSizes()]);

  // 2. 테스트 데이터 (Users)
  // 운영 환경이 아닐 때만 실행
  if (NODE_ENV !== 'production') {
    await seedTestUsers();
  } else {
    console.log('⚠️ 운영 환경이므로 테스트 계정 시딩을 건너뜁니다.');
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
