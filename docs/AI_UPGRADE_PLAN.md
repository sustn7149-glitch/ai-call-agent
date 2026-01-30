# AI 품질 고도화 계획 (AI Upgrade Plan)

> **최종 수정**: 2026-01-30 | CTO 리뷰 완료

---

## 1. 현황 및 문제점 분석

### 1.1 현재 시스템 구성
- **STT (음성 인식)**: `Faster-Whisper` (로컬 구동, N100 서버)
- **LLM (텍스트 분석)**: `Ollama` 구동 (`Exaone 3.5:2.4b` 모델)
- **통신 방식**: HTTP API (`axios` → `localhost:11434`)
- **분석 파이프라인**: 5단계 순차 실행 (대화분리 → 요약 → 감정분석 → 고객명추출 → 결과판정)

### 1.2 핵심 문제점
| 문제 | 상세 | 영향도 |
|------|------|--------|
| 모델 능력 부족 | 2.4B 파라미터 경량 모델의 한계로 복잡한 지시 이행 실패 | **높음** |
| 화자 분리 부정확 | 원문 훼손, 상담원/고객 구분 오류 빈번 | **높음** |
| 요약 품질 저하 | 핵심 누락, 불필요한 내용 포함 | **중간** |
| 순차 처리 병목 | 5회 LLM 호출을 직렬로 실행 → 분석 1건당 수 분 소요 | **중간** |
| 구조화 응답 불안정 | 정규식 파싱 의존 → 형식 불일치 시 기본값 반환 | **중간** |

### 1.3 현재 분석 파이프라인 (ollamaService.js)
```
STT 텍스트 입력
  ├─ Step 1: formatConversation() — 화자 분리 (상담원/고객)
  ├─ Step 2: generateSummary() — 개조식 요약
  ├─ Step 3: analyzeSentiment() — 감정 분석 + 점수
  ├─ Step 4: extractCustomerName() — 고객명 추출
  └─ Step 5: analyzeOutcome() — 통화 결과 판정
```

---

## 2. 개선 방향

### 2.1 핵심 전략: API SDK 기반 고성능 모델 도입

> **중요 변경**: CLI(`child_process`) 방식 대신 **공식 API SDK**를 사용합니다.

#### CLI 방식의 문제점 (기존 계획의 리스크)
- Shell 명령어로 AI 호출 시 **입력 이스케이핑 문제** → 통화 내용에 특수문자, 따옴표 포함 시 명령어 깨짐
- **Shell Injection 보안 위험** → 사용자 생성 콘텐츠(통화 내용)를 쉘에 직접 전달
- CLI 도구는 대화형 인터페이스 → **프로그래밍 방식의 안정적 호출 불가**
- stdout 파싱 불안정, 에러 핸들링 미흡
- CLI 도구도 결국 API 크레딧 소비 → **비용 절감 효과 없음**

#### API SDK 방식의 장점
- 공식 Node.js SDK 사용 → 안정적이고 타입 안전한 호출
- 구조화된 요청/응답 (JSON Mode, Structured Output)
- 적절한 에러 핸들링, 재시도 로직 내장
- temperature, max_tokens 등 파라미터 제어
- Rate Limit 관리 기능 내장

### 2.2 아키텍처 변경
```
[기존]
  analysisWorker.js → ollamaService.js → HTTP → Ollama (Exaone 3.5)

[변경]
  analysisWorker.js → aiService.js → {
    ├─ AnthropicProvider (Claude API SDK)
    ├─ OpenAIProvider (GPT API SDK)
    ├─ OllamaProvider (기존 로컬, Fallback)
    └─ 환경변수로 선택: AI_PROVIDER=anthropic|openai|ollama
  }
```

### 2.3 AI 모델 선택 기준
| 모델 | 강점 | 적합한 작업 | 비용 |
|------|------|------------|------|
| **Claude 3.5 Sonnet** | 지시 이행, 뉘앙스 파악, 한국어 | 화자 분리, 감정 분석 | 중간 |
| **GPT-4o mini** | 빠른 속도, 구조화 출력 | 요약, 고객명 추출 | 낮음 |
| **Ollama (로컬)** | 무료, 오프라인 | Fallback, 단순 작업 | 무료 |

---

## 3. 상세 구현 계획

### 3.1 Phase 1: AI Service 리팩토링 (핵심)

#### [NEW] `services/aiService.js` (신규 생성)
```javascript
// Provider 인터페이스 패턴
const providers = {
  anthropic: require('./providers/anthropicProvider'),
  openai: require('./providers/openaiProvider'),
  ollama: require('./providers/ollamaProvider'),  // 기존 로직 래핑
};

const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';

async function callAI(prompt, options = {}) {
  const provider = providers[options.provider || AI_PROVIDER];
  try {
    return await provider.generate(prompt, options);
  } catch (error) {
    // Fallback to Ollama if primary fails
    if (AI_PROVIDER !== 'ollama') {
      console.warn(`[AI] ${AI_PROVIDER} failed, falling back to Ollama`);
      return await providers.ollama.generate(prompt, options);
    }
    throw error;
  }
}
```

#### [NEW] `services/providers/anthropicProvider.js`
```javascript
const Anthropic = require('@anthropic-ai/sdk');
// API Key: 환경변수 ANTHROPIC_API_KEY
```

#### [NEW] `services/providers/openaiProvider.js`
```javascript
const OpenAI = require('openai');
// API Key: 환경변수 OPENAI_API_KEY
```

#### [MODIFY] `workers/analysisWorker.js`
- `ollamaService` → `aiService`로 교체
- 기존 5단계 파이프라인 유지하되 provider 선택 가능

### 3.2 Phase 2: 파이프라인 최적화

