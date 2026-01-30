# PROJECT_MASTER_DOC

> **AI Call Agent** — AI 통화 녹취 및 분석/관제 시스템 마스터 문서
> 본 문서는 로컬 코드 분석 및 서버 실황 점검을 통해 교차 검증된 내용입니다.

---

## 1. 시스템 개요 (System Overview)

본 프로젝트 **AI Call Agent**는 **AI 통화 녹취 및 분석/관제 시스템**입니다.

직원이 Android 앱을 통해 통화 녹음 파일을 서버에 업로드하면, 시스템이 자동으로 다음을 수행합니다:
1. **STT (Speech-to-Text)**: Faster-Whisper가 음성을 한국어 텍스트로 변환
2. **대화 분리**: LLM이 상담원/고객 대화를 구분하여 재구성
3. **요약**: 핵심 내용을 개조식(Bullet points)으로 요약
4. **감정 분석**: 통화의 감정(positive/negative/neutral) 및 품질 점수(1~10) 산출
5. **고객명 추출**: 통화 내에서 언급된 고객 이름 자동 식별
6. **결과 판정**: 팀별 기준에 따라 통화 성공/실패/보류 자동 판정

관리자는 웹 대시보드를 통해 실시간 현황, 분석 결과, 통계 리포트를 조회합니다.

### 시스템 아키텍처

```
[Android App] ──upload──▶ [Backend API (Node.js :3000)]
                                  │
                          ┌───────┼───────┐
                          ▼       ▼       ▼
                      [Redis]  [SQLite] [Static Files]
                      (Queue)   (DB)    (Dashboard)
                          │
                    ┌─────┴─────┐
                    ▼           ▼
              [STT Server]  [Ollama LLM]
              (Whisper:9000) (Exaone:11434)
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              대화 분리    요약/감정   결과 판정

[Web Dashboard] ◀──Socket.io──▶ [Backend API]
```

---

## 2. 인프라 및 배포 환경 (Infrastructure & Deployment)

### 2.1 서버 환경
- **H/W**: N100 Mini PC (16GB RAM)
- **OS**: Ubuntu Linux (Docker Environment)
- **Local IP**: `192.168.68.103`
- **SSH**: [보안을 위해 .env 파일 참조]

### 2.2 외부 접속 정보
| 접속 방식 | 주소 | 용도 |
|:---|:---|:---|
| **DDNS (LAN)** | `http://loun.tplinkdns.com:3000` | 로컬 네트워크 내부 접속 |
| **Cloudflare Tunnel** | `https://api.wiselymobile.net` | 외부 인터넷 접속 (HTTPS) |

- DDNS 및 Cloudflare Tunnel 모두 Backend 컨테이너(port 3000)로 라우팅됩니다.
- APK 다운로드도 동일 주소에서 제공됩니다.

### 2.3 배포 방식
- **Docker Compose** 기반 컨테이너 오케스트레이션
- **멀티스테이지 빌드**: Dashboard → Backend에 포함하여 단일 컨테이너로 서빙
- 주요 컨테이너 (서버 실황 확인 완료):

| 컨테이너명 | 이미지 | 포트 | 메모리 제한 | 상태 |
|:---|:---|:---|:---|:---|
| `call-agent-backend` | ai-call-agent-backend (멀티스테이지) | **3000** (외부) | 512M | Running |
| `call-agent-stt` | ai-call-agent-stt-server (커스텀) | 9000 (내부) | 3G | Healthy |
| `call-agent-ollama` | ollama/ollama:latest | 11434 (내부) | 4G | Running |
| `call-agent-redis` | redis:7-alpine | 6379 (내부) | 256M | Healthy |
| `call-agent-tunnel` | cloudflare/cloudflared:latest | - (터널) | 128M | Running |

> **참고**: 같은 서버에서 `portainer`, `claude-ssh-server` 등 별도 프로젝트 컨테이너도 함께 운영 중입니다.

