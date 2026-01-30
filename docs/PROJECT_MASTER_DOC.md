# AI Call Agent - Project Master Document

> **N100 Ubuntu Server (16GB RAM) 기반 AI 통화 분석 시스템**
> 최종 업데이트: 2026-01-30

---

## 1. 프로젝트 개요

Android 단말에서 통화 녹음을 캡처하여 서버로 업로드하고, AI가 자동으로 STT(음성→텍스트), 감정 분석, 품질 점수, 요약, 고객명 추출, 통화 결과 판정을 수행하는 콜센터 관리 시스템.

### 핵심 기능
- Android 앱: 통화 상태 감지, 녹음 파일 자동 업로드, Heartbeat
- AI 분석 파이프라인: Whisper STT → LLM 분석 (Ollama / Claude / Gemini / Codex)
- 실시간 대시보드: 에이전트 현황, 통화 이력, 통계, 팀/에이전트 관리
- Docker 기반 배포: Redis, STT, Ollama, Backend, Cloudflare Tunnel

---

## 2. 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| **Backend** | Node.js, Express, Socket.io | 18+, 4.18, 4.7 |
| **DB** | sql.js (SQLite) | 1.13 |
| **Queue** | Bull (Redis-backed) | 4.12 |
| **Cache** | ioredis | 5.3 |
| **Frontend** | React, Vite, Tailwind CSS | 18.3, 5.3, 3.4 |
| **Charts** | Recharts | 3.7 |
| **Real-time** | Socket.io-client | 4.7 |
| **Android** | Kotlin, Gradle | compileSdk 35 |
| **STT** | faster-whisper (Python) | 1.1 |
| **LLM** | Ollama (exaone3.5:2.4b) | latest |
| **LLM CLI** | Claude Code, Gemini CLI, Codex CLI | 2.1, 0.25, 0.89 |
| **Infra** | Docker Compose, Cloudflare Tunnel | - |

---

## 3. 디렉토리 구조

```
ai-call-agent/
├── backend/
│   ├── index.js                      # Express 서버 + API 라우트 (462줄)
│   ├── Dockerfile                    # 멀티스테이지 빌드 (Dashboard + Backend)
│   ├── package.json
│   ├── routes/
│   │   └── queueRoutes.js           # 큐 관리 API (172줄)
│   ├── services/
│   │   ├── databaseService.js       # SQLite DB 서비스 (682줄)
│   │   ├── queueService.js          # Bull Queue 관리 (327줄)
│   │   ├── uploadService.js         # Multer 파일 업로드
│   │   ├── whisperService.js        # Whisper STT 연동
│   │   ├── ollamaService.js         # Ollama LLM 연동 (351줄)
│   │   └── aiCliService.js          # CLI 기반 AI 프로바이더 (451줄)
│   ├── workers/
│   │   └── analysisWorker.js        # AI 분석 워커 (197줄)
│   └── scripts/
│       ├── startWorkerHost.js       # 호스트 워커 단독 실행
│       └── cleanup-duplicates.js    # DB 정리 스크립트
│
├── dashboard/
│   ├── src/
│   │   ├── main.jsx                 # BrowserRouter + Routes
│   │   ├── App.jsx                  # Layout (Sidebar + Outlet)
│   │   ├── index.css                # Pretendard + Tailwind + 디자인 토큰
│   │   ├── utils.js                 # 유틸 함수
│   │   ├── hooks/useSocket.js       # Socket.io 싱글턴
│   │   ├── components/
│   │   │   ├── Sidebar.jsx          # 좌측 네비게이션 (220px)
│   │   │   ├── Badges.jsx           # 상태 배지
│   │   │   ├── DetailModal.jsx      # 통화 상세 모달
│   │   │   └── AudioPlayer.jsx      # 녹취 재생기
│   │   └── pages/
│   │       ├── LiveMonitor.jsx      # 실시간 현황 (347줄)
│   │       ├── Analytics.jsx        # 통계 차트 (162줄)
│   │       ├── History.jsx          # 통화 이력 (495줄)
│   │       ├── Reports.jsx          # 성과보고서 (325줄)
│   │       └── Settings.jsx         # 에이전트/팀 관리 (438줄)
│   └── CLAUDE.md                    # 디자인 시스템 명세
│
├── android/
│   └── app/src/main/java/com/antigravity/callagent/
│       ├── MainActivity.kt          # 메인 UI + 권한 관리
│       ├── RegisterActivity.kt      # 사용자 등록
│       ├── CallReceiver.kt          # 통화 상태 감지
│       ├── FileObserverService.kt   # 녹음 파일 모니터링
│       ├── UploadService.kt         # 파일 업로드
│       ├── HeartbeatWorker.kt       # 주기적 Heartbeat
│       ├── BootReceiver.kt          # 부팅 시 자동 시작
│       ├── NetworkModule.kt         # Retrofit + OkHttp
│       └── UserPreferences.kt       # SharedPreferences
│
├── ai-worker/
│   ├── Dockerfile                   # Python 3.11 + FFmpeg + faster-whisper
│   ├── requirements.txt
│   └── stt_server.py               # Flask STT HTTP 서버
│
├── deploy/
│   ├── auto-deploy.sh              # Git 변경 감지 자동 배포
│   └── setup-cron.sh               # Cron 설정
│
├── docker-compose.yml               # 전체 서비스 오케스트레이션
├── .env                             # CLOUDFLARE_TUNNEL_TOKEN
└── CLAUDE.md                        # 프로젝트 컨텍스트
```

