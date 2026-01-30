# AI Call Agent 수정 계획 (2026-01-30)

본 문서는 금일 진행할 AI Call Agent의 UI/UX 개선 및 로직 수정 사항에 대한 계획입니다.

## 1. 개요 (Overview)

- **목표**: 통화 이력 상세 화면의 가독성 개선, 전화번호 시인성 확보, AI 분석 로직의 정확성(원문 유지) 강화.
- **대상**: 웹 대시보드 (`dashboard`), 백엔드 AI 분석 서비스 (`backend`).

---

## 2. UI/UX 개선 (Dashboard)

### 2.1 통화 이력 상세 모달 리디자인 (`DetailModal.jsx`)

- **변경 전**: 단일 컬럼 레이아웃, 좁은 폭 (`max-w-[680px]`).
- **변경 후**: **좌우 분할 레이아웃**, 광폭 모드 (`max-w-[1200px] w-[90vw]`).

#### 좌측 패널 (w-[380px], 고정폭)
1. **메타 정보 카드**: 고객명, 전화번호(하이픈 적용), 담당자, 팀명, 통화시간, 통화시각
2. **오디오 플레이어**: `AudioPlayer` 컴포넌트 (녹취 파일 있을 때만)
3. **AI 분석 결과**:
   - 감정 + 점수 (기존 `getEmotionLabel`/`getEmotionStyle` 활용)
   - AI 요약 (`ai_summary`) — AI가 대화 내용을 분석하여 정리한 요약문

#### 우측 패널 (flex-1, 나머지 폭 전부)
1. **통화 원문 (Transcript)** 전용 공간
2. 대화 내용을 **채팅 형식으로 렌더링**:
   - `상담원:` 라인 → 좌측 정렬, `bg-surface-panel` 배경
   - `고객:` 라인 → 우측 정렬, `bg-brand-light` 배경
   - 화자 라벨 불명 → 좌측, 기본 스타일
3. **전체 높이 스크롤**: `overflow-y-auto`, 모달 높이에 맞춤 (`max-h-[80vh]`)
4. 원문이 없거나 빈 경우 → "통화 내용이 아직 없습니다" placeholder 표시

#### AI 미분석 상태 처리
- `ai_analyzed !== 1`인 경우: 좌우 분할 대신 **기존 단일 컬럼 레이아웃** 유지
- "AI 분석 진행 중" / "분석 대기 중" / "분석 실패" 안내 메시지 그대로 표시

#### 반응형 대응
- 현재 대시보드는 `ml-[220px]` 고정 사이드바 기준이므로, 모달 `max-w-[1200px]`에서 가용 폭은 약 `calc(100vw - 220px)` 이내
- 모달은 `fixed inset-0 z-50` 오버레이이므로 사이드바와 독립적, 문제없음

### 2.2 전화번호 표시 방식 변경

- **대상 파일**: `dashboard/src/utils.js` (유틸 함수 추가)
- **적용 위치** (전화번호가 표시되는 모든 곳):
  - `History.jsx` 테이블 전화번호 컬럼 (line 184)
  - `DetailModal.jsx` 헤더 영역 (line 26)
  - `DetailModal.jsx` 하단 메타 (line 117)

#### 포맷 규칙 (`formatPhoneNumber` 함수)
```
010XXXXXXXX  → 010-XXXX-XXXX  (11자리 휴대폰)
02XXXXXXXX   → 02-XXXX-XXXX   (10자리 서울)
02XXXXXXX    → 02-XXX-XXXX    (9자리 서울)
0XXXXXXXXXX  → 0XX-XXXX-XXXX  (11자리 지역)
0XXXXXXXXX   → 0XX-XXX-XXXX   (10자리 지역)
이미 하이픈 포함 → 그대로 반환 (멱등성 보장)
기타          → 원본 그대로 반환
```

### 2.3 반복 통화 카운트 표시

- **대상**: `History.jsx` 통화 이력 테이블
- **알고리즘**:
  1. 전체 `calls` 배열에서 동일 `phone_number`를 가진 통화를 시간순(오래된 것부터)으로 정렬
  2. 같은 번호의 n번째 통화에 `(n)` 순번 부여
  3. 해당 번호로 통화가 1건뿐이면 카운트 미표시
- **UI**: 전화번호 옆에 `<span>` 태그, `text-[8px] text-ink-tertiary ml-1`
- **예시**: `010-1234-5678` <sup style="font-size:8px">(3)</sup>

#### 구현 위치
- `History.jsx`의 `useMemo` 영역에서 `callCountMap` 생성:
  ```js
  // phone_number별 통화 목록을 시간순 정렬 후 순번 매핑
  // key: call.id, value: { index: n, total: N }
  ```
- 테이블 렌더링 시 `callCountMap[call.id]`로 순번 조회

---

## 3. 백엔드 로직 수정 (Backend)