---

## 3. 기술 스택 (Tech Stack)

| 구분 | 기술 스택 | 버전/모델 | 상세 내용 |
|:---|:---|:---|:---|
| **Backend** | **Node.js** | >=18.0.0 | Express 4.18, Socket.io 4.7, Bull 4.12 (Queue), Multer, ioredis, axios |
| **Frontend** | **React** | 18.3 | Vite 5.3, TailwindCSS 3.4, React Router DOM 7, Recharts 3.7, Socket.io-client 4.7 |
| **Database** | **SQLite** | sql.js 1.13 | 인메모리 + 파일 동기화 (`database.sqlite`) |
| **AI (LLM)** | **Ollama** | exaone3.5:2.4b | LG AI Research 한국어 특화 모델 (1.6GB) |
| **AI (STT)** | **Faster-Whisper** | 1.1.0 | CTranslate2, CPU int8 양자화, Flask + Waitress 서버 |
| **Mobile** | **Native Kotlin** | compileSdk 35 | Retrofit 2.9, OkHttp 4.12, Coroutines, WorkManager |
| **Infra** | **Docker** | Compose v2 | Redis 7, Cloudflare Tunnel, 멀티스테이지 빌드 |

---

## 4. 주요 기능 (Key Features)

### 4.1 AI 분석 파이프라인 (5단계)

서버에 배포된 `ollamaService.js`의 분석 파이프라인은 **순차 실행** (N100 CPU 과부하 방지):

| 단계 | 기능 | 설명 |
|:---|:---|:---|
| **Step 1** | 대화 분리 (`formatConversation`) | STT 텍스트를 "상담원:" / "고객:" 형태로 분리 |
| **Step 2** | 요약 (`generateSummary`) | 핵심 내용을 3~5개 개조식 bullet point로 요약 |
| **Step 3** | 감정 분석 (`analyzeSentiment`) | positive/negative/neutral 감정 + 1~10점 점수 + 평가 이유 |
| **Step 4** | 고객명 추출 (`extractCustomerName`) | 통화 내 언급된 고객 이름 식별 (없으면 null) |
| **Step 5** | 결과 판정 (`analyzeOutcome`) | 팀별 기준에 따라 성공/실패/보류 자동 판정 |

> **스킵 조건**: 통화 시간 30초 미만 또는 STT 텍스트 50자 미만인 경우 AI 분석을 건너뜁니다.

### 4.2 팀별 맞춤 평가

| 팀 유형 | 성공 기준 | 실패 기준 |
|:---|:---|:---|
| **영업팀** | 구매확정, 긍정검토, 계약동의 | 가격부담, 타사비교, 필요없음, 단순거절, 재통화요청 |
| **민원/CS팀** | 방어확정, 민원철회, 안내수용 | 상급자요청, 보상요구, 해지요구, 방어실패 |
| **일반** | 목적달성, 고객만족 | 미해결, 고객불만 |

- `teams` 테이블에 커스텀 `evaluation_prompt`를 저장하면 해당 팀의 기본 프롬프트보다 우선 적용됩니다.
- 커스텀 프롬프트가 없는 경우, 팀 이름 패턴 매칭으로 기본 프롬프트가 자동 선택됩니다.

### 4.3 대시보드 페이지 구성

| 경로 | 페이지 | 설명 |
|:---|:---|:---|
| `/` | **LiveMonitor** | 실시간 현황 — 온라인 에이전트, 팀별 통계, 금일 요약 |
| `/reports` | **Reports** | 기간별 성과 보고서 — 날짜 범위 선택, 팀 필터, 에이전트별 KPI |
| `/analytics` | **Analytics** | 통계 분석 — 7일 추이(Line), 팀별 통화량(Bar), 수신/발신 비율(Pie) |
| `/history` | **History** | 통화 이력 — 검색, 필터, 페이지네이션, 상세 모달 |
| `/settings` | **Settings** | 에이전트 관리 — CRUD, 팀 배정, 전화번호 등록 |

