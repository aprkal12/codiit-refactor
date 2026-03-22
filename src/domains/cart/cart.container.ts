import { prisma } from '@/config/prisma.js';
import { CartRepository } from '@/domains/cart/cart.repository.js';
import { CartService } from '@/domains/cart/cart.service.js';
import { CartController } from '@/domains/cart/cart.controller.js';

// Repository 인스턴스 생성 (DB 연결)
const cartRepository = new CartRepository(prisma);

// Service 인스턴스 생성 (Repository 주입)
const cartService = new CartService(cartRepository, prisma);

// Controller 인스턴스 생성 (Service 주입)
export const cartController = new CartController(cartService);
