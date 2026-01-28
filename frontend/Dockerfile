# ===== Frontend Dockerfile =====
# React + Vite 기반 대시보드
# 개발 모드: HMR 지원 / 프로덕션: 정적 파일 빌드

FROM node:20-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./

# 의존성 설치
RUN npm install

# 소스 코드 복사
COPY . .

# Vite 개발 서버 포트
EXPOSE 5173

# 개발 모드 실행 (--host로 외부 접속 허용)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