#### 분석 단계 통합 (5회 → 2~3회 호출로 축소)
```
[기존: 5회 순차 호출]
  1. 대화분리 → 2. 요약 → 3. 감정분석 → 4. 고객명 → 5. 결과판정

[개선: 2~3회 호출]
  1. 대화분리 (원문 보존이 중요하므로 별도 유지)
  2. 통합 분석 (요약 + 감정 + 고객명 + 결과를 하나의 JSON으로 응답)
     → JSON Mode 활용하여 구조화된 응답 보장
```

#### 통합 프롬프트 예시 (Phase 2)
```
통화 내용을 분석하여 다음 JSON 형식으로 정확히 응답하세요:
{
  "summary": "개조식 요약 (3-5항목, - 로 시작)",
  "sentiment": "positive|negative|neutral",
  "sentiment_score": 1~10,
  "sentiment_reason": "판단 근거",
  "customer_name": "고객명 또는 null",
  "outcome": "성공|실패|보류: 사유"
}
```

### 3.3 Phase 3: 프롬프트 엔지니어링 고도화

현재 모델과 무관하게 **프롬프트 개선만으로도** 품질 향상이 가능한 영역:

1. **화자 분리**: Few-shot 예시 추가 (올바른 분리 예시 2~3개 포함)
2. **평가 기준**: 팀별 루브릭(Rubric) 명시 → 점수 산출 논리 투명화
3. **결과 판정**: Chain-of-Thought 유도 → "먼저 통화 목적을 파악하고, 그 목적 달성 여부를 판단하세요"

### 3.4 Phase 4: STT 품질 개선 (선택)

| 개선안 | 설명 | 효과 |
|--------|------|------|
| Whisper Large-v3 | 모델 업그레이드 (VRAM 요구 증가) | STT 정확도 향상 |
| 화자 분리(Diarization) | `pyannote-audio` 등 전처리 추가 | AI 부담 감소, 정확도 향상 |
| VAD 전처리 | Voice Activity Detection으로 무음 구간 제거 | STT 속도/정확도 향상 |

---

## 4. 환경 설정

### 4.1 필요한 환경변수 (.env)
```env
# AI Provider 선택 (anthropic | openai | ollama)
AI_PROVIDER=ollama

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (GPT)
OPENAI_API_KEY=sk-...

# Ollama (기존, 기본값)
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=exaone3.5:2.4b
```

### 4.2 필요한 NPM 패키지
```bash
npm install @anthropic-ai/sdk openai
```

---

## 5. 비용 분석

### 예상 비용 (1건당, Claude 3.5 Sonnet 기준)
| 단계 | Input Tokens | Output Tokens | 비용 (USD) |
|------|-------------|---------------|-----------|
| 대화분리 | ~2,000 | ~2,000 | ~$0.012 |
| 통합분석 | ~2,500 | ~500 | ~$0.010 |
| **합계** | | | **~$0.022/건** |

### 월간 비용 추정
| 일 분석량 | 월 분석량 | Claude | GPT-4o mini | Ollama |
|----------|----------|--------|-------------|--------|
| 50건 | 1,500건 | ~$33 | ~$5 | $0 |
| 200건 | 6,000건 | ~$132 | ~$18 | $0 |
| 500건 | 15,000건 | ~$330 | ~$45 | $0 |

### 추천 전략
- **초기**: Ollama 유지 + 프롬프트 개선 (Phase 3)으로 무비용 품질 향상
- **품질 우선**: Claude API 도입 (Phase 1) → 건당 ~$0.02
- **비용 최적화**: GPT-4o mini 사용 → 건당 ~$0.003

---

## 6. 검증 계획

### 6.1 품질 비교 테스트
1. 동일한 녹취 파일 10건을 선정
2. 각 모델(Ollama, Claude, GPT)로 분석 실행
3. 비교 항목:
   - 화자 분리 정확도 (원문 보존율)
   - 요약의 핵심 포착 여부
   - 감정 분석 일관성
   - 결과 판정 정확도

### 6.2 성능 벤치마크
- 분석 1건당 소요 시간 비교
- 파이프라인 통합 전/후 속도 비교
- 동시 처리 가능 건수

### 6.3 안정성 테스트
- API 장애 시 Fallback 동작 확인
- Rate Limit 도달 시 대기/재시도 동작 확인
- 긴 통화(30분 이상) 처리 가능 여부

---

## 7. 구현 우선순위 (로드맵)

| 순서 | Phase | 핵심 내용 | 비용 변화 |
|------|-------|----------|----------|
| **1** | Phase 3 | 프롬프트 엔지니어링 최적화 | 무비용 |
| **2** | Phase 2 | 파이프라인 통합 (5회→2회 호출) | 무비용 (속도 향상) |
| **3** | Phase 1 | API SDK 기반 Provider 패턴 구현 | API 비용 발생 |
| **4** | Phase 4 | STT 품질 개선 | 서버 리소스 |

> **권장**: Phase 3 → Phase 2를 먼저 적용하여 **비용 없이** 품질 향상을 확인한 후, 필요 시 Phase 1(외부 API) 도입을 결정합니다.

---

## 8. 전달 사항 (To Owner)

### 의사결정 필요 항목
1. **AI Provider 선택**: Claude API vs GPT API vs Ollama 유지 → 비용 대비 품질 트레이드오프
2. **API Key 발급**: 외부 API 사용 시 Anthropic/OpenAI 계정 생성 및 API Key 발급 필요
3. **월 예산**: AI 분석 비용에 대한 월간 예산 한도 설정
4. **우선 적용 범위**: 전체 통화 vs 특정 조건(30초 이상, 특정 팀 등)만 고품질 분석 적용
