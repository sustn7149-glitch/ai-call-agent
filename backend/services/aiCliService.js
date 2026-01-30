// ===== AI CLI Service =====
// 네이티브 CLI 도구 (Claude, Gemini, Codex)를 사용한 고품질 AI 분석
// child_process.spawn + stdin 파이프로 Shell 이스케이핑 문제 완전 회피

const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

// ===== 환경변수 =====
const CLI_BIN = process.env.AI_CLI_BIN || '/home/sustn7149/.npm-global/bin';
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const CLAUDE_MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'haiku';
const CLAUDE_MODEL_SMART = process.env.CLAUDE_MODEL_SMART || 'sonnet';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

// ===== Fallback Chain 설정 =====
// 장애 시 자동 전환: Claude → Gemini → Ollama
const FALLBACK_CHAIN = ['claude', 'gemini', 'ollama'];

// ===== CLI 실행 기반 함수 =====

/**
 * CLI 도구를 spawn으로 실행
 * - Shell을 거치지 않으므로 Injection 위험 없음
 * - stdinData가 있으면 stdin으로 전달 (Claude -p 모드)
 * - 없으면 positional argument 방식 (Gemini, Codex)
 */
function execCli(bin, args, stdinData, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: {
        ...process.env,
        PATH: `${CLI_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
        HOME: process.env.HOME || '/home/sustn7149',
      },
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`CLI exit code ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`CLI spawn error: ${err.message}`));
    });

    // stdin 데이터 전달 (Claude -p 모드에서 사용)
    if (stdinData) {
      proc.stdin.write(stdinData);
    }
    proc.stdin.end();
  });
}

/**
 * Claude Code CLI 호출
 * -p: print 모드 (비대화형, stdout에 결과 출력)
 * --model: haiku(빠름) / sonnet(정확)
 */
async function callClaude(prompt, options = {}) {
  const model = options.model || CLAUDE_MODEL_SMART;
  const args = ['-p', '--model', model];
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Claude (${model}) 호출 중...`);
  const result = await execCli(path.join(CLI_BIN, 'claude'), args, prompt, timeout);
  console.log(`[AI-CLI] Claude 응답: ${result.length} chars`);
  return result;
}

/**
 * Claude Code CLI 구조화 출력 호출 (Phase 2)
 * --json-schema: JSON Schema 강제로 구조화된 응답 보장
 * --output-format json: CLI 메타데이터 JSON 반환 (structured_output 필드)
 */
async function callClaudeStructured(prompt, jsonSchema, options = {}) {
  const model = options.model || CLAUDE_MODEL_SMART;
  const args = [
    '-p', '--model', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(jsonSchema)
  ];
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Claude Structured (${model}) 호출 중...`);
  const rawOutput = await execCli(path.join(CLI_BIN, 'claude'), args, prompt, timeout);

  // --output-format json은 CLI 메타데이터 JSON을 반환
  // structured_output 필드에 스키마 준수 데이터가 들어있음
  try {
    const envelope = JSON.parse(rawOutput);
    if (envelope.structured_output) {
      console.log(`[AI-CLI] Claude Structured 응답: ${JSON.stringify(envelope.structured_output).length} chars`);
      return envelope.structured_output;
    }
    // structured_output이 없으면 result에서 JSON 추출 시도
    if (envelope.result) {
      const jsonMatch = envelope.result.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return JSON.parse(envelope.result);
    }
    throw new Error('structured_output 필드가 없습니다');
  } catch (parseErr) {
    if (parseErr.message.includes('structured_output')) throw parseErr;
    // JSON 파싱 실패 시 텍스트에서 JSON 추출 시도
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`구조화 응답 파싱 실패: ${parseErr.message}`);
  }
}

/**
 * Gemini CLI 호출
 * positional argument로 프롬프트 전달 (one-shot 모드)
 * spawn이므로 shell escaping 불필요, 긴 텍스트도 안전
 */
