# ===== Stage 1: Dashboard 빌드 =====
FROM node:20-alpine AS dashboard-builder

WORKDIR /dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# ===== Stage 2: Backend 서버 =====
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ .

# 대시보드 빌드 결과물 복사
COPY --from=dashboard-builder /dashboard/dist ./public

RUN mkdir -p /data/recordings /data/db

EXPOSE 3000

CMD ["node", "index.js"]