---

## 4. 데이터베이스 스키마

### calls 테이블 (통화 기록)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| phone_number | TEXT | 고객 전화번호 |
| direction | TEXT | IN / OUT |
| status | TEXT | 통화 상태 |
| recording_path | TEXT | 녹취 파일 경로 |
| duration | INTEGER | 통화 시간(초) |
| created_at | DATETIME | 서버 기록 시간 |
| uploader_name | TEXT | 업로더(직원) 이름 |
| uploader_phone | TEXT | 업로더 전화번호 (+82...) |
| customer_name | TEXT | 고객명 (AI 추출) |
| team_name | TEXT | 팀명 (자동 매칭) |
| start_time | TEXT | 통화 시작 시각 (중복 방지) |
| outcome | TEXT | 통화 결과 (성공/실패/보류) |
| ai_emotion | TEXT | 감정 (positive/negative/neutral) |
| ai_score | REAL | 품질 점수 (0~10) |
| ai_summary | TEXT | AI 요약 |
| ai_status | TEXT | pending/processing/completed/failed |

**중복 방지**: `UNIQUE(uploader_phone, start_time)`

### analysis_results 테이블 (AI 분석 결과)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| call_id | INTEGER FK | calls.id 참조 |
| transcript | TEXT | 포맷된 대화 (상담원:/고객:) |
| raw_transcript | TEXT | 원본 STT 텍스트 |
| summary | TEXT | 개조식 요약 |
| sentiment | TEXT | 감정 분석 |
| sentiment_score | REAL | 감정 점수 |
| analyzed_at | DATETIME | 분석 완료 시각 |

### agents 테이블 (에이전트)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| phone_number | TEXT PK | 전화번호 |
| name | TEXT | 이름 |
| team_name | TEXT | 팀 이름 |
| team_id | INTEGER | teams.id FK |

### teams 테이블 (팀)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| name | TEXT UNIQUE | 팀 이름 |
| evaluation_prompt | TEXT | 팀별 AI 평가 프롬프트 |

---

## 5. API 엔드포인트

### 통화 관련
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/webhook/call` | Android 통화 상태 웹훅 |
| POST | `/api/upload` | 녹취 파일 업로드 + 분석 큐 등록 |
| GET | `/api/calls` | 전체 통화 목록 (analysis JOIN) |
| GET | `/api/calls/:id` | 개별 통화 상세 |

### 실시간 모니터링
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/heartbeat` | Android Heartbeat (Redis TTL 2시간) |
| GET | `/api/online-agents` | 온라인 에이전트 목록 |
| GET | `/api/call-states` | 현재 진행 중인 통화 |
| GET | `/api/agent-daily-stats` | 에이전트별 금일 통계 |

### 통계/분석
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/stats` | 금일 통계 |
| GET | `/api/analytics/daily` | 7일간 일별 통화량 |
| GET | `/api/analytics/team` | 팀별 통화 건수 |
| GET | `/api/analytics/direction` | 수신/발신 비율 |
| GET | `/api/reports/stats` | 기간별 성과보고서 |

### 에이전트/팀 CRUD
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET/POST | `/api/agents` | 목록 / 생성 |
| PUT/DELETE | `/api/agents/:phone` | 수정 / 삭제 |
| GET/POST | `/api/teams` | 목록 / 생성 |
| PUT/DELETE | `/api/teams/:id` | 수정 / 삭제 |

### 큐 관리
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/queue/stats` | 큐 상태 |
| GET | `/api/queue/jobs` | 최근 작업 목록 |
| POST | `/api/queue/jobs/:id/retry` | 실패 작업 재시도 |
| POST | `/api/queue/retry-all` | 전체 실패 재시도 |
| POST | `/api/queue/clean` | 오래된 작업 정리 |