async function callGemini(prompt, options = {}) {
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Gemini 호출 중...`);
  // Gemini CLI: gemini "prompt" (positional argument)
  const result = await execCli(path.join(CLI_BIN, 'gemini'), [prompt], null, timeout);
  console.log(`[AI-CLI] Gemini 응답: ${result.length} chars`);
  return result;
}

/**
 * Codex (OpenAI) CLI 호출
 * codex exec "prompt" (positional argument)
 */
async function callCodex(prompt, options = {}) {
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Codex 호출 중...`);
  // Codex CLI: codex exec "prompt" (positional argument)
  const result = await execCli(
    path.join(CLI_BIN, 'codex'),
    ['exec', prompt],
    null,
    timeout
  );
  console.log(`[AI-CLI] Codex 응답: ${result.length} chars`);
  return result;
}

/**
 * Ollama HTTP API 호출 (Fallback용, 기존 방식 유지)
 */
async function callOllamaHttp(prompt) {
  const response = await axios.post(OLLAMA_URL, {
    model: OLLAMA_MODEL,
    prompt: prompt,
    stream: false
  }, { timeout: 180000 });

  if (response.data && response.data.response) {
    return response.data.response.trim();
  }
  throw new Error('Ollama API 응답 형식이 올바르지 않습니다.');
}

/**
 * 통합 AI 호출 함수 (Fallback Chain 적용)
 * Claude → Gemini → Ollama 순으로 자동 전환
 * 지정된 provider부터 체인의 끝까지 순차 시도
 */
async function callAI(prompt, options = {}) {
  const startProvider = options.provider || AI_PROVIDER;
  const startIdx = FALLBACK_CHAIN.indexOf(startProvider);
  const chain = startIdx >= 0
    ? FALLBACK_CHAIN.slice(startIdx)
    : [startProvider];

  let lastError = null;

  for (const provider of chain) {
    try {
      switch (provider) {
        case 'claude': return await callClaude(prompt, options);
        case 'gemini': return await callGemini(prompt, options);
        case 'codex':  return await callCodex(prompt, options);
        case 'ollama': return await callOllamaHttp(prompt);
        default: throw new Error(`Unknown AI provider: ${provider}`);
      }
    } catch (error) {
      lastError = error;
      const nextIdx = chain.indexOf(provider) + 1;
      if (nextIdx < chain.length) {
        console.warn(`[AI] ${provider} 실패 (${error.message}) → ${chain[nextIdx]} Fallback`);
      } else {
        console.error(`[AI] Fallback Chain 전체 실패: ${error.message}`);
      }
    }
  }

  throw lastError;
}

// ===== 분석 함수 (ollamaService와 동일한 인터페이스) =====

/**
 * 대화 분리: STT 텍스트를 상담원/고객 발화로 분리
 * Claude 사용 권장 (지시 이행 능력 최상)
 */
async function formatConversation(text) {
  if (!text || text.trim().length === 0) return text;

  const prompt = `당신은 콜센터 음성인식(STT) 텍스트의 화자 분리 전문가입니다.
아래 STT 텍스트를 "상담원"과 "고객" 두 화자의 대화로 분리하세요.

[절대 규칙]
1. 원문의 단어, 문장, 표현을 단 한 글자도 수정/삭제/추가하지 마세요.
2. 욕설, 비속어, 문법 오류, 말더듬("어 어", "그 그"), 반복 표현을 그대로 유지하세요.
3. 각 발화 앞에 "상담원:" 또는 "고객:" 라벨만 붙이세요.
4. 요약, 의역, 순화 절대 금지. 원문 100% 보존이 최우선입니다.
5. 한 줄에 하나의 발화만 작성하세요.

[화자 판별 기준]
- 상담원: 먼저 전화를 건 쪽, 회사/서비스 소개, 안내/설명, "고객님" 호칭 사용, 업무 관련 질문
- 고객: 전화를 받는 쪽, "네/여보세요"로 시작, 개인 정보 제공, 질문에 답변, 요청/불만 표현

[올바른 분리 예시]

<예시 1>
입력: 네 여보세요 네 안녕하세요 김철수 고객님이시죠 네 맞습니다 다름이 아니라 이번에 요금제 변경 건으로 연락드렸는데요 아 네 말씀하세요
출력:
고객: 네 여보세요
상담원: 네 안녕하세요 김철수 고객님이시죠
고객: 네 맞습니다
상담원: 다름이 아니라 이번에 요금제 변경 건으로 연락드렸는데요
고객: 아 네 말씀하세요

<예시 2>
입력: 안녕하세요 고객님 OO텔레콤입니다 네 네 고객님 이번에 폰 바꾸실 의향 있으신지 해서요 아 지금은 좀 괜찮은데요
출력:
상담원: 안녕하세요 고객님 OO텔레콤입니다
고객: 네
상담원: 네 고객님 이번에 폰 바꾸실 의향 있으신지 해서요
고객: 아 지금은 좀 괜찮은데요

<예시 3>
입력: 여보세요 네 고객님 안녕하세요 네 어 그 저번에 신청한 거 어떻게 됐어요 아 네 확인해드리겠습니다 잠시만요 네 네
출력:
고객: 여보세요
상담원: 네 고객님 안녕하세요
고객: 네 어 그 저번에 신청한 거 어떻게 됐어요
상담원: 아 네 확인해드리겠습니다 잠시만요
고객: 네 네

[STT 텍스트]
${text}

[대화 분리 결과]`;

  try {
    // 화자 분리는 빠른 모델(haiku) 사용
    const result = await callAI(prompt, { provider: AI_PROVIDER, model: CLAUDE_MODEL_FAST });
    if (result.includes('상담원:') || result.includes('고객:')) {
      return result;
    }
    return text;
  } catch (error) {
    console.error('[AI-CLI] 대화 분리 실패:', error.message);
    return text;
  }
}

