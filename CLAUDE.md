# AI Call Agent — Project Context

## 1. 디자인 시스템 (확정)

- **Font**: Pretendard Variable (CDN, `dashboard/src/index.css`에서 로드)
- **컬러셋**: 그레이스케일 기반 Notion/Tally 스타일
  - 페이지 배경: `#F7F7FB` (`bg-surface-page`)
  - 카드/모달: `#FFFFFF` (`bg-surface`)
  - 패널/hover: `#F1F1F5` (`bg-surface-panel`)
  - 기본 텍스트: `#111111` (`text-ink`)
  - 보조 텍스트: `#505050` (`text-ink-secondary`)
  - 라벨/비활성: `#767676` (`text-ink-tertiary`)
  - 테두리: `#E5E5EC` (`border-line`)
- **포인트 컬러**: `#3366FF` (`text-brand` / `bg-brand`) — 액션, 링크, 활성 상태
- **상세 디자인 토큰**: `dashboard/CLAUDE.md` 참조

## 2. 레이아웃 구조 (확정)

- **좌측 고정 사이드바** (220px, `w-[220px]`) + **우측 메인 콘텐츠** (`ml-[220px]`)
- 사이드바: `bg-surface-page`, `border-r border-line`, 고정 위치 (`fixed left-0 top-0 bottom-0`)
- React Router 기반 SPA 라우팅:
  - `/` — LiveMonitor (실시간 현황)
  - `/analytics` — Analytics (통계 분석, recharts)
  - `/history` — History (통화 이력 + 필터)
  - `/settings` — Settings (에이전트 CRUD)
- 컴포넌트 구조:
  - `App.jsx` — Layout shell (Sidebar + Outlet)
  - `main.jsx` — BrowserRouter + Routes 정의

## 3. 데이터 스키마

### agents 테이블 (신규)
```sql
CREATE TABLE IF NOT EXISTS agents (
  phone_number TEXT PRIMARY KEY,
  name TEXT,
  team_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### calls 테이블 (확장 컬럼)
| Column | Type | 설명 |
|--------|------|------|
| phone_number | TEXT | 고객 전화번호 |
| direction | TEXT | IN / OUT |
| status | TEXT | 통화 상태 |
| recording_path | TEXT | 녹취 파일 경로 |
| duration | INTEGER | 통화 시간(초) |
| uploader_name | TEXT | 업로더(직원) 이름 |
| uploader_phone | TEXT | 업로더 전화번호 |
| customer_name | TEXT | 고객명 (AI 추출 가능) |
| team_name | TEXT | 팀명 (agents 테이블에서 자동 매칭) |
| ai_emotion | TEXT | AI 감정 분석 결과 |
| ai_score | REAL | AI 점수 (0~10) |
| ai_summary | TEXT | AI 요약 |
| ai_status | TEXT | pending / processing / completed / failed |
| ai_analyzed | BOOLEAN | 분석 완료 여부 |

### API 엔드포인트
- `GET /api/calls` — 전체 통화 목록 (analysis JOIN)
- `GET /api/calls/:id` — 개별 통화 상세
- `GET /api/stats` — 금일 통계
- `GET /api/online-agents` — 온라인 에이전트 (Redis + agents 테이블 JOIN, teamName 포함)
- `GET /api/agents` — 에이전트 목록
- `POST /api/agents` — 에이전트 upsert
- `PUT /api/agents/:phone` — 에이전트 수정
- `GET /api/analytics/daily` — 7일간 일별 통화량
- `GET /api/analytics/team` — 팀별 통화 건수
- `GET /api/analytics/direction` — 수신/발신 비율
- `POST /api/upload` — 녹취 업로드 (team_name 자동 매칭)
- `POST /api/heartbeat` — 앱 heartbeat (Redis TTL 7200s)

## 4. 파일 구조

```
backend/
  index.js                        — Express 서버 + API 라우트
  services/databaseService.js     — SQLite (sql.js) DB 서비스
  services/queueService.js        — BullMQ 큐
  services/uploadService.js       — Multer 업로드
  workers/analysisWorker.js       — AI 분석 워커

dashboard/src/
  main.jsx                        — BrowserRouter + Routes
  App.jsx                         — Layout shell (Sidebar + Outlet)
  index.css                       — Pretendard + Tailwind + 스크롤바
  utils.js                        — formatTime, formatSeconds, lastSeenText
  hooks/useSocket.js              — Socket.io 싱글턴 훅
  components/
    Sidebar.jsx                   — 좌측 고정 네비게이션
    Badges.jsx                    — DirectionBadge, EmotionBadge, ScoreBadge, AiStatusBadge
    DetailModal.jsx               — 통화 상세 모달
    AudioPlayer.jsx               — 녹취 재생기
  pages/
    LiveMonitor.jsx               — 실시간 현황 (통계 카드 + 팀별 에이전트 그리드)
    Analytics.jsx                 — 통계 분석 (recharts: Line, Bar, Pie)
    History.jsx                   — 통화 이력 (필터 + 테이블 + DetailModal)
    Settings.jsx                  — 에이전트 관리 (CRUD 테이블)

android/
  app/build/outputs/apk/debug/app-debug.apk  — 최신 빌드 (v4.0)
```

## 5. 기술 스택

- **Backend**: Node.js, Express, Socket.io, sql.js (SQLite), Redis (ioredis), BullMQ
- **Frontend**: React 18, Vite 5, Tailwind CSS 3, React Router DOM, Recharts, Socket.io-client
- **Android**: Kotlin, Gradle (assembleDebug)

## 6. 미결 사항 (다음 세션 우선순위)

1. **대시보드 시각적 완성도 개선** — 사이드바 고정 레이아웃 및 그리드 배치의 정밀 조정, 반응형 대응
2. **Analytics 페이지 데이터 검증** — 실 데이터 기반으로 차트 렌더링 확인
3. **팀 매칭 로직 검증** — 업로드 시 agents 테이블 기반 team_name 자동 매칭이 정상 동작하는지 E2E 테스트
4. **빌드 산출물 배포** — `dashboard/dist/`를 `backend/public/`으로 복사하여 프로덕션 서빙 확인

## 7. 빌드 & 배포 명령어

```bash
# Dashboard 빌드
cd dashboard && npx vite build

# 프로덕션 배포 (빌드 결과물을 backend/public으로 복사)
cp -r dashboard/dist/* backend/public/

# Backend 실행
cd backend && node index.js

# Android APK 빌드
cd android && gradlew.bat assembleDebug
```
