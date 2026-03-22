# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Builder
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# 의존성 설치를 위한 파일만 먼저 복사 (레이어 캐싱 최적화)
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY prisma ./prisma/

# 의존성 설치 (devDependencies 포함)
RUN npm ci

# 소스 코드 복사
COPY src ./src

# Prisma Client 생성
RUN npx prisma generate

# TypeScript 빌드
RUN rm -rf dist && npm run build

# devDependencies 제거 (프로덕션 의존성만 유지)
RUN npm prune --omit=dev

# ==========================================
# Stage 2: Runner (Production)
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# 프로덕션 환경 설정
ENV NODE_ENV=production

# 보안: non-root 유저로 실행
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# package.json 복사 (메타데이터 참조용)
COPY package*.json ./

# Builder에서 프로덕션 의존성만 복사 (devDependencies 제외됨)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Prisma schema 복사 (런타임에 필요)
COPY prisma ./prisma/

# Builder 스테이지에서 빌드된 파일 복사 (소유권 설정)
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# 로그 디렉토리 생성 및 권한 설정
RUN mkdir -p /app/logs && \
    chown -R nodejs:nodejs /app

# non-root 유저로 전환
USER nodejs

# 포트 노출
EXPOSE 3000

# Health check (Prisma DB 연결 시간 고려)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 애플리케이션 시작
CMD ["node", "dist/server.js"]