/**
 * 개조식 요약 생성
 */
async function generateSummary(text, options = {}) {
  if (!text || text.trim().length === 0) {
    throw new Error('요약할 텍스트가 비어있습니다.');
  }

  const prompt = `다음 고객 상담 통화의 핵심을 한 줄로 간결하게 요약하세요.

규칙:
1. 반드시 한 줄로 작성 (50자 이내 권장, 최대 80자)
2. 핵심 흐름을 "→" 또는 "," 로 연결
3. 통화 목적과 결과가 드러나도록 구성
4. 인사말, 대기 안내, 부수적 표현 제외
5. "-"로 시작하지 말고, 바로 핵심 내용으로 시작
6. 개조식(Bullet points) 금지, 줄바꿈 금지

올바른 예시:
- 아이폰17 색상변경으로 최종진행결정함
- 신청서 인증 → 인증서미보유 → 추후 재컨택 예정
- 요금제변경 문의 → 현재 요금제 유지 결정
- 해지방어 → 3개월 할인 제안 → 고객 수락
- 배송일정 확인 → 내일 도착 안내 완료

통화 내용:
${text}

요약:`;

  return await callAI(prompt, options);
}

/**
 * 감정 분석 + 점수 (팀별 평가 기준 반영)
 */
async function analyzeSentiment(text, teamPrompt, options = {}) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  let evaluationContext = '';
  if (teamPrompt) {
    evaluationContext = `\n\n[팀 맞춤 평가 기준]\n${teamPrompt}\n위 기준을 반영하여 점수를 매겨주세요.`;
  }

  const prompt = `다음 고객 상담 통화의 감정과 상담 품질을 분석해주세요.${evaluationContext}

[점수 면제 기준 — 아래 경우 점수: 0 으로 응답]
- 단순 문의 (배송 확인, 영업시간, 잔액 조회 등 정보 전달만 하는 통화)
- 잘못 걸린 전화, 부재중 응답
- 단순 일방적 안내 (일정 공지, 결과 통보 등)
- 고객 설득이나 문제 해결 노력이 필요 없는 간단한 응대

[점수 부여 대상 — 아래 경우에만 점수를 매기세요]
- 고객을 설득하거나 영업/세일즈 노력이 있는 통화
- 민원/불만 대응 및 방어 상담
- 복잡한 문제 해결을 위한 심층 상담
- 고객 유지/해지방어를 위한 통화

[점수 루브릭 (점수 부여 대상에만 적용)]
9~10: 탁월 — 고객 감동, 기대 이상의 서비스
7~8: 우수 — 목적 달성, 고객 만족, 전문적 응대
5~6: 보통 — 기본적 업무 수행, 특별한 문제 없음
3~4: 미흡 — 설명 부족, 고객 불만 미해소
1~2: 심각 — 고객 이탈, 심한 불만, 무례한 응대

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
감정: [positive/negative/neutral 중 하나]
점수: [0 또는 1-10 사이의 정수. 면제 대상이면 0, 아니면 루브릭 참조]
이유: [위 점수를 부여한 구체적 근거를 한 문장으로]`;

  try {
    const response = await callAI(prompt, options);

    const sentimentMatch = response.match(/감정:\s*(positive|negative|neutral)/i);
    const scoreMatch = response.match(/점수:\s*(\d+)/);
    const reasonMatch = response.match(/이유:\s*(.+)/);

    let sentiment = 'neutral';
    let score = null;
    let reason = '';

    if (sentimentMatch) sentiment = sentimentMatch[1].toLowerCase();
    if (scoreMatch) {
      const rawScore = parseInt(scoreMatch[1], 10);
      score = rawScore === 0 ? null : Math.min(10, Math.max(1, rawScore));
    }
    if (reasonMatch) reason = reasonMatch[1].trim();

    return { sentiment, score, reason };
  } catch (error) {
    console.error('[AI-CLI] 감정 분석 실패:', error.message);
    throw error;
  }
}

