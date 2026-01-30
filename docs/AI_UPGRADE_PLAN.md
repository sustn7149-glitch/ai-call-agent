# AI 품질 고도화 계획 (AI Upgrade Plan)

> **최종 수정**: 2026-01-30 | CTO 리뷰 완료 (네이티브 CLI 방식)

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

## 2. 서버 AI 자원 현황 (확인 완료)

N100 서버에 이미 설치 및 결제 완료된 네이티브 CLI 도구:

| 도구 | 버전 | 경로 | 비대화형 호출 | 비용 |
|------|------|------|-------------|------|
| **Claude Code** | 2.1.17 | `/home/sustn7149/.npm-global/bin/claude` | `claude -p "프롬프트"` | 구독 완료 (추가 비용 없음) |
| **Gemini CLI** | 0.25.1 | `/home/sustn7149/.npm-global/bin/gemini` | `gemini "프롬프트"` | 구독 완료 (추가 비용 없음) |
| **Codex CLI** | 0.89.0 | `/home/sustn7149/.npm-global/bin/codex` | `codex exec "프롬프트"` | 구독 완료 (추가 비용 없음) |
| **Ollama** | (기존) | `ollama` | HTTP API | 무료 (로컬) |

### 검증 완료 항목
- [x] 세 도구 모두 비대화형(non-interactive) 모드 동작 확인
- [x] stdin 파이프 입력 동작 확인 (`echo "프롬프트" | claude -p`)
- [x] Claude: `--model`, `--json-schema`, `--output-format json` 옵션 지원 확인
- [x] Gemini: positional prompt one-shot 모드 확인
- [x] Codex: `exec` 서브커맨드 비대화형 모드 확인 (git 디렉토리 필요)

---

## 3. 개선 방향: 네이티브 CLI 기반

### 3.1 핵심 전략

기존 Ollama HTTP API 방식을 **로컬에 설치된 고성능 AI CLI 도구**로 교체합니다.
이미 구독 결제가 완료되어 **추가 비용 없이** SOTA 모델의 품질을 활용할 수 있습니다.

### 3.2 아키텍처 변경
```
[기존]
  Docker 컨테이너 내부:
    analysisWorker.js → ollamaService.js → HTTP → Ollama (Exaone 3.5:2.4b)

[변경]
  호스트에서 직접 실행 (Docker 외부):
    analysisWorker.js → aiCliService.js → child_process.spawn → {
      ├─ claude -p (Primary: 화자분리, 감정분석, 결과판정)
      ├─ gemini (Secondary: 요약, 고객명 추출)
      └─ ollama (Fallback)
    }
```

### 3.3 Docker vs 호스트 실행 (중요)

현재 백엔드는 Docker 컨테이너 내부에서 실행되지만, CLI 도구는 **호스트**에 설치되어 있습니다.

**선택지 A (권장): 분석 워커를 호스트에서 실행**
- `analysisWorker.js`만 Docker 외부, 호스트에서 별도 Node.js 프로세스로 실행
- Redis/BullMQ를 통해 기존 백엔드와 통신 (현재와 동일한 큐 구조)
- CLI 도구에 직접 접근 가능, 인증 설정도 그대로 사용

**선택지 B: Docker에 CLI 도구 마운트**
- `docker-compose.yml`에 볼륨 마운트 추가:
  ```yaml
  volumes:
    - /home/sustn7149/.npm-global:/npm-global:ro
    - /home/sustn7149/.claude:/root/.claude:ro
    - /home/sustn7149/.config:/root/.config:ro
  ```
- 컨테이너 내에서 CLI 호출 가능하나 권한/경로 문제 발생 가능성 있음

### 3.4 AI 모델 역할 분배
| 분석 단계 | 담당 AI | 이유 |
|----------|---------|------|
| 화자 분리 (대화 재구성) | **Claude** | 지시 이행 능력 최상, "원문 한 글자도 바꾸지 마라" 규칙 준수 |
| 요약 | **Gemini** | 빠른 속도, 간결한 요약에 적합 |
| 감정 분석 + 점수 | **Claude** | 뉘앙스 파악, 한국어 이해도 우수 |
| 고객명 추출 | **Gemini** | 단순 패턴 추출 작업, 빠른 응답 |
| 결과 판정 | **Claude** | 복잡한 비즈니스 로직 판단 |

---

## 4. 상세 구현 계획

### 4.1 Phase 1: aiCliService.js 신규 생성

Node.js `child_process.spawn`으로 CLI 도구를 호출합니다.
**stdin으로 프롬프트를 전달**하여 Shell 이스케이핑 문제를 완전히 회피합니다.

