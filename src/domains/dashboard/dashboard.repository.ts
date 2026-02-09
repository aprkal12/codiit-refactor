import { prisma } from '@/config/prisma.js';
import { OrderStatus } from '@prisma/client';

const COMPLETED_ORDER_STATUSES: OrderStatus[] = ['CompletedPayment', 'Delivered'];
const PRICE_RANGES = [
  { name: '1만원 이하', min: 0, max: 10000 },
  { name: '1만원 ~ 3만원', min: 10001, max: 30000 },
  { name: '3만원 ~ 5만원', min: 30001, max: 50000 },
  { name: '5만원 ~ 10만원', min: 50001, max: 100000 },
  { name: '10만원 이상', min: 100001, max: Infinity },
];

export class DashboardRepository {
  async getSalesSummary(startDate: Date, endDate: Date, userId: string) {
    const where = {
      order: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: COMPLETED_ORDER_STATUSES,
        },
      },
      product: {
        store: {
          userId,
        },
      },
    };

    const orderItems = await prisma.orderItem.findMany({
      where,
      select: {
        orderId: true,
        price: true,
        quantity: true,
      },
    });

    const totalOrders = new Set(orderItems.map((item) => item.orderId)).size;
    const totalSales = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      totalOrders,
      totalSales,
    };
  }

  async getTopSellingProducts(limit: number, userId: string) {
    const topProductsRaw = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          status: {
            in: COMPLETED_ORDER_STATUSES,
          },
        },
        product: {
          store: {
            userId,
          },
        },
      },
      _sum: {
        quantity: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: limit,
    });

    if (topProductsRaw.length === 0) {
      return [];
    }

    const productIds = topProductsRaw.map((p) => p.productId);

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
      select: {
        id: true,
        name: true,
        price: true,
      },
    });

    // Combine the results
    const productMap = new Map(products.map((p) => [p.id, p]));

    return topProductsRaw.map((raw) => ({
      totalOrders: raw._sum?.quantity || 0,
      product: productMap.get(raw.productId)!,
    }));
  }

  async getSalesByPriceRange(userId: string) {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          status: {
            in: COMPLETED_ORDER_STATUSES,
          },
        },
        product: {
          store: {
            userId,
          },
        },
      },
      select: {
        price: true,
        quantity: true,
      },
    });

    const priceRangeSales = PRICE_RANGES.map((range) => ({
      priceRange: range.name,
      totalSales: 0,
    }));

    for (const item of orderItems) {
      const sale = item.price * item.quantity;
      const rangeIndex = PRICE_RANGES.findIndex(
        (range) => item.price >= range.min && item.price <= range.max,
      );

      if (rangeIndex !== -1) {
        priceRangeSales[rangeIndex].totalSales += sale;
      }
    }

    return priceRangeSales;
  }
}