### 4.4 모바일 앱 (Android)

- **패키지**: `com.antigravity.callguard.v2`
- **최소 SDK**: Android 8.0 (API 26) / **타겟 SDK**: Android 15 (API 35)
- **주요 기능**:
  - 통화 상태 감지 (BroadcastReceiver: `PHONE_STATE`)
  - 녹취 파일 자동 감지 및 업로드 (FileObserverService)
  - 백그라운드 업로드 서비스 (WorkManager)
  - 에이전트 등록 (RegisterActivity)
  - 주기적 Heartbeat 전송 (Redis TTL 7200초)
  - 부팅 시 자동 시작 (BootReceiver)
  - 배터리 최적화 예외 요청

---

## 5. 데이터 스키마 (Database Schema)

데이터베이스: **SQLite** (sql.js 라이브러리, 인메모리 + 파일 동기화)
- Docker 내부 경로: `/data/db/database.sqlite`
- 로컬 개발: `./database.sqlite`

### 5.1 calls 테이블 (통화 기록)

```sql
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT UNIQUE,
  phone_number TEXT,
  direction TEXT,                    -- 'IN' / 'OUT'
  status TEXT,
  recording_path TEXT,
  duration INTEGER,                  -- 통화 시간(초)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ai_analyzed BOOLEAN DEFAULT 0,
  uploader_name TEXT,                -- 업로더(직원) 이름
  uploader_phone TEXT,               -- 업로더 전화번호
  customer_name TEXT,                -- 고객명 (AI 추출)
  ai_emotion TEXT,                   -- positive/negative/neutral
  ai_score REAL,                     -- 1~10점
  ai_summary TEXT,                   -- AI 요약
  ai_status TEXT DEFAULT 'pending',  -- pending/processing/completed/failed
  team_name TEXT,                    -- 팀명 (agents 테이블 자동 매칭)
  start_time TEXT                    -- 통화 시작 시각 (ISO/timestamp)
);
-- 중복 방지 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dedup ON calls(uploader_phone, start_time);
```

### 5.2 analysis_results 테이블 (AI 분석 결과)

```sql
CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,                   -- calls.id 참조
  transcript TEXT,                   -- 상담원/고객 분리된 대화록
  summary TEXT,                      -- 개조식 요약
  sentiment TEXT,                    -- positive/negative/neutral
  sentiment_score REAL,              -- 1~10점
  checklist TEXT,                    -- 체크리스트 (JSON)
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_id) REFERENCES calls(id)
);
```

### 5.3 agents 테이블 (에이전트/직원)

```sql
CREATE TABLE IF NOT EXISTS agents (
  phone_number TEXT PRIMARY KEY,     -- 직원 전화번호 (PK)
  name TEXT,                         -- 직원 이름
  team_name TEXT,                    -- 소속 팀
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.4 teams 테이블 (팀 관리)

```sql
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,         -- 팀명
  description TEXT DEFAULT '',       -- 팀 설명
  evaluation_prompt TEXT,            -- 맞춤 AI 평가 프롬프트
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. API 엔드포인트 (API Reference)

**Base URL**: `http://localhost:3000` (개발) / `https://api.wiselymobile.net` (프로덕션)

### 6.1 모바일 앱 연동

| Method | Path | 설명 |
|:---|:---|:---|
| `POST` | `/api/webhook/call` | Android에서 통화 상태 이벤트 전송 |
| `POST` | `/api/upload` | 녹취 파일 + 메타데이터 업로드 (team_name 자동 매칭) |
| `POST` | `/api/heartbeat` | 에이전트 Heartbeat (Redis TTL 7200s) |

### 6.2 대시보드 데이터

