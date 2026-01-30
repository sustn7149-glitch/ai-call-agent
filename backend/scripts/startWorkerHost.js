#!/usr/bin/env node

// ===== 호스트 분석 워커 =====
// Docker 외부 (호스트)에서 실행하여 네이티브 CLI 도구에 접근
//
// 사용법:
//   AI_PROVIDER=claude node backend/scripts/startWorkerHost.js
//
// 필수 조건:
//   - Redis가 localhost:6379에서 접근 가능해야 함 (docker-compose에서 포트 노출)
//   - STT 서버가 localhost:9000에서 접근 가능해야 함
//   - Docker 볼륨 경로 접근 가능해야 함

// 환경변수 기본값 (호스트 실행용)
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:9000/asr';
process.env.OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'claude';

// DB 경로: Docker named volume의 호스트 경로
const DB_VOLUME_PATH = '/var/lib/docker/volumes/call-agent-backend-data/_data';
process.env.DB_PATH = process.env.DB_PATH || `${DB_VOLUME_PATH}/database.sqlite`;

// 녹음 파일 경로
const REC_VOLUME_PATH = '/var/lib/docker/volumes/call-agent-recordings/_data';
process.env.RECORDINGS_PATH = process.env.RECORDINGS_PATH || REC_VOLUME_PATH;

const provider = process.env.AI_PROVIDER;
console.log('========================================');
console.log('  AI Call Agent - Host Analysis Worker');
console.log('========================================');
console.log(`AI Provider : ${provider}`);
console.log(`Redis       : ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
console.log(`Whisper     : ${process.env.WHISPER_URL}`);
console.log(`DB Path     : ${process.env.DB_PATH}`);
console.log(`Recordings  : ${process.env.RECORDINGS_PATH}`);
console.log('========================================');

// 워커 시작
const analysisWorker = require('../workers/analysisWorker');
analysisWorker.start();
