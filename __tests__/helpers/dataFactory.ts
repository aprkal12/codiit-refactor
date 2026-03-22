import { prisma } from '@/config/prisma.js';
import bcrypt from 'bcrypt';
import {
  Grade,
  User,
  Store,
  Category,
  Product,
  Inquiry,
  Reply,
  Notification,
  OrderStatus,
  PaymentProvider,
  PaymentMethod,
} from '@prisma/client';
import { GetOrderRawData } from '@/domains/order/order.dto.js';
import { createGetOrderMock } from '../mocks/order.mock.js';
import { GetCartRawData } from '@/domains/cart/cart.dto.js';
import { createCartMock } from '../mocks/cart.mock.js';

// ============================================
// 상수
// ============================================
export const TEST_PASSWORD = 'test1234';

// ============================================
// Grade (User 생성에 필요) - createTestContext에서 직접 사용되지 않음
// ============================================
/*
interface CreateGradeOptions {
  name?: string;
  minAmount?: number;
  rate?: number;
}
export const createTestGrade = async (overrides: CreateGradeOptions = {}): Promise<Grade> => {
  return prisma.grade.create({
    data: {
      name: overrides.name ?? '브론즈',
      minAmount: overrides.minAmount ?? 0,
      rate: overrides.rate ?? 0.01,
    },
  });
};
*/
// ============================================
// User
// ============================================
interface CreateUserOptions {
  email?: string;
  password?: string;
  name?: string;
  type?: 'BUYER' | 'SELLER';
  gradeId: string;
}

export const createTestUser = async (options: CreateUserOptions): Promise<User> => {
  const timestamp = Date.now();
  const hashedPassword = await bcrypt.hash(options.password ?? TEST_PASSWORD, 10);

  return prisma.user.create({
    data: {
      email: options.email ?? `test-${timestamp}@example.com`,
      password: hashedPassword,
      name: options.name ?? `테스트유저${timestamp}`,
      type: options.type ?? 'BUYER',
      gradeId: options.gradeId,
    },
  });
};

// ============================================
// 편의 함수: Seller 생성
// ============================================
export const createTestSeller = async (
  gradeId: string,
  overrides: Partial<CreateUserOptions> = {},
): Promise<User> => {
  return createTestUser({
    gradeId,
    type: 'SELLER',
    email: overrides.email ?? `seller-${Date.now()}@test.com`,
    name: overrides.name ?? '테스트 판매자',
    password: overrides.password,
  });
};

// ============================================
// 편의 함수: Buyer 생성
// ============================================
export const createTestBuyer = async (
  gradeId: string,
  overrides: Partial<CreateUserOptions> = {},
): Promise<User> => {
  return createTestUser({
    gradeId,
    type: 'BUYER',
    email: overrides.email ?? `buyer-${Date.now()}@test.com`,
    name: overrides.name ?? '테스트 구매자',
    password: overrides.password,
  });
};

// ============================================
// Store (판매자 전용)
// ============================================
interface CreateStoreOptions {
  name?: string;
  address?: string;
  phoneNumber?: string;
  content?: string;
}

export const createTestStore = async (
  userId: string,
  overrides: CreateStoreOptions = {},
): Promise<Store> => {
  return prisma.store.create({
    data: {
      name: overrides.name ?? '테스트 스토어',
      address: overrides.address ?? '서울시 강남구',
      phoneNumber: overrides.phoneNumber ?? '010-1234-5678',
      content: overrides.content ?? '테스트 스토어 설명입니다.',
      userId,
    },
  });
};

// ============================================
// Category
// ============================================
export const createTestCategory = async (name = '상의'): Promise<Category> => {
  return prisma.category.create({
    data: { name },
  });
};

// ============================================
// Product
// ============================================
interface CreateProductOptions {
  storeId: string;
  categoryId: string;
  name?: string;
  price?: number;
  image?: string;
}

export const createTestProduct = async (options: CreateProductOptions): Promise<Product> => {
  return prisma.product.create({
    data: {
      name: options.name ?? '테스트 상품',
      price: options.price ?? 10000,
      image: options.image ?? 'https://example.com/image.jpg',
      storeId: options.storeId,
      categoryId: options.categoryId,
    },
  });
};

// ============================================
// 복합 데이터 생성: 기본 테스트 환경 (Grade + Seller + Buyer)
// ============================================
export interface TestContext {
  grade: Grade;
  seller: User;
  buyer: User;
}

export const createTestContext = async (): Promise<TestContext> => {
  const grade = await prisma.grade.findUniqueOrThrow({
    where: { id: 'grade_green' },
  });
  const seller = await createTestSeller(grade.id);
  const buyer = await createTestBuyer(grade.id);

  return { grade, seller, buyer };
};

// ============================================
// 복합 데이터 생성: 판매자 + 스토어 + 상품
// ============================================
export interface SellerWithProductContext extends TestContext {
  store: Store;
  category: Category;
  product: Product;
}

export const createSellerWithProduct = async (): Promise<SellerWithProductContext> => {
  const { grade, seller, buyer } = await createTestContext();
  const store = await createTestStore(seller.id);
  const category = await createTestCategory();
  const product = await createTestProduct({
    storeId: store.id,
    categoryId: category.id,
  });

  return { grade, seller, buyer, store, category, product };
};