| Method | Path | 설명 |
|:---|:---|:---|
| `GET` | `/api/calls` | 전체 통화 목록 (analysis_results JOIN) |
| `GET` | `/api/calls/:id` | 개별 통화 상세 |
| `GET` | `/api/stats` | 금일 통계 요약 |
| `GET` | `/api/online-agents` | 온라인 에이전트 목록 (Redis + agents JOIN) |
| `GET` | `/api/live-monitor` | 실시간 모니터 통합 데이터 (팀 요약 + 에이전트 + 일간 통계) |

### 6.3 에이전트 관리

| Method | Path | 설명 |
|:---|:---|:---|
| `GET` | `/api/agents` | 에이전트 목록 |
| `POST` | `/api/agents` | 에이전트 Upsert (전화번호 기준 생성/수정) |
| `PUT` | `/api/agents/:phone` | 에이전트 수정 |

### 6.4 팀 관리

| Method | Path | 설명 |
|:---|:---|:---|
| `GET` | `/api/teams` | 팀 목록 |
| `POST` | `/api/teams` | 팀 생성 |
| `PUT` | `/api/teams/:id` | 팀 수정 (evaluation_prompt 포함) |
| `DELETE` | `/api/teams/:id` | 팀 삭제 |

### 6.5 분석/통계

| Method | Path | 설명 |
|:---|:---|:---|
| `GET` | `/api/analytics/daily` | 7일간 일별 통화량 추이 |
| `GET` | `/api/analytics/team` | 팀별 통화 건수 |
| `GET` | `/api/analytics/direction` | 수신(IN)/발신(OUT) 비율 |
| `GET` | `/api/reports/stats` | 기간별 에이전트 성과 (query: startDate, endDate, team) |

### 6.6 시스템

| Method | Path | 설명 |
|:---|:---|:---|
| `GET` | `/health` | 헬스 체크 |
| `GET` | `*` | SPA fallback (index.html) |

---

## 7. 운영 매뉴얼 (User & Admin Manual)

### 7.1 직원용 (User - Mobile App)