#### [NEW] `services/aiCliService.js`
```javascript
const { spawn } = require('child_process');
const path = require('path');

const CLI_BIN = '/home/sustn7149/.npm-global/bin';
const AI_PROVIDER = process.env.AI_PROVIDER || 'claude'; // claude | gemini | codex | ollama

/**
 * CLI 도구 실행 (stdin으로 프롬프트 전달 → Shell 이스케이핑 불필요)
 */
function execCli(bin, args, prompt, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: { ...process.env, PATH: `${CLI_BIN}:/usr/local/bin:/usr/bin:/bin` },
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`CLI exit ${code}: ${stderr.slice(0, 200)}`));
    });
    proc.on('error', reject);

    // 프롬프트를 stdin으로 전달 (긴 텍스트도 안전)
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/** Claude Code CLI 호출 */
async function callClaude(prompt, options = {}) {
  const args = ['-p', '--model', options.model || 'sonnet'];
  if (options.jsonSchema) {
    args.push('--json-schema', JSON.stringify(options.jsonSchema));
    args.push('--output-format', 'json');
  }
  return execCli(path.join(CLI_BIN, 'claude'), args, prompt, options.timeout || 120000);
}

/** Gemini CLI 호출 */
async function callGemini(prompt, options = {}) {
  // gemini는 positional prompt 사용, stdin 미지원 시 임시 파일 활용
  return execCli(path.join(CLI_BIN, 'gemini'), [], prompt, options.timeout || 120000);
}

/** Codex (OpenAI) CLI 호출 */
async function callCodex(prompt, options = {}) {
  return execCli(
    path.join(CLI_BIN, 'codex'),
    ['exec', '--skip-git-repo-check'],
    prompt,
    options.timeout || 120000
  );
}

/** 통합 호출 함수 (Fallback 포함) */
async function callAI(prompt, options = {}) {
  const provider = options.provider || AI_PROVIDER;
  try {
    switch (provider) {
      case 'claude': return await callClaude(prompt, options);
      case 'gemini': return await callGemini(prompt, options);
      case 'codex':  return await callCodex(prompt, options);
      case 'ollama': return await callOllama(prompt); // 기존 HTTP 방식
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.warn(`[AI] ${provider} 실패: ${error.message}, Ollama로 Fallback`);
    if (provider !== 'ollama') return await callOllama(prompt);
    throw error;
  }
}
```

#### 핵심 안전장치: stdin 파이프
- 프롬프트를 **커맨드 인자가 아닌 stdin**으로 전달
- 통화 내용에 따옴표, 특수문자, 줄바꿈이 있어도 안전
- Shell Injection 위험 제거 (`spawn`은 shell을 거치지 않음)

### 4.2 Phase 2: 파이프라인 최적화

#### 분석 단계 통합 (5회 → 2회 호출)
```
[기존: 5회 순차 호출, 모두 Ollama]
  1. 대화분리 → 2. 요약 → 3. 감정분석 → 4. 고객명 → 5. 결과판정

[개선: 2회 호출, 고성능 모델]
  1. Claude: 대화분리 (원문 보존이 핵심 → 별도 유지)
  2. Claude: 통합 분석 (요약 + 감정 + 고객명 + 결과를 JSON 한 번에)
     → --json-schema 옵션으로 구조화된 응답 보장
```

#### Claude 통합 분석 프롬프트 (Phase 2)
```
claude -p --model sonnet --json-schema '{"type":"object","properties":{"summary":{"type":"string"},"sentiment":{"type":"string","enum":["positive","negative","neutral"]},"sentiment_score":{"type":"integer","minimum":1,"maximum":10},"sentiment_reason":{"type":"string"},"customer_name":{"type":"string"},"outcome":{"type":"string"}},"required":["summary","sentiment","sentiment_score","outcome"]}' --output-format json
```

이렇게 하면:
- **5회 → 2회**로 호출 횟수 60% 감소
- JSON Schema 강제 → 정규식 파싱 불필요, 형식 불일치 0%
- 분석 시간 대폭 단축

### 4.3 Phase 3: 프롬프트 엔지니어링 고도화

고성능 모델은 프롬프트 품질에 더 민감하게 반응하므로, 프롬프트도 함께 개선:

1. **화자 분리**: Few-shot 예시 2~3개 포함 (올바른 분리 예시)
2. **평가 기준**: 팀별 루브릭(Rubric) 명시 → 점수 산출 논리 투명화
3. **결과 판정**: Chain-of-Thought → "먼저 통화 목적을 파악하고, 달성 여부를 판단하세요"
4. **Claude 모델 선택**: 화자분리는 `haiku` (빠름), 통합분석은 `sonnet` (정확)

