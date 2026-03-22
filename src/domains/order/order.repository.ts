import { OrderStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import {
  CreateOrderItemRepoInput,
  CreateOrderRawData,
  CreateOrderRepoInput,
  CreatePointHistoryRepoInput,
  DecreaseStockRawData,
  GetCountRepoInput,
  GetOrderFromPaymentRawData,
  GetOrderRawData,
  GetOrdersRawData,
  GetOrdersRepoInput,
  GetOrderStatusRawData,
  GetPaymentPriceRawData,
  GetPaymentStatusRawData,
  GetPointHistoryRepoInput,
  GetStockRepoInput,
  ProductInfoRawData,
  UpdateOrderRepoInput,
  UpdatePointRepoInput,
  UpdateStockRepoInput,
  UserInfoRawData,
} from '@/domains/order/order.dto.js';

export class OrderRepository {
  constructor(private prisma: PrismaClient) {}
  // order 오리지널 쿼리들
  /**
   * 주문 개수 조회
   */
  async count({ buyerId, status }: GetCountRepoInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.order.count({
      where: {
        buyerId,
        status,
      },
    });
  }
  /**
   * 주문 상태 조회
   */
  async findStatusById(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GetOrderStatusRawData | null> {
    const db = tx ?? this.prisma;
    return await db.order.findUnique({
      where: {
        id: orderId,
      },
      select: {
        status: true,
      },
    });
  }
  /**
   * 주문 상태 업데이트
   */
  async updateStatus(orderId: string, status: OrderStatus, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.order.update({
      where: {
        id: orderId,
      },
      data: {
        status,
      },
    });
  }
  /**
   * 주문 owner 조회
   **/
  async findOwnerById(orderId: string) {
    return await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      select: {
        buyerId: true,
      },
    });
  }
  /**
   * 주문 조회
   **/
  async findById(orderId: string): Promise<GetOrderRawData | null> {
    return await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      select: {
        id: true,
        buyerId: true,
        name: true,
        phoneNumber: true,
        address: true,
        subtotal: true,
        totalQuantity: true,
        usePoint: true,
        createdAt: true,
        orderItems: {
          select: {
            id: true,
            price: true,
            quantity: true,
            productId: true,
            review: {
              // isReviewed, product내부 reviews 생성용
              select: {
                id: true,
                rating: true,
                content: true,
                createdAt: true,
              },
            },
            product: {
              select: {
                name: true,
                image: true,
              },
            },
            size: {
              select: {
                id: true,
                en: true,
                ko: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            price: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            orderId: true,
          },
        },
      },
    });
  }
  /**
   * 주문 목록 조회
   */
  async findMany(
    { buyerId, status, skip, take }: GetOrdersRepoInput,
    tx?: Prisma.TransactionClient,
  ): Promise<GetOrdersRawData> {
    const db = tx ?? this.prisma;
    return await db.order.findMany({
      where: {
        buyerId,
        status,
      },
      select: {
        id: true,
        buyerId: true,
        name: true,
        phoneNumber: true,
        address: true,
        subtotal: true,
        totalQuantity: true,
        usePoint: true,
        createdAt: true,
        orderItems: {
          select: {
            id: true,
            price: true,
            quantity: true,
            productId: true,
            review: {
              // isReviewed, product내부 reviews 생성용
              select: {
                id: true,
                rating: true,
                content: true,
                createdAt: true,
              },
            },
            product: {
              select: {
                name: true,
                image: true,
              },
            },
            size: {
              select: {
                id: true,
                en: true,
                ko: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            price: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            orderId: true,
          },
        },
      },
      skip,
      take,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
  /**
   * 주문 생성
   **/
  async createOrder(
    data: CreateOrderRepoInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CreateOrderRawData> {
    const db = tx ?? this.prisma;
    return await db.order.create({
      data: {
        buyerId: data.userId,
        name: data.name,
        phoneNumber: data.phone,
        address: data.address,
        usePoint: data.usePoint,
        subtotal: data.subtotal,
        totalQuantity: data.totalQuantity,
        expiresAt: data.expiresAt,
      },
    });
  }
  /**
   * 주문 수정
   **/
  async updateOrder(data: UpdateOrderRepoInput) {
    return await this.prisma.order.update({
      where: {
        id: data.orderId,
      },
      data: {
        name: data.name,
        phoneNumber: data.phone,
        address: data.address,
      },
    });
  }
  /**
   * 주문 삭제(현재는 물리적 삭제 추후 논리적 삭제로 리팩토링)
   */
  async deleteOrder(orderId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    await db.order.delete({
      where: {
        id: orderId,
      },
    });
  }
  /**
   * 만료된 주문 체크
   */
  async getExpiredOrderInfo(orderId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.order.findUnique({
      where: {
        id: orderId,
        status: OrderStatus.WaitingPayment,
      },
      select: {
        orderItems: {
          select: {
            productId: true,
            sizeId: true,
            quantity: true,
          },
        },
      },
    });
  }

  async findWaitingPaymentOrders(tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.order.findMany({
      where: {
        status: OrderStatus.WaitingPayment,
      },
      select: {
        id: true,
        orderItems: {
          select: {
            productId: true,
            sizeId: true,
            quantity: true,
          },
        },
      },
    });
  }

  // 다른 도메인 쿼리들
  /**
   * 재고 복구
   */
  async restoreReservedStock(
    { productId, sizeId, quantity }: UpdateStockRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return db.$executeRaw`
      UPDATE stocks
      SET reserved_quantity = reserved_quantity - ${quantity}
      WHERE product_id = ${productId}
        AND size_id = ${sizeId}
        AND reserved_quantity >= ${quantity};
    `;
  }
  /**
   * 재고 예약 (주문 시점에 재고 locking)
   * 정합성 때문에 raw query
   */
  async reserveStock(
    { productId, sizeId, quantity }: UpdateStockRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.$executeRaw`
      UPDATE stocks
      SET reserved_quantity = reserved_quantity + ${quantity}
      WHERE product_id = ${productId}
        AND size_id = ${sizeId}
        AND quantity - reserved_quantity >= ${quantity};
    `;
  }
  /**
   * 결제 정보 조회
   */
  async findPaymentWithOrder(paymentId: string): Promise<GetOrderFromPaymentRawData | null> {
    return await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: {
        order: {
          select: {
            id: true,
            usePoint: true,
            buyerId: true,
            orderItems: {
              select: {
                id: true,
                price: true,
                quantity: true,
                productId: true,
                review: {
                  // isReviewed, product내부 reviews 생성용
                  select: {
                    id: true,
                    rating: true,
                    content: true,
                    createdAt: true,
                  },
                },
                product: {
                  select: {
                    name: true,
                    image: true,
                  },
                },
                size: {
                  select: {
                    id: true,
                    en: true,
                    ko: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
  /**
   * 결제 금액 조회
   */
  async getPaymentPrice(
    paymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GetPaymentPriceRawData | null> {
    const db = tx ?? this.prisma;
    return await db.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: {
        price: true,
      },
    });
  }
  /**
   * 유저 포인트, 등급 조회
   **/
  // 등급 부분에 유니크 키가 없어 유저 쪽에서 연관 조회
  async findUserInfo(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserInfoRawData | null> {
    const db = tx ?? this.prisma;
    return await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        point: true,
        grade: {
          select: {
            rate: true,
          },
        },
      },
    });
  }
  /**
   * 상품 가격, 재고 조회
   **/
  async findManyProducts(productIds: string[]): Promise<ProductInfoRawData[]> {
    return await this.prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
      select: {
        id: true,
        name: true,
        price: true,
        discountRate: true,
        discountStartTime: true,
        discountEndTime: true,
        stocks: {
          select: {
            sizeId: true,
            quantity: true,
          },
        },
      },
    });
  }
  /**
   * 주문 아이템들 생성
   **/
  async createOrderItems(data: CreateOrderItemRepoInput[], tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.orderItem.createMany({
      data,
    });
  }
  /**
   * 결제 정보 삭제
   * 추후 논리적 삭제로 리팩토링
   */
  async deletePayment(paymentId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.payment.delete({
      where: {
        id: paymentId,
      },
    });
  }
  /**
   * 결제 상태 업데이트
   * 논리적 삭제 처리 가능
   */
  async updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status,
      },
    });
  }
  /**
   * 포인트 증가
   **/
  async increasePoint({ userId, amount }: UpdatePointRepoInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.user.update({
      where: {
        id: userId,
      },
      data: {
        point: { increment: amount },
      },
    });
  }
  /**
   * 포인트 차감
   **/
  async decreasePoint({ userId, amount }: UpdatePointRepoInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return await db.user.update({
      where: {
        id: userId,
        point: { gte: amount }, // 방어적 코드 - 현재 포인트가 사용할 포인트보다 많을 때만
      },
      data: {
        point: { decrement: amount },
      },
    });
  }
  /**
   * 포인트 히스토리 생성
   **/
  async createPointHistory(
    { userId, orderId, amount, type }: CreatePointHistoryRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.pointHistory.create({
      data: {
        userId,
        orderId,
        amount,
        type, // 이부분은 따로 enum타입 같은게 없어서 논의 해봐야 할 것 같습니다.
      },
    });
  }
  /**
   * 포인트 히스토리 조회
   **/
  // 어차피 한 주문에 적립은 한 개 뿐일 거라 unique 없이 first로 조회
  async findPointHistory(
    { orderId, userId, type }: GetPointHistoryRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.pointHistory.findFirst({
      where: {
        userId,
        orderId,
        type,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
  /**
   * 재고 증가 처리
   **/
  async increaseStock(
    { productId, sizeId, quantity }: UpdateStockRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.stock.update({
      where: {
        productId_sizeId: {
          productId,
          sizeId,
        },
      },
      data: {
        quantity: { increment: quantity },
      },
    });
  }
  /**
   * 재고 감소 처리
   **/
  async decreaseStock(
    { productId, sizeId, quantity }: UpdateStockRepoInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return await db.$executeRaw`
      UPDATE stocks
      SET
        quantity = quantity - ${quantity},
        reserved_quantity = reserved_quantity - ${quantity}
      WHERE product_id = ${productId}
        AND size_id = ${sizeId}
        AND reserved_quantity >= ${quantity};
    `;
  }
  /**
   * 재고 연관 데이터 조회
   */
  async getStockData(
    { productId, sizeId }: GetStockRepoInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DecreaseStockRawData | null> {
    const db = tx ?? this.prisma;
    return db.stock.findUnique({
      where: {
        productId_sizeId: {
          productId,
          sizeId,
        },
      },
      include: {
        product: {
          select: {
            name: true,
            store: {
              select: {
                userId: true,
              },
            },
            cartItems: {
              select: {
                cart: {
                  select: {
                    buyerId: true,
                  },
                },
                sizeId: true,
              },
            },
          },
        },
        size: {
          select: {
            id: true,
            ko: true,
            en: true,
          },
        },
      },
    });
  }
  /**
   * 결제 상태 조회
   **/
  async findPaymentStatusById(
    paymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GetPaymentStatusRawData | null> {
    const db = tx ?? this.prisma;
    return await db.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: { status: true },
    });
  }
}