1. **앱 설치**:
   - 최신 APK 다운로드: [call-agent-v2.3.apk](http://loun.tplinkdns.com:3000/call-agent-v2.3.apk)
   - 또는 외부 접속: `https://api.wiselymobile.net/call-agent-v2.3.apk`
   - 설치 시 "출처를 알 수 없는 앱" 허용 필요
2. **초기 등록**:
   - 앱 실행 → RegisterActivity에서 이름, 전화번호 입력 후 서버에 등록
   - 서버 주소: `http://loun.tplinkdns.com:3000` (내부망) 또는 `https://api.wiselymobile.net` (외부)
3. **사용**:
   - 앱이 백그라운드에서 통화를 감지하고 녹취 파일을 자동 업로드합니다.
   - 배터리 최적화 예외를 허용해야 안정적으로 동작합니다.
   - 부팅 시 자동으로 서비스가 시작됩니다.

### 7.2 관리자용 (Admin - Web Dashboard)

1. **대시보드 접속**:
   - 내부: `http://loun.tplinkdns.com:3000`
   - 외부: `https://api.wiselymobile.net`
2. **페이지별 기능**:
   - **실시간 현황** (`/`): 온라인 에이전트 상태, 팀별 실시간 통계, 금일 통화 요약 카드
   - **성과 보고서** (`/reports`): 날짜 범위 지정 + 팀 필터로 에이전트별 통화 건수, 평균 시간, 평균 점수 조회
   - **통계 분석** (`/analytics`): 7일 추이 라인 차트, 팀별 통화량 바 차트, IN/OUT 비율 파이 차트
   - **통화 이력** (`/history`): 전화번호/이름 검색, 상태 필터, 페이지네이션, 상세 모달(대화록 + 요약 + 감정 + 오디오)
   - **에이전트 관리** (`/settings`): 에이전트 CRUD, 팀 배정, 팀 생성/삭제, 맞춤 평가 프롬프트 설정

---

## 8. 개발 및 유지보수 가이드 (Development & Maintenance)

### 8.1 서버 접속 및 관리

```bash
# 서버 접속
ssh [사용자명]@192.168.68.103

# 프로젝트 폴더 이동
cd ~/ai-call-agent

# Docker 상태 확인
docker compose ps

# 전체 서비스 재시작 (업데이트 반영 시)
docker compose down && docker compose up -d --build

# 개별 서비스 로그 확인 (실시간)
docker compose logs -f backend
docker compose logs -f stt-server
docker compose logs -f ollama

# Ollama 모델 확인 및 설치
docker compose exec ollama ollama list
docker compose exec ollama ollama pull exaone3.5:2.4b

# 데이터베이스 백업
docker cp call-agent-backend:/data/db/database.sqlite ./backup_$(date +%Y%m%d).sqlite
```

### 8.2 로컬 개발 환경

```bash
# Backend 개발 서버
cd backend && npm run dev    # nodemon으로 자동 재시작 (port 3000)

# Dashboard 개발 서버
cd dashboard && npm run dev  # Vite dev server (port 5173, API proxy → 3000)
```

> **주의**: 로컬 개발 시 Redis, Whisper, Ollama가 별도로 실행 중이어야 합니다.
> `docker-compose.yml`에서 backend만 제외하고 나머지 서비스를 실행하는 것을 권장합니다.

### 8.3 프로덕션 빌드 및 배포

```bash
# Dashboard 빌드 후 Backend에 포함 (Docker 멀티스테이지 빌드가 자동 처리)
docker compose up -d --build

# 수동 빌드 (Docker 없이)
cd dashboard && npm run build              # → dashboard/dist/
cp -r dashboard/dist/* backend/public/     # Backend에 정적 파일 복사
cd backend && NODE_ENV=production node index.js
```

### 8.4 모바일 앱 빌드

```bash
# Android 빌드 (Windows)
cd android
gradlew.bat assembleRelease
# 생성 경로: android/app/build/outputs/apk/release/app-release.apk

# APK 배포: dashboard/public/에 복사하면 웹에서 다운로드 가능
cp app-release.apk ../dashboard/public/call-agent-v{버전}.apk
```

### 8.5 환경 변수 설정

모든 민감 정보는 `.env` 파일에서 관리합니다.

| 변수명 | 설명 | 기본값 |
|:---|:---|:---|
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel 인증 토큰 | [보안을 위해 .env 파일 참조] |
| `REDIS_HOST` | Redis 호스트 | `redis` (Docker) / `localhost` |
| `REDIS_PORT` | Redis 포트 | `6379` |
| `WHISPER_URL` | STT 서버 엔드포인트 | `http://stt-server:9000/asr` |
| `OLLAMA_URL` | Ollama API 엔드포인트 | `http://ollama:11434/api/generate` |
| `OLLAMA_MODEL` | LLM 모델명 | `exaone3.5:2.4b` |
| `DB_PATH` | SQLite 파일 경로 | `/data/db/database.sqlite` |
| `RECORDINGS_PATH` | 녹취 파일 저장 경로 | `/data/recordings` |
| `NODE_ENV` | 실행 환경 | `production` |
| `BACKEND_PORT` | Backend 포트 | `3000` |

> **경고**: `.env` 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 포함되어 있습니다.

---

## 9. 프로젝트 구조 (Project Structure)

```
ai-call-agent/
├── backend/                          # Node.js Express API 서버
│   ├── index.js                      # 엔트리 포인트 (라우트 인라인 정의)
│   ├── package.json                  # 의존성 (express, bull, sql.js, socket.io 등)
│   ├── Dockerfile                    # 멀티스테이지 빌드 (Dashboard 포함)
│   ├── services/
│   │   ├── databaseService.js        # SQLite (sql.js) DB 서비스 + 마이그레이션
│   │   ├── ollamaService.js          # Ollama LLM 연동 (5단계 분석 파이프라인)
│   │   ├── queueService.js           # Bull Queue (Redis) 작업 큐 관리
│   │   ├── uploadService.js          # Multer 파일 업로드 (m4a, mp3, wav 등)
│   │   └── whisperService.js         # Whisper STT API 연동 (3회 재시도)
│   ├── workers/
│   │   └── analysisWorker.js         # Bull 작업 처리기 (STT → LLM → DB)
│   └── scripts/
│       └── cleanup-duplicates.js     # 중복 데이터 정리 유틸리티
│
├── dashboard/                        # React 웹 대시보드 (활성)
│   ├── package.json                  # 의존성 (react 18, vite 5, tailwind, recharts)
│   ├── vite.config.js                # 빌드 설정 + API 프록시 (→ :3000)
│   ├── tailwind.config.js            # 디자인 토큰 (ink, surface, brand 등)
│   ├── src/
│   │   ├── main.jsx                  # BrowserRouter + Routes 정의
│   │   ├── App.jsx                   # Layout shell (Sidebar + Outlet)
│   │   ├── index.css                 # Pretendard 폰트 + Tailwind + 스크롤바
│   │   ├── utils.js                  # formatTime, formatSeconds, lastSeenText
│   │   ├── hooks/
│   │   │   └── useSocket.js          # Socket.io 싱글턴 훅
│   │   ├── components/
│   │   │   ├── Sidebar.jsx           # 좌측 고정 네비게이션 (220px)
│   │   │   ├── DetailModal.jsx       # 통화 상세 모달
│   │   │   ├── AudioPlayer.jsx       # HTML5 오디오 재생기
│   │   │   └── Badges.jsx            # Direction, Emotion, Score, AiStatus 배지
│   │   └── pages/
│   │       ├── LiveMonitor.jsx       # 실시간 현황 (에이전트 + 팀 통계)
│   │       ├── Reports.jsx           # 기간별 성과 보고서
│   │       ├── Analytics.jsx         # 차트 기반 통계 (Line, Bar, Pie)
│   │       ├── History.jsx           # 통화 이력 (검색 + 필터 + 상세)
│   │       └── Settings.jsx          # 에이전트/팀 관리 (CRUD)
│   └── public/
│       ├── call-agent-v2.3.apk       # 최신 APK 배포본
│       ├── call-agent-v2.2.apk       # 이전 버전
│       └── call-agent-v2.1.apk       # 이전 버전
│
├── ai-worker/                        # Python STT 서버
│   ├── stt_server.py                 # Flask + Waitress (port 9000)
│   ├── requirements.txt              # faster-whisper 1.1.0, flask 3.1.0
│   └── Dockerfile                    # Python 3.11-slim + ffmpeg
│
├── android/                          # Android Native 앱 (Kotlin)
│   ├── build.gradle.kts              # 프로젝트 설정 (Gradle 8.2, Kotlin 1.9)
│   └── app/
│       ├── build.gradle.kts          # 앱 설정 (minSdk=26, targetSdk=35)
│       └── src/main/
│           ├── AndroidManifest.xml   # 권한 및 컴포넌트 선언
│           └── java/.../             # Kotlin 소스 코드
│
├── frontend/                         # (레거시) 구버전 대시보드 — 사용하지 않음
├── docker-compose.yml                # 전체 시스템 컨테이너 설정
├── .env                              # 환경 변수 (Git 미포함)
├── .env.example                      # 환경 변수 템플릿
├── .gitignore                        # Git 제외 규칙
├── .dockerignore                     # Docker 빌드 제외 규칙
├── CLAUDE.md                         # 프로젝트 컨텍스트 (AI 어시스턴트용)
├── AGENTS.md                         # 3계층 아키텍처 문서
└── docs/
    └── PROJECT_MASTER_DOC.md         # 본 문서
```

> **참고**: `frontend/` 폴더는 초기 버전의 레거시 대시보드이며, 현재 `dashboard/` 폴더가 활성 버전입니다.

---

## 10. Docker Compose 상세 설정

```yaml
# 주요 서비스 요약 (전체 내용은 docker-compose.yml 참조)

services:
  redis:        # redis:7-alpine, maxmemory=256mb, allkeys-lru
  stt-server:   # 커스텀 빌드 (ai-worker/Dockerfile), Whisper small 모델
  ollama:       # ollama/ollama:latest, 볼륨: ollama_data
  backend:      # 멀티스테이지 빌드 (backend/Dockerfile), depends_on: redis, stt, ollama
  cloudflared:  # cloudflare/cloudflared:latest, 토큰은 .env에서 로드

networks:
  call-agent-network: bridge

volumes:
  call-agent-redis-data:      # Redis 영속 데이터
  call-agent-whisper-cache:   # Whisper 모델 캐시
  call-agent-ollama-data:     # Ollama 모델 데이터 (exaone3.5:2.4b, 1.6GB)
  call-agent-recordings:      # 녹취 파일 저장소
  call-agent-backend-data:    # SQLite DB 파일
```

---

## 11. 알려진 이슈 및 향후 과제

1. **로컬 vs 서버 코드 불일치**: `ollamaService.js`의 로컬 버전과 서버 배포 버전이 다릅니다. 서버 버전에 `analyzeOutcome()` (결과 판정) 기능이 추가되어 있으나, 로컬 코드에는 아직 반영되지 않았습니다. → Git 동기화 필요
2. **Analytics 페이지 데이터 검증**: 실 데이터 기반 차트 렌더링 확인 필요
3. **팀 매칭 로직 E2E 테스트**: 업로드 시 agents 테이블 기반 team_name 자동 매칭 정상 동작 검증 필요
4. **APK 버전 관리**: `dashboard/public/`에 수동 복사 방식 → CI/CD 자동화 고려

---

## Update Log

| 날짜 | 버전 | 변경 내용 | 작성자 |
|:---|:---|:---|:---|
| 2026-01-30 | **v1.0.0** | 프로젝트 문서 초기화, 로컬 코드 및 서버 환경 동기화 완료. 초안 대비 24개 항목 교차 검증 및 수정 반영. | Claude |

### v1.0.0 교차 검증 결과 요약

**수정된 항목:**
- Mobile 기술 스택: ~~React Native~~ → **Native Kotlin Android** (Retrofit, OkHttp, WorkManager)
- `vite.config.ts` → `vite.config.js` (TypeScript 미사용)
- `Server.js or index.js` → `index.js` (단일 엔트리 포인트, 라우트 인라인)
- `routes/` 폴더 언급 삭제 (존재하지 않음)
- APK 다운로드 링크 추가 (`/call-agent-v2.3.apk`)
- Cloudflare Tunnel 도메인 추가 (`api.wiselymobile.net`)
- `.env` 토큰 값 마스킹 처리

**추가된 항목:**
- AI 분석 파이프라인 5단계 상세 (서버 실제 배포 기준)
- 팀별 맞춤 평가 기준 (영업팀, 민원팀, 일반)
- `analyzeOutcome()` 성공/실패 판정 로직
- `teams` 테이블 스키마 및 커스텀 evaluation_prompt
- Reports 페이지 (`/reports`) 기능 설명
- Teams CRUD API 엔드포인트
- `/api/reports/stats`, `/api/live-monitor`, `/api/webhook/call` 엔드포인트
- 환경 변수 전체 목록 테이블
- Docker 볼륨 및 네트워크 상세
- 멀티스테이지 빌드 설명
- `ai-worker/` 폴더 구조 및 STT 서버 상세
- `frontend/` 레거시 폴더 안내
- 로컬 vs 서버 코드 불일치 이슈 기록
