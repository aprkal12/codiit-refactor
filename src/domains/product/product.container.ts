import { prisma } from '@/config/prisma.js';
import { ProductRepository } from './product.repository.js';
import { ProductService } from './product.service.js';
import { ProductController } from './product.controller.js';

// Repository 인스턴스 생성 (DB 연결)
const productRepository = new ProductRepository(prisma);

// Service 인스턴스 생성 (Repository 주입)
const productService = new ProductService(productRepository);

// Controller 인스턴스 생성 (Service 주입)
export const productController = new ProductController(productService);