### 3.1 AI 대화 재구성 프롬프트 변경 (`ollamaService.js`)

#### 현재 문제점
- `reformatTranscript()` 함수 (line 77~97)의 프롬프트가 "원문의 의미를 그대로 유지하세요"라고만 지시
- AI가 문법을 교정하거나, 표현을 다듬거나, 욕설을 순화할 가능성이 있음
- "의미 유지"와 "원문 유지"는 다른 개념 — **"의미"가 아닌 "글자 그대로"**를 요구해야 함

#### 변경 방향
- **Whisper STT 출력**: 화자 구분 없는 연속 텍스트 (speaker diarization 없음)
- **AI 역할 제한**: 화자 라벨링(`상담원:` / `고객:`)만 수행, 텍스트 내용 일절 변경 금지
- 프롬프트에 명시할 규칙:
  1. STT 원문의 모든 단어, 문장, 표현을 **한 글자도 바꾸지 마세요**
  2. 욕설, 비속어, 문법 오류, 말더듬, 반복 표현 → **절대 수정/삭제/순화 금지**
  3. 역할은 오직 "상담원:" 또는 "고객:" 라벨을 줄 앞에 붙이는 것뿐
  4. 내용 추가, 삭제, 요약, 의역 일절 금지
  5. 한 줄에 하나의 발화만 작성

#### 변경 대상 코드
- **파일**: `backend/services/ollamaService.js`
- **함수**: `reformatTranscript()` (line 77~97) — 프롬프트 문자열 교체
- **다른 함수 영향 없음**: `generateTeamAnalysis()`는 요약/평가 담당이므로 변경 불필요

### 3.2 원본 텍스트 보존 (신규)

#### 현재 데이터 흐름
```
Whisper STT → rawText (메모리만) → reformatTranscript(rawText) → DB 저장
                                                                  ↑
                                                     원본은 사라짐
```

#### 개선: `raw_transcript` 컬럼 추가
- `analysis_results` 테이블에 `raw_transcript TEXT` 컬럼 추가
- `analysisWorker.js`에서 AI 처리 전의 원본 STT 텍스트를 함께 저장
- 감사(audit) 목적 + 나중에 프롬프트 개선 시 재처리 가능

#### 변경 대상
- `backend/services/databaseService.js`: `addColumnIfNotExists('analysis_results', 'raw_transcript', 'TEXT')` 추가, `saveAnalysisResult()` 수정
- `backend/workers/analysisWorker.js`: `dbResults`에 `raw_transcript: rawText` 필드 추가

### 3.3 skipAi 케이스 처리 (보완)

- `analysisWorker.js` line 58~83: 통화시간 < 30초 또는 텍스트 < 50자일 때 AI 분석 건너뜀
- 이 경우 `rawText`가 그대로 `transcript`에 저장됨 (화자 라벨 없음)
- **프론트엔드 대응**: 화자 라벨이 없는 텍스트도 우측 패널에 일반 텍스트로 표시 (파싱 실패 시 전체를 하나의 블록으로 표시)

---

## 4. 작업 순서 (의존성 기반)

### Phase 1: 백엔드 (프론트엔드 독립적으로 선행 가능)
1. `databaseService.js` — `raw_transcript` 컬럼 마이그레이션 추가
2. `ollamaService.js` — `reformatTranscript()` 프롬프트 강화 (원문 보존)
3. `analysisWorker.js` — `raw_transcript` 저장 로직 추가

### Phase 2: 프론트엔드 유틸리티
4. `utils.js` — `formatPhoneNumber()` 함수 추가

### Phase 3: 프론트엔드 UI
5. `History.jsx` — 전화번호 포맷 적용 + 통화 카운트 로직/UI 추가
6. `DetailModal.jsx` — 좌우 분할 레이아웃 전면 리디자인 + 채팅형 Transcript 렌더링

### Phase 4: 검증
7. 빌드 확인: `cd dashboard && npx vite build`
8. 기존 데이터로 UI 렌더링 정상 여부 확인

---

## 5. 영향 범위 분석

| 파일 | 변경 유형 | 위험도 |
|------|----------|--------|
| `backend/services/ollamaService.js` | 프롬프트 문자열 수정 | 낮음 (기존 AI만 영향) |
| `backend/services/databaseService.js` | 컬럼 추가 + INSERT 수정 | 낮음 (하위호환) |
| `backend/workers/analysisWorker.js` | 필드 1개 추가 | 낮음 |
| `dashboard/src/utils.js` | 함수 1개 추가 | 없음 (신규) |
| `dashboard/src/pages/History.jsx` | 카운트 로직 + 포맷 적용 | 낮음 |
| `dashboard/src/components/DetailModal.jsx` | 전면 리디자인 | **중간** (레이아웃 대폭 변경) |

---

작성일: 2026-01-30
작성자: Antigravity AI (CTO Review by Claude)