/**
 * 고객명 추출
 */
async function extractCustomerName(text, options = {}) {
  if (!text || text.trim().length === 0) return null;

  const prompt = `다음 통화에서 상담원이 고객을 부르는 이름을 찾아주세요.

찾는 패턴:
- "OOO 고객님" → OOO
- "OOO씨" → OOO
- "김 고객님" → 김 (성만 있으면 성만 기재)

주의사항:
- 통화에서 명확히 호명된 이름만 기재
- 상담원 본인 이름이나 회사명은 제외
- 이름이 전혀 언급되지 않으면 "확인불가"

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
고객명: [이름 또는 "확인불가"]`;

  try {
    const response = await callAI(prompt, options);
    const nameMatch = response.match(/고객명:\s*(.+)/);

    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name === '확인불가' || name === '없음' || name === '알수없음' || name.length > 20) {
        return null;
      }
      return name.replace(/\s*(고객님|고객|님|씨|대리|과장|부장|사원|팀장)$/g, '').trim() || null;
    }
    return null;
  } catch (error) {
    console.error('[AI-CLI] 고객명 추출 실패:', error.message);
    return null;
  }
}

/**
 * 통화 결과 판정 (팀 유형별 기준 적용)
 */
async function analyzeOutcome(text, teamName, options = {}) {
  if (!text || text.trim().length === 0) return null;

  const name = (teamName || '').toLowerCase();
  let teamContext = '';

  if (name.includes('영업') || name.includes('세일즈') || name.includes('sales')) {
    teamContext = `이 통화는 [영업팀] 상담원의 통화입니다.

성공 판정 기준:
- 고객이 구매 의사를 밝힌 경우 → "성공: 구매확정"
- 고객이 긍정적 검토를 약속한 경우 → "성공: 긍정검토"
- 계약에 동의한 경우 → "성공: 계약동의"

실패 판정 기준:
- 가격이 비싸다며 거절 → "실패: 가격부담"
- 다른 회사 제품과 비교하며 거절 → "실패: 타사비교"
- 필요 없다고 거절 → "실패: 필요없음"
- 명확한 사유 없이 거절 → "실패: 단순거절"
- 나중에 연락달라 등 회피 → "실패: 재통화요청"`;
  } else if (name.includes('민원') || name.includes('cs') || name.includes('고객') || name.includes('서비스') || name.includes('상담')) {
    teamContext = `이 통화는 [민원/CS팀] 상담원의 통화입니다.

성공 판정 기준:
- 고객 불만이 해소된 경우 → "성공: 방어확정"
- 민원이 철회된 경우 → "성공: 민원철회"
- 고객이 안내를 수용한 경우 → "성공: 안내수용"

실패 판정 기준:
- 상급자 통화를 요청한 경우 → "실패: 상급자요청"
- 금전적 보상을 지속 요구한 경우 → "실패: 보상요구"
- 해지를 요구한 경우 → "실패: 해지요구"
- 고객이 더 강하게 불만을 표시한 경우 → "실패: 방어실패"`;
  } else {
    teamContext = `이 통화는 일반 상담 통화입니다.

성공 판정 기준:
- 상담 목적이 달성된 경우 → "성공: 목적달성"
- 고객이 만족한 경우 → "성공: 고객만족"

실패 판정 기준:
- 상담 목적이 달성되지 못한 경우 → "실패: 미해결"
- 고객이 불만족한 경우 → "실패: 고객불만"`;
  }

  const prompt = `다음 통화의 결과를 판정해주세요.

[판정 절차]
1단계: 이 통화의 주요 목적을 한 문장으로 파악하세요
2단계: 그 목적이 달성되었는지 판단하세요
3단계: 아래 기준에서 가장 적합한 결과를 선택하세요

${teamContext}

판단이 어려운 경우 → "보류: 고객검토필요" 또는 "보류: 판단불가"

통화 내용:
${text}

다음 형식으로 정확히 한 줄만 답변해주세요:
결과: [성공/실패/보류]: [사유]

예시:
결과: 성공: 구매확정
결과: 실패: 가격부담
결과: 보류: 고객검토필요`;

  try {
    const response = await callAI(prompt, options);
    const match = response.match(/결과:\s*(.+)/);

    if (match) {
      let outcome = match[1].trim();
      if (outcome.startsWith('성공') || outcome.startsWith('실패') || outcome.startsWith('보류')) {
        if (!outcome.includes(':') && !outcome.includes('：')) {
          outcome = outcome.replace(/\s+/, ': ');
        }
        outcome = outcome.replace('：', ':');
        return outcome;
      }
    }
    return '보류: 판단불가';
  } catch (error) {
    console.error('[AI-CLI] 통화 결과 판정 실패:', error.message);
    return null;
  }
}

