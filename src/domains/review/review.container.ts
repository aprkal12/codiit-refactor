import { prisma } from '@/config/prisma.js';
import { ReviewRepository } from './review.repository.js';
import { ReviewService } from './review.service.js';
import { ReviewController } from './review.controller.js';

const reviewRepository = new ReviewRepository(prisma);
const reviewService = new ReviewService(reviewRepository);
export const reviewController = new ReviewController(reviewService);