---

## 6. AI 분석 파이프라인

### 처리 흐름

```
Android 녹취 업로드
       ↓
POST /api/upload → DB 저장 (ai_status='pending')
       ↓
Bull Queue 등록 → Redis 브로커
       ↓
analysisWorker.js 처리 (동시성: 1)
       ↓
┌──────────────────────────────────────┐
│ Step 1: Whisper STT                  │
│   POST http://stt-server:9000/asr   │
│   → 음성 → 텍스트 변환             │
├──────────────────────────────────────┤
│ Step 2: 최소 기준 확인              │
│   - 통화 30초 이상?                 │
│   - STT 텍스트 50자 이상?           │
│   → 미달 시 평가 생략              │
├──────────────────────────────────────┤
│ Step 3: 팀별 평가 프롬프트 조회     │
│   teams.evaluation_prompt 사용      │
├──────────────────────────────────────┤
│ Step 4: AI 분석 (5단계)             │
│   4-1. 대화 분리 (상담원/고객)      │
│   4-2. 개조식 요약                  │
│   4-3. 감정 분석 + 점수 (0~10)      │
│   4-4. 고객명 추출                  │
│   4-5. 통화 결과 판정               │
├──────────────────────────────────────┤
│ Step 5: DB 저장                     │
│   analysis_results INSERT           │
│   calls UPDATE (ai_status=completed)│
└──────────────────────────────────────┘
       ↓
Socket.io → 대시보드 실시간 업데이트
```

### AI 프로바이더 설정

| 프로바이더 | 환경변수 | 호출 방식 | 비고 |
|-----------|---------|----------|------|
| **Ollama** (기본) | `AI_PROVIDER=ollama` | HTTP API | Docker 내부 |
| **Claude** | `AI_PROVIDER=claude` | CLI stdin pipe | 호스트에서 실행 |
| **Gemini** | `AI_PROVIDER=gemini` | CLI positional arg | 호스트에서 실행 |
| **Codex** | `AI_PROVIDER=codex` | CLI positional arg | 호스트에서 실행 |

CLI 도구 경로: `/home/sustn7149/.npm-global/bin/`

**Fallback**: CLI 프로바이더 실패 시 자동으로 Ollama로 전환

---

## 7. Docker 서비스 구성

### 서비스별 상세

| 서비스 | 이미지 | 포트 | 메모리 | 역할 |
|--------|--------|------|--------|------|
| redis | redis:7-alpine | 6379 | 256MB | Bull Queue 브로커 + 상태 캐시 |
| stt-server | ./ai-worker (빌드) | 9000 | 3GB | Whisper STT 서버 |
| ollama | ollama/ollama | - | 4GB | LLM (exaone3.5:2.4b) |
| backend | ./backend (빌드) | 3000 | 512MB | API + 대시보드 + 워커 |
| cloudflared | cloudflare/cloudflared | - | 128MB | Cloudflare Tunnel |

**총 메모리**: ~8GB (여유 ~8GB)

### Named Volumes
```
call-agent-redis-data      # Redis 영속 데이터
call-agent-whisper-cache   # Whisper 모델 캐시
call-agent-ollama-data     # Ollama 모델 저장
call-agent-recordings      # 녹취 파일
call-agent-backend-data    # SQLite DB
```

### 네트워크
- `call-agent-network` (bridge)
- 서비스 간 통신: 서비스명으로 접근 (redis, stt-server, ollama, backend)

---

## 8. 프론트엔드 라우팅

| 경로 | 페이지 | 주요 기능 |
|------|--------|----------|
| `/` | LiveMonitor | 에이전트 현황, 통화 상태, 금일 KPI |
| `/reports` | Reports | 기간별 성과보고서, 팀/에이전트 통계 |
| `/analytics` | Analytics | 일별/팀별/수발신 차트 |
| `/history` | History | 통화 이력 테이블 + 상세 모달 |
| `/settings` | Settings | 에이전트/팀 CRUD |

### 디자인 시스템
- **Font**: Pretendard Variable (CDN)
- **배경**: `#F7F7FB` / **카드**: `#FFFFFF` / **패널**: `#F1F1F5`
- **텍스트**: `#111111` / `#505050` / `#767676`
- **포인트**: `#3366FF` / **테두리**: `#E5E5EC`
- **Sidebar**: 220px 고정, `border-r`, fixed position

---

## 9. Android 앱 구조

### 주요 클래스