// ============================================
// Inquiries
// ============================================
interface CreateInquiryOptions {
  title?: string;
  content?: string;
  isSecret?: boolean;
}

export const createTestInquiry = async (
  userId: string,
  productId: string,
  options: CreateInquiryOptions = {},
): Promise<Inquiry> => {
  return prisma.inquiry.create({
    data: {
      title: options.title ?? '테스트 문의',
      content: options.content ?? '테스트 문의 내용입니다.',
      isSecret: options.isSecret ?? false,
      userId,
      productId,
    },
  });
};

// ============================================
// Reply
// ============================================
interface CreateReplyOptions {
  content?: string;
}

export const createTestReply = async (
  userId: string,
  inquiryId: string,
  options: CreateReplyOptions = {},
): Promise<Reply> => {
  return prisma.reply.create({
    data: {
      content: options.content ?? '테스트 답변 내용입니다.',
      userId,
      inquiryId,
    },
  });
};

// ============================================
// Notification
// ============================================
interface CreateNotificationOptions {
  content?: string;
}

export const createTestNotification = async (
  userId: string,
  options: CreateNotificationOptions = {},
): Promise<Notification> => {
  return prisma.notification.create({
    data: {
      content: options.content ?? '테스트 알림 내용입니다.',
      userId,
    },
  });
};

// ============================================
// Order
// ============================================
/**
 * [통합 테스트용] 주문 생성 팩토리
 * - 기존 유닛 테스트용 Mock 데이터를 기반으로 실제 DB에 데이터를 생성합니다.
 * - user, Product는 미리 DB에 존재해야 합니다.
 */
// 주문 통합테스트 객체 생성용 타입
// 주문 상태 업데이트를 위해 추가
interface CreateOrderTestOptions extends GetOrderRawData {
  status: OrderStatus;
}
export const createTestOrder = async (overrides: Partial<CreateOrderTestOptions> = {}) => {
  // 1. 기존 Mock 데이터를 생성 (기본값 + 오버라이드)
  const mockData = createGetOrderMock(overrides);

  // 2. DB 저장용 데이터로 분리
  const {
    id: _id,
    createdAt: _createdAt,
    buyerId,
    orderItems,
    payments,
    ...scalarFields
  } = mockData;

  // 3. 실제 DB에 저장 (Nested Writes 활용)
  return await prisma.order.create({
    data: {
      status: overrides.status ? overrides.status : OrderStatus.WaitingPayment,
      ...scalarFields,

      buyer: {
        connect: {
          id: buyerId,
        },
      },

      // [OrderItem 관계 처리]
      orderItems: {
        create: orderItems?.map((item) => ({
          quantity: item.quantity,
          price: item.price,
          product: { connect: { id: item.productId } },
          // Size 연결 (사이즈도 미리 존재해야 함)
          size: { connect: { id: item.size.id } },

          // Review는 주문 생성 시점엔 보통 없으므로 제외
        })),
      },

      // [Payment 관계 처리]
      payments: payments
        ? {
            createMany: {
              data: payments.map((p) => ({
                price: p.price,
                status: p.status,
                provider: PaymentProvider.kakaopay,
                method: PaymentMethod.card,
              })),
            },
          }
        : undefined,
    },
    include: {
      orderItems: true,
      payments: true,
    },
  });
};
// ============================================
// Cart
// ============================================
/**
 * [통합 테스트용] 카트 생성 팩토리
 * - 기존 유닛 테스트용 Mock 데이터를 기반으로 실제 DB에 데이터를 생성합니다.
 * - Buyer, Product, Size는 미리 DB에 존재해야 합니다.
 * - Cart는 유저당 1개, 이미 카트가 있는 유저라면 에러
 */
export const createTestCart = async (overrides: Partial<GetCartRawData> = {}) => {
  // 1. 기존 Mock 데이터를 생성 (기본값 + 오버라이드)
  const mockData = createCartMock(overrides);

  // 2. DB 저장용 데이터로 분리
  const { id: _id, createdAt: _createdAt, buyerId, items, ...scalarFields } = mockData;

  // 3. 실제 DB에 저장 (Nested Writes 활용)
  return await prisma.cart.create({
    data: {
      ...scalarFields,

      // [Buyer 관계 처리]
      // 카트는 반드시 유저와 연결되어야 함
      buyer: {
        connect: {
          id: buyerId,
        },
      },

      // [CartItem 관계 처리]
      // 카트 생성 시 아이템도 같이 생성
      items: {
        create: items?.map((item) => ({
          quantity: item.quantity,

          // Product 연결 (미리 존재해야 함)
          product: { connect: { id: item.productId } },

          // Size 연결 (미리 존재해야 함)
          size: { connect: { id: item.sizeId } },
        })),
      },
    },
    // 생성된 데이터 반환 시 아이템과 내부 정보 포함
    include: {
      items: {
        include: {
          product: {
            include: {
              store: true,
              stocks: {
                include: {
                  size: true,
                },
              },
            },
          },
        },
      },
    },
  });
};