### 4.4 Phase 4: STT 품질 개선 (선택)

| 개선안 | 설명 | 효과 |
|--------|------|------|
| Whisper Large-v3 | 모델 업그레이드 (VRAM 요구 증가) | STT 정확도 향상 |
| 화자 분리(Diarization) | `pyannote-audio` 등 전처리 추가 | AI 부담 감소, 정확도 향상 |
| VAD 전처리 | Voice Activity Detection으로 무음 구간 제거 | STT 속도/정확도 향상 |

---

## 5. 환경 설정

### 5.1 필요한 환경변수 (.env)
```env
# AI Provider 선택 (claude | gemini | codex | ollama)
AI_PROVIDER=claude

# CLI 도구 경로 (N100 서버)
AI_CLI_BIN=/home/sustn7149/.npm-global/bin

# Claude 모델 설정
CLAUDE_MODEL_FAST=haiku     # 화자분리 등 단순 작업용
CLAUDE_MODEL_SMART=sonnet   # 통합분석 등 고품질 작업용

# Ollama (Fallback용)
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=exaone3.5:2.4b
```

### 5.2 실행 방식 변경 (선택지 A 적용 시)

```bash
# 기존: Docker 내에서 워커 실행
# docker compose up backend  (워커 포함)

# 변경: 백엔드는 Docker, 워커는 호스트에서 별도 실행
docker compose up backend    # API + 웹서버 (워커 제외)
node backend/workers/analysisWorker.js   # 호스트에서 직접 실행 (CLI 접근 가능)
```

### 5.3 추가 패키지: 없음
이미 설치된 CLI 도구만 사용하므로 npm 추가 패키지 불필요.

---

## 6. 비용 분석

### 기존 대비 비용 변화
| 항목 | 기존 (Ollama) | 변경 (네이티브 CLI) |
|------|--------------|-------------------|
| AI 모델 비용 | $0 (로컬) | **$0** (구독 결제 완료) |
| 분석 품질 | 낮음 (2.4B 경량 모델) | **높음** (SOTA 모델) |
| 분석 속도 | 느림 (N100 CPU 추론) | **빠름** (클라우드 추론) |
| 서버 부하 | 높음 (CPU 100%) | **낮음** (CLI 호출만) |

> 결론: **추가 비용 0원으로 품질 대폭 향상** 가능

---

## 7. 검증 계획

### 7.1 품질 비교 테스트
1. 동일한 녹취 파일 10건 선정
2. Ollama vs Claude CLI vs Gemini CLI 결과 비교
3. 비교 항목:
   - 화자 분리 정확도 (원문 보존율)
   - 요약 핵심 포착 여부
   - 감정 분석 일관성
   - 결과 판정 정확도
   - JSON 스키마 준수율

### 7.2 성능 벤치마크
- 분석 1건당 소요 시간: Ollama(CPU 추론) vs CLI(클라우드 추론)
- 파이프라인 통합 전/후 속도 비교 (5회→2회)
- 동시 처리 가능 건수

### 7.3 안정성 테스트
- CLI 도구 장애 시 Ollama Fallback 동작 확인
- 네트워크 끊김 시 대기/재시도
- 긴 통화(30분 이상, 텍스트 5000자+) 처리 가능 여부
- stdin 파이프로 특수문자 포함 텍스트 전달 테스트

---

## 8. 구현 우선순위 (로드맵)

| 순서 | Phase | 핵심 내용 | 비용 |
|------|-------|----------|------|
| **1** | Phase 1 | `aiCliService.js` 생성 + 워커 교체 | $0 |
| **2** | Phase 2 | 파이프라인 통합 (5회→2회, JSON Schema) | $0 |
| **3** | Phase 3 | 프롬프트 엔지니어링 고도화 | $0 |
| **4** | Phase 4 | STT 품질 개선 (선택) | 서버 리소스 |

> **모든 Phase가 추가 비용 $0**. Phase 1만 적용해도 즉각적인 품질 향상이 기대됩니다.

---

## 9. 리스크 및 대응

| 리스크 | 대응 |
|--------|------|
| CLI 도구 네트워크 의존 | Ollama Fallback 자동 전환 |
| CLI 구독 만료 | 환경변수로 즉시 Ollama 전환 가능 |
| Docker ↔ 호스트 CLI 접근 | 워커를 호스트에서 별도 실행 (선택지 A) |
| stdout 파싱 이슈 | Claude `--json-schema` + `--output-format json` 활용 |
| 긴 텍스트 전달 | stdin 파이프 (크기 제한 없음) |