| 클래스 | 역할 |
|--------|------|
| MainActivity | 메인 UI, 권한 요청, 서비스 시작 |
| RegisterActivity | 사용자 등록 (이름 + 전화번호) |
| CallReceiver | BroadcastReceiver - 통화 상태 감지 → 웹훅 |
| FileObserverService | Foreground Service - 녹음 파일 모니터링 |
| UploadService | Multipart 파일 업로드 |
| HeartbeatWorker | WorkManager - 60초 주기 Heartbeat |
| BootReceiver | 부팅 시 서비스 자동 재시작 |

### 필요 권한
- READ_PHONE_STATE, READ_CALL_LOG, READ_CONTACTS
- READ_MEDIA_AUDIO, MANAGE_EXTERNAL_STORAGE
- FOREGROUND_SERVICE, POST_NOTIFICATIONS
- RECEIVE_BOOT_COMPLETED, WAKE_LOCK
- REQUEST_IGNORE_BATTERY_OPTIMIZATIONS

### 빌드
```bash
cd android && ./gradlew assembleDebug
# 출력: app/build/outputs/apk/debug/app-debug.apk
```

---

## 10. Redis 키 구조

```
online_status:{phone}     # 에이전트 온라인 상태 (TTL 2시간)
  { userName, userPhone, lastSeen }

call_state:{phone}        # 현재 통화 상태 (TTL 2시간)
  { status, number, direction, userName, startTime }
```

---

## 11. 배포

### Auto-Deploy (deploy/auto-deploy.sh)
- Cron 1분 주기로 `git fetch` → 변경 감지 → 자동 rebuild
- `dashboard/` 변경 → `docker compose up -d --build backend`
- `backend/` 변경 → `docker compose up -d --build backend`
- `ai-worker/` 변경 → `docker compose up -d --build stt-server`
- `docker-compose.yml` 변경 → 전체 rebuild

### 수동 배포
```bash
# 서버에서 실행
cd ~/ai-call-agent
git pull origin main
docker compose up -d --build
```

### 호스트 워커 실행 (CLI AI 사용 시)
```bash
# Docker backend에서 내장 워커 비활성화
# docker-compose.yml: DISABLE_WORKER=true

# 호스트에서 워커 실행
cd ~/ai-call-agent
AI_PROVIDER=claude node backend/scripts/startWorkerHost.js
```

---

## 12. 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| NODE_ENV | production | 실행 환경 |
| REDIS_HOST | localhost | Redis 호스트 |
| REDIS_PORT | 6379 | Redis 포트 |
| WHISPER_URL | http://localhost:9000/asr | STT 엔드포인트 |
| OLLAMA_URL | http://localhost:11434/api/generate | LLM 엔드포인트 |
| OLLAMA_MODEL | exaone3.5:2.4b | Ollama 모델 |
| DB_PATH | ./database.sqlite | SQLite 파일 경로 |
| RECORDINGS_PATH | ./recordings | 녹취 저장 경로 |
| DASHBOARD_PATH | ./public | 대시보드 정적 파일 |
| AI_PROVIDER | ollama | AI 프로바이더 (ollama/claude/gemini/codex) |
| DISABLE_WORKER | false | 내장 워커 비활성화 |
| AI_CLI_BIN | /home/sustn7149/.npm-global/bin | CLI 도구 경로 |
| CLAUDE_MODEL_FAST | haiku | Claude 빠른 모델 |
| CLAUDE_MODEL_SMART | sonnet | Claude 정확한 모델 |
| WHISPER_MODEL | small | Whisper 모델 크기 |
| CLOUDFLARE_TUNNEL_TOKEN | - | Cloudflare 터널 토큰 |

---

## 13. 서버 인프라

### N100 서버
- **CPU**: Intel N100 (4코어, 저전력)
- **RAM**: 16GB
- **OS**: Ubuntu Server
- **Docker 총 메모리**: ~8GB 사용
- **공인 IP**: 동적 (TP-Link DDNS: `loun.tplinkdns.com`)
- **외부 접근**: Cloudflare Tunnel (`api.wiselymobile.net`)

### 설치된 CLI 도구
```
/home/sustn7149/.npm-global/bin/
├── claude     # @anthropic-ai/claude-code@2.1.17
├── gemini     # @google/gemini-cli@0.25.1
└── codex      # codex-cli@0.89.0
```

---

## 14. Socket.io 이벤트

| 이벤트 | 방향 | 데이터 | 설명 |
|--------|------|--------|------|
| call-status | Server→Client | { status, number, userPhone, ... } | 통화 상태 변경 |
| analysis-progress | Server→Client | { jobId, progress } | 분석 진행률 |
| analysis-complete | Server→Client | { jobId, result } | 분석 완료 |
| analysis-failed | Server→Client | { jobId, error } | 분석 실패 |