/**
 * 팀 이름 기반 기본 평가 프롬프트 (ollamaService와 동일)
 */
function getDefaultTeamPrompt(teamName) {
  if (!teamName) return null;
  const name = teamName.toLowerCase();

  if (name.includes('영업') || name.includes('세일즈') || name.includes('sales')) {
    return '상품 권유 및 판매 성공 여부, 고객의 구매 반응, 상품 설명의 적절성을 핵심적으로 평가해주세요. 판매 성과가 높을수록 높은 점수를 부여하세요.';
  }

  if (name.includes('민원') || name.includes('cs') || name.includes('고객') || name.includes('서비스') || name.includes('상담')) {
    return 'VOC(고객의 소리) 방어 노력, 최소 비용으로 고객 문제를 해결했는지, 고객 불만 완화 능력을 핵심적으로 평가해주세요. 효율적으로 문제를 해결할수록 높은 점수를 부여하세요.';
  }

  return null;
}

// ===== Phase 2: 통합 분석 JSON Schema =====

const UNIFIED_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '통화 핵심을 한 줄로 간결 요약 (50자 이내, "→"로 흐름 연결, 줄바꿈 금지)'
    },
    sentiment: {
      type: 'string',
      enum: ['positive', 'negative', 'neutral'],
      description: '고객 감정 및 상담 품질 종합 판단'
    },
    sentiment_score: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      description: '상담 품질 점수 (0=점수면제(단순문의/간단응대), 1~10=상담품질 루브릭)'
    },
    sentiment_reason: {
      type: 'string',
      description: '감정/점수 판단 근거 (한 문장)'
    },
    customer_name: {
      type: ['string', 'null'],
      description: '통화에서 명확히 언급된 고객 이름 (없으면 null)'
    },
    outcome: {
      type: 'string',
      description: '통화 결과 판정 ("성공: 사유" / "실패: 사유" / "보류: 판단불가")'
    }
  },
  required: ['summary', 'sentiment', 'sentiment_score', 'outcome']
};

/**
 * 팀 유형별 결과 판정 기준 텍스트 생성
 */
