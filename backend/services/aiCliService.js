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

// ===== CLI 실행 기반 함수 =====

/**
 * CLI 도구를 spawn으로 실행, stdin으로 프롬프트 전달
 * - Shell을 거치지 않으므로 Injection 위험 없음
 * - stdin으로 전달하므로 긴 텍스트, 특수문자 안전
 */
function execCli(bin, args, prompt, timeoutMs = 180000) {
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

    // stdin으로 프롬프트 전달 (핵심 안전장치)
    proc.stdin.write(prompt);
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
 * Gemini CLI 호출
 * positional prompt가 아닌 stdin으로 전달 (one-shot 모드)
 */
async function callGemini(prompt, options = {}) {
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Gemini 호출 중...`);
  const result = await execCli(path.join(CLI_BIN, 'gemini'), [], prompt, timeout);
  // Gemini는 "Loaded cached credentials." 등 stderr 출력이 있을 수 있음
  console.log(`[AI-CLI] Gemini 응답: ${result.length} chars`);
  return result;
}

/**
 * Codex (OpenAI) CLI 호출
 */
async function callCodex(prompt, options = {}) {
  const timeout = options.timeout || 180000;

  console.log(`[AI-CLI] Codex 호출 중...`);
  const result = await execCli(
    path.join(CLI_BIN, 'codex'),
    ['exec'],
    prompt,
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
 * 통합 AI 호출 함수
 * provider에 따라 적절한 CLI/API 호출, 실패 시 Ollama Fallback
 */
async function callAI(prompt, options = {}) {
  const provider = options.provider || AI_PROVIDER;

  try {
    switch (provider) {
      case 'claude': return await callClaude(prompt, options);
      case 'gemini': return await callGemini(prompt, options);
      case 'codex':  return await callCodex(prompt, options);
      case 'ollama': return await callOllamaHttp(prompt);
      default: throw new Error(`Unknown AI provider: ${provider}`);
    }
  } catch (error) {
    // Fallback: 기본 provider 실패 시 Ollama로 시도
    if (provider !== 'ollama') {
      console.warn(`[AI-CLI] ${provider} 실패 (${error.message}), Ollama Fallback 시도...`);
      try {
        return await callOllamaHttp(prompt);
      } catch (fallbackError) {
        console.error(`[AI-CLI] Ollama Fallback도 실패: ${fallbackError.message}`);
        throw error; // 원래 에러를 throw
      }
    }
    throw error;
  }
}

// ===== 분석 함수 (ollamaService와 동일한 인터페이스) =====

/**
 * 대화 분리: STT 텍스트를 상담원/고객 발화로 분리
 * Claude 사용 권장 (지시 이행 능력 최상)
 */
async function formatConversation(text) {
  if (!text || text.trim().length === 0) return text;

  const prompt = `다음은 고객 상담 통화의 STT(음성인식) 텍스트입니다. 이 텍스트를 문맥을 파악하여 "상담원"과 "고객"의 대화로 분리해주세요.

엄격한 규칙 (절대 준수):
1. STT 원문의 단어, 문장, 표현을 **단 한 글자도 바꾸지 마세요**.
2. 욕설, 비속어, 문법 오류, 말더듬, 반복되는 말 등을 **절대 수정, 삭제, 순화하지 마세요**.
3. 오직 각 발화 앞에 "상담원:" 또는 "고객:" 라벨만 붙이세요.
4. 내용을 요약하거나 의역하지 마세요.
5. 한 줄에 하나의 발화만 작성하세요.
6. 문맥상 누가 말하는지 판단하세요 (인사, 질문, 답변, 안내 등의 패턴으로 구분).

STT 텍스트:
${text}

대화 분리 결과:`;

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
async function generateSummary(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('요약할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 핵심 내용을 개조식(Bullet points)으로 요약해주세요.

규칙:
1. 서술형 줄글 금지. 반드시 "- " 으로 시작하는 개조식으로 작성.
2. 3~5개 항목으로 핵심만 간결하게.
3. 각 항목은 한 줄로.

통화 내용:
${text}

요약:`;

  return await callAI(prompt);
}

/**
 * 감정 분석 + 점수 (팀별 평가 기준 반영)
 */
async function analyzeSentiment(text, teamPrompt) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  let evaluationContext = '';
  if (teamPrompt) {
    evaluationContext = `\n\n[팀 맞춤 평가 기준]\n${teamPrompt}\n위 기준을 반영하여 점수를 매겨주세요.`;
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화의 감정과 상담 품질을 분석해주세요.${evaluationContext}

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
감정: [positive/negative/neutral 중 하나]
점수: [1-10 사이의 정수. 1=매우 부정적, 5=중립, 10=매우 긍정적]
이유: [감정 판단 근거를 한 문장으로]`;

  try {
    const response = await callAI(prompt);

    const sentimentMatch = response.match(/감정:\s*(positive|negative|neutral)/i);
    const scoreMatch = response.match(/점수:\s*(\d+)/);
    const reasonMatch = response.match(/이유:\s*(.+)/);

    let sentiment = 'neutral';
    let score = 5;
    let reason = '';

    if (sentimentMatch) sentiment = sentimentMatch[1].toLowerCase();
    if (scoreMatch) score = Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));
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
async function extractCustomerName(text) {
  if (!text || text.trim().length === 0) return null;

  const prompt = `다음은 고객 상담 통화 내용입니다. 통화 내용에서 고객의 이름이나 호칭이 언급되었는지 확인해주세요.
예시: "김철수 고객님", "박영희씨", "이 대리님" 등

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
고객명: [이름 또는 "확인불가"]

이름을 추측하지 말고, 통화에서 명확히 언급된 이름만 적어주세요.`;

  try {
    const response = await callAI(prompt);
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
async function analyzeOutcome(text, teamName) {
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

  const prompt = `다음은 고객 상담 통화 내용입니다. 통화의 최종 결과를 판정해주세요.

${teamContext}

판단이 어려운 경우 → "보류: 판단불가"

통화 내용:
${text}

다음 형식으로 정확히 한 줄만 답변해주세요:
결과: [성공/실패/보류]: [사유]

예시:
결과: 성공: 구매확정
결과: 실패: 가격부담
결과: 보류: 판단불가`;

  try {
    const response = await callAI(prompt);
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

/**
 * 통합 분석 파이프라인 (ollamaService.analyzeCall과 동일한 인터페이스)
 * @returns {{ formattedText, summary, sentiment, customerName, outcome }}
 */
async function analyzeCall(text, teamPrompt, teamName) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  const effectivePrompt = teamPrompt || getDefaultTeamPrompt(teamName) || null;
  const providerLabel = AI_PROVIDER.toUpperCase();

  try {
    console.log(`[${providerLabel}] Step 1/5: 대화 분리...`);
    const formattedText = await formatConversation(text);

    console.log(`[${providerLabel}] Step 2/5: 요약...`);
    const summary = await generateSummary(text);

    console.log(`[${providerLabel}] Step 3/5: 감정 분석...`);
    const sentiment = await analyzeSentiment(text, effectivePrompt);

    console.log(`[${providerLabel}] Step 4/5: 고객명 추출...`);
    const customerName = await extractCustomerName(text);

    console.log(`[${providerLabel}] Step 5/5: 결과 판정...`);
    const outcome = await analyzeOutcome(text, teamName);

    return {
      formattedText,
      summary,
      sentiment,
      customerName,
      outcome
    };
  } catch (error) {
    console.error(`[${providerLabel}] 통합 분석 실패:`, error.message);
    throw error;
  }
}

module.exports = {
  callAI,
  callClaude,
  callGemini,
  callCodex,
  formatConversation,
  generateSummary,
  analyzeSentiment,
  extractCustomerName,
  analyzeOutcome,
  getDefaultTeamPrompt,
  analyzeCall
};
