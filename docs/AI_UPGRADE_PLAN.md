# AI 품질 고도화 계획 (AI Upgrade Plan)

## 1. 현황 및 문제점 분석

### 1.1 현재 시스템 구성
- **STT (음성 인식)**: `Faster-Whisper` (로컬 구동)
- **LLM (텍스트 분석)**: `Ollama` 구동 (`Exaone 3.5` 모델)
- **통신 방식**: HTTP API (`axios` -> `localhost:11434`)

### 1.2 문제점
- **품질 저하**: 로컬 경량 모델(Exaone 3.5)의 한계로 인해, 통화 내용의 정확한 재구성(화자 분리), 문맥 파악, 요약 및 감정 분석의 깊이가 부족함.
- **복잡한 지시 이행 불가**: "원문을 훼손하지 말라" 등의 엄격한 제약 조건을 모델이 종종 무시하거나, 복잡한 비즈니스 로직(점수화, 체크리스트)을 정확히 수행하지 못함.

---

## 2. 개선 방향: 로컬 네이티브 CLI 기반 AI 도입

사용자의 N100 서버에 설치된 **Claude, GPT, Gemini**의 CLI(Command Line Interface) 도구를 직접 활용하여, API 비용 없이 고성능 AI 모델의 능력을 활용합니다.

### 2.1 아키텍처 변경
- **기존**: Node.js Service (`ollamaService.js`) → HTTP Request → Ollama Server
- **변경**: Node.js Service (`aiCliService.js`) → System Shell Execution (`child_process`) → CLI Tools (`claude`, `chatgpt`, `gemini`)

### 2.2 사용할 AI 모델 (선택 가능하도록 구성)
1.  **Claude (Anthropic)**: 문맥 이해와 뉘앙스 파악, 엄격한 지시 사항 준수(Instruction Following)에 탁월. **(추천: 대화 재구성 및 정밀 분석용)**
2.  **GPT (OpenAI)**: 일반적인 요약 및 정형화된 데이터 추출에 강점.
3.  **Gemini (Google)**: 긴 텍스트 처리 및 빠른 응답 속도.

---

## 3. 상세 구현 계획

### 3.1 백엔드 수정 (`/backend`)

#### [NEW] `services/aiCliService.js` (신규 생성)
- **기능**: Node.js의 `child_process.exec` 또는 `spawn`을 사용하여 시스템 터미널 명령어를 실행하고 표준 출력(stdout)을 캡처.
- **설계**:
    ```javascript
    // 의사 코드 (Pseudo-code)
    async function runAiCommand(provider, prompt) {
      let command = '';
      if (provider === 'claude') {
        command = `claude "${escape(prompt)}"`; // 예시 커맨드
      } else if (provider === 'gpt') {
        command = `gpt-cli "${escape(prompt)}"`;
      }
      
      return executeShellCommand(command);
    }
    ```
- **환경 변수**: `.env`에 `AI_PROVIDER=claude` 등을 설정하여 유연하게 전환 가능.

#### [MODIFY] `workers/analysisWorker.js`
- 기존 `ollamaService.js` 의존성을 제거하고, `aiCliService.js`로 교체.
- 분석 단계별로 다른 AI 사용 가능성 열어둠 (예: 대화 재구성은 Claude, 요약은 GPT).

### 3.2 AI 프로세스 최적화

#### Step 1: 대화 재구성 (Transcript Reformating)
- **담당 AI**: Claude (지시 이행 능력이 가장 우수)
- **개선**: 기존 프롬프트 규칙("한 글자도 바꾸지 마세요")을 Claude에게 전달하면 훨씬 더 철저하게 원문을 보존하며 화자(`상담원`/`고객`)만 정확히 분리할 것으로 기대됨.

#### Step 2: 상담 품질 평가 (Scoring & Summary)
- **담당 AI**: Claude 또는 GPT-4o
- **개선**:
    - 비속어, 감정 변화 등 미묘한 뉘앙스를 정확히 캐치.
    - 팀별 평가 기준(영업팀 vs 민원팀)을 더 깊이 이해하고 논리적인 점수 산출.

---

## 4. 검증 계획

1.  **CLI 연결 테스트**: N100 서버 내에서 Node.js가 터미널 명령어로 AI를 호출할 수 있는지 권한 및 경로(PATH) 확인.
2.  **품질 비교**: 동일한 녹취 파일을 대상으로 `Ollama` vs `Claude CLI` 결과 비교.
    - 화자 분리 정확도
    - 요약의 핵심 포착 여부
    - 감정 분석의 공감대

## 5. 전달 사항 (To User)

- **필요 정보**: N100 서버에서 실제로 사용하는 **명령어(Command)**를 알려주셔야 합니다. (예: 터미널에서 `claude "안녕"`이라고 치는지, `tgpt "hello"`라고 치는지 등 정확한 바이너리 명칭과 인자 포맷)
- **권한**: Node.js 애플리케이션이 시스템 명령어를 실행할 수 있는 권한이 있어야 합니다.

이 계획대로 진행하여 "로컬 LLM의 한계"를 "SOTA 모델의 로컬 CLI 활용"으로 극복하고 AI 분석 품질을 획기적으로 높이겠습니다.