function buildOutcomeContext(teamName) {
  const name = (teamName || '').toLowerCase();

  const commonCoT = `[결과 판정 사고 절차]
먼저 통화의 주요 목적을 한 문장으로 정리하세요.
그 목적이 달성되었는지, 부분적으로 달성되었는지, 실패했는지 판단하세요.
아래 기준에 가장 부합하는 결과를 선택하세요.
판단이 어려우면 "보류: 고객검토필요" 또는 "보류: 판단불가"로 기재하세요.`;

  if (name.includes('영업') || name.includes('세일즈') || name.includes('sales')) {
    return `${commonCoT}

[영업팀 결과 판정 기준]
성공: 구매확정(고객이 구매/가입 의사 확정), 긍정검토(구체적 검토 약속), 계약동의(약정/계약 동의)
실패: 가격부담(비용 이유로 거절), 타사비교(경쟁사 선호로 거절), 필요없음(니즈 없음), 단순거절(명확한 거절), 재통화요청(나중에 연락 요청)
보류: 고객검토필요(고객이 가족상의/추후결정 등 검토 의사 표현), 판단불가`;
  }
  if (name.includes('민원') || name.includes('cs') || name.includes('고객') || name.includes('서비스') || name.includes('상담')) {
    return `${commonCoT}

[민원/CS팀 결과 판정 기준]
성공: 방어확정(고객 불만 해소, 유지 확정), 민원철회(고객이 민원 철회), 안내수용(고객이 안내를 수용)
실패: 상급자요청(고객이 상급자 통화 요구), 보상요구(금전적 보상 지속 요구), 해지요구(서비스 해지 요청), 방어실패(불만 확대)
보류: 고객검토필요(고객이 추후 결정 의사), 판단불가`;
  }
  return `${commonCoT}

[일반 상담 결과 판정 기준]
성공: 목적달성(상담 목적 완료), 고객만족(고객이 만족 표현)
실패: 미해결(문제 미해결 종료), 고객불만(고객이 불만족 표현)
보류: 고객검토필요(고객이 추후 결정 의사), 판단불가`;
}

/**
 * Phase 2: 통합 분석 (요약 + 감정 + 고객명 + 결과를 JSON 한 번에)
 * Claude --json-schema로 구조화된 응답 보장, 정규식 파싱 불필요
 */
async function analyzeUnified(text, teamPrompt, teamName) {
  let evaluationContext = '';
  if (teamPrompt) {
    evaluationContext = `\n[팀 맞춤 평가 기준]\n${teamPrompt}\n위 기준을 반영하여 점수를 매겨주세요.\n`;
  }

  const outcomeContext = buildOutcomeContext(teamName);

  const prompt = `당신은 10년 경력의 콜센터 품질관리(QA) 전문가입니다.
아래 통화를 분석하기 전에, 반드시 다음 사고 과정을 따르세요:

[분석 사고 절차 (Chain-of-Thought)]
1단계: 통화의 목적과 맥락을 파악하세요 (영업/CS/일반 상담 중 어떤 유형인지)
2단계: 상담원의 핵심 행동과 고객의 반응을 구분하세요
3단계: 통화 목적이 달성되었는지 판단하세요
4단계: 아래 요구사항에 맞춰 JSON으로 응답하세요

[분석 요구사항]

1. summary (한 줄 요약)
   - 반드시 한 줄로 작성 (50자 이내 권장, 최대 80자)
   - 핵심 흐름을 "→" 또는 "," 로 연결
   - 통화 목적과 결과가 드러나도록 구성
   - 인사말, 대기 안내, 부수적 표현 제외
   - 예: "아이폰17 색상변경으로 최종진행결정함", "신청서 인증 → 인증서미보유 → 추후 재컨택 예정"

2. sentiment (고객 감정)
   - positive: 고객이 만족, 감사 표현, 협조적 태도
   - negative: 고객이 불만, 화남, 거부, 항의
   - neutral: 담담한 업무 처리, 특별한 감정 표현 없음

3. sentiment_score (상담 품질 점수)
   [점수 면제 → 0 으로 응답하는 경우]
   - 단순 문의 (배송 확인, 영업시간, 잔액 조회 등 정보 전달만 하는 통화)
   - 잘못 걸린 전화, 부재중 응답, 단순 일방적 안내
   - 고객 설득이나 문제 해결 노력이 필요 없는 간단한 응대

   [점수 부여 대상에만 적용하는 루브릭 (1~10)]
   9~10: 탁월 — 고객 감동, 기대 이상의 서비스, 완벽한 문제 해결
   7~8: 우수 — 목적 달성, 고객 만족, 전문적 응대
   5~6: 보통 — 기본적 업무 수행, 특별한 문제 없음
   3~4: 미흡 — 설명 부족, 고객 불만 미해소, 비효율적 진행
   1~2: 심각 — 고객 이탈, 심한 불만, 오안내, 무례한 응대

4. sentiment_reason: 위 점수를 부여한 구체적 근거 (한 문장)

5. customer_name: 통화에서 "OOO 고객님", "OOO씨" 등으로 명확히 호명된 이름만 기재
   - 성만 언급("김 고객님")되면 성만 기재
   - 이름이 전혀 언급되지 않으면 null
   - 추측하거나 유추하지 마세요

6. outcome: 통화 결과 판정
   - 1단계에서 파악한 통화 목적 대비 달성 여부를 판단
   - 형식: "성공: 구체적사유" / "실패: 구체적사유" / "보류: 구체적사유"
${evaluationContext}
${outcomeContext}

[통화 내용]
${text}`;

  return await callClaudeStructured(prompt, UNIFIED_ANALYSIS_SCHEMA, {
    model: CLAUDE_MODEL_SMART,
    timeout: 180000
  });
}

/**
 * 통합 분석 파이프라인 (Fallback Chain 적용)
 *
 * [Claude 사용 시 — Phase 2]
 *   Step 1: 대화 분리 (haiku) → 실패 시 Gemini → Ollama
 *   Step 2: 통합 분석 (sonnet, JSON Schema)
 *     → Phase 2 실패 시 Phase 1 (Gemini→Ollama)로 자동 전환
 *
 * [Non-Claude 사용 시 — Phase 1]
 *   Step 1: 대화 분리 → Step 2~5: 개별 분석 (각각 Fallback Chain 적용)
 *
 * @returns {{ formattedText, summary, sentiment, customerName, outcome }}
 */
async function analyzeCall(text, teamPrompt, teamName) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  const effectivePrompt = teamPrompt || getDefaultTeamPrompt(teamName) || null;

  try {
    // Step 1: 대화 분리 (Fallback Chain 자동 적용)
    console.log(`[AI] Step 1: 대화 분리 (${AI_PROVIDER})...`);
    const formattedText = await formatConversation(text);

    // Claude일 때 Phase 2 시도 (JSON Schema 통합 분석)
    if (AI_PROVIDER === 'claude') {
      try {
        console.log(`[AI] Step 2: 통합 분석 (Claude sonnet, JSON Schema)...`);
        const result = await analyzeUnified(text, effectivePrompt, teamName);

        const sentiment = {
          sentiment: result.sentiment || 'neutral',
          score: result.sentiment_score === 0 ? null : (result.sentiment_score || null),
          reason: result.sentiment_reason || ''
        };

        let customerName = result.customer_name || null;
        if (customerName === '확인불가' || customerName === '없음' || customerName === 'null') {
          customerName = null;
        }

        console.log(`[AI] Phase 2 완료 | ${sentiment.sentiment} (${sentiment.score}/10) | ${result.outcome}`);

        return {
          formattedText,
          summary: result.summary,
          sentiment,
          customerName,
          outcome: result.outcome || '보류: 판단불가'
        };
      } catch (phase2Error) {
        console.warn(`[AI] Phase 2 (Claude) 실패: ${phase2Error.message}`);
        console.warn(`[AI] → Phase 1 개별 호출 Fallback (Gemini→Ollama)...`);
        // Phase 2 실패 → Phase 1로 전환, Claude 건너뛰고 Gemini부터 시작
      }
    }

    // Phase 1: 개별 5단계 호출
    // Claude Phase 2 실패 시 → provider: 'gemini'로 Claude 건너뛰기
    const fallbackOpts = (AI_PROVIDER === 'claude') ? { provider: 'gemini' } : {};
    const label = fallbackOpts.provider ? fallbackOpts.provider.toUpperCase() : AI_PROVIDER.toUpperCase();

    console.log(`[${label}] Step 2/5: 요약...`);
    const summary = await generateSummary(text, fallbackOpts);

    console.log(`[${label}] Step 3/5: 감정 분석...`);
    const sentiment = await analyzeSentiment(text, effectivePrompt, fallbackOpts);

    console.log(`[${label}] Step 4/5: 고객명 추출...`);
    const customerName = await extractCustomerName(text, fallbackOpts);

    console.log(`[${label}] Step 5/5: 결과 판정...`);
    const outcome = await analyzeOutcome(text, teamName, fallbackOpts);

    return { formattedText, summary, sentiment, customerName, outcome };
  } catch (error) {
    console.error(`[AI] Fallback Chain 전체 실패:`, error.message);
    throw error;
  }
}

module.exports = {
  callAI,
  callClaude,
  callClaudeStructured,
  callGemini,
  callCodex,
  formatConversation,
  generateSummary,
  analyzeSentiment,
  extractCustomerName,
  analyzeOutcome,
  analyzeUnified,
  getDefaultTeamPrompt,
  analyzeCall
};
