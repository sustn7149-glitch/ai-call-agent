const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

// Team-specific evaluation prompts
const TEAM_PROMPTS = {
  '영업팀': `당신은 영업 상담 전문 평가관입니다.
평가 기준:
- 고객에게 상품/서비스를 효과적으로 권유했는가
- 고객의 긍정적 반응(관심, 구매 의사)을 이끌어냈는가
- 판매/계약 성사에 성공했는가

점수 기준:
높은 점수(8-10): 판매 성공 또는 고객의 명확한 긍정 반응
중간 점수(4-7): 상품 설명은 했으나 결과 미확정
낮은 점수(1-3): 고객 거절, 부정적 반응, 설명 부족`,

  '민원팀': `당신은 민원/CS 상담 전문 평가관입니다.
평가 기준:
- 고객의 불만(VOC)을 차분하고 전문적으로 응대했는가
- 환불/보상 비용을 최소화하면서 문제를 해결했는가
- 고객의 감정을 진정시키고 만족스러운 해결을 이끌었는가

점수 기준:
높은 점수(8-10): 불만 원만히 해결, 비용 최소화, 고객 수긍
중간 점수(4-7): 부분 해결, 추가 조치 필요
낮은 점수(1-3): 고객 불만 악화, 과도한 보상 약속, 응대 미흡`,

  '일반': `당신은 고객 상담 품질 평가관입니다.
평가 기준:
- 상담원이 친절하고 정확하게 응대했는가
- 고객의 요청/문의를 제대로 파악하고 답변했는가
- 전반적인 상담 품질과 고객 만족도

점수 기준:
높은 점수(8-10): 친절하고 정확한 응대, 고객 만족
중간 점수(4-7): 기본적인 응대, 보통 수준
낮은 점수(1-3): 불친절하거나 부정확한 응대`
};

async function callOllama(prompt) {
  try {
    const response = await axios.post(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false
    }, {
      timeout: 180000
    });

    if (response.data && response.data.response) {
      return response.data.response.trim();
    }

    throw new Error('Ollama API 응답 형식이 올바르지 않습니다.');
  } catch (error) {
    console.error('Ollama API 호출 실패:', {
      message: error.message,
      url: OLLAMA_URL,
      model: OLLAMA_MODEL
    });

    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama 서버에 연결할 수 없습니다.');
    } else if (error.code === 'ETIMEDOUT') {
      throw new Error('Ollama API 요청 시간이 초과되었습니다.');
    }

    throw new Error(`Ollama API 오류: ${error.message}`);
  }
}

/**
 * Reformat raw STT text into a dialogue between agent and customer.
 */
async function reformatTranscript(text) {
  if (!text || text.trim().length === 0) {
    return text;
  }

  const prompt = `다음은 고객 상담 통화의 음성인식(STT) 결과입니다. 문맥을 파악하여 상담원과 고객의 대화를 구분해서 재구성해주세요.

엄격한 규칙 (절대 준수):
1. STT 원문의 단어, 문장, 표현을 **단 한 글자도 바꾸지 마세요**.
2. 욕설, 비속어, 문법 오류, 말더듬, 반복되는 말 등을 **절대 수정, 삭제, 순화하지 마세요**. 들리는 그대로 적으세요.
3. 오직 각 발화 앞에 "상담원:" 또는 "고객:" 라벨만 붙이세요.
4. 내용을 요약하거나 의역하지 마세요.
5. 한 줄에 하나의 발화만 작성하세요.

STT 원문:
${text}

대화 재구성 (원문 그대로):`;

  return await callOllama(prompt);
}

/**
 * Team-specific analysis: bullet-point summary + sentiment + score.
 * @param {string} text - Transcript text
 * @param {string|null} teamName - Team name for fallback prompt selection
 * @param {string|null} customPrompt - Custom evaluation prompt from teams DB (takes priority)
 */
async function generateTeamAnalysis(text, teamName, customPrompt) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  // Priority: custom prompt from DB > hardcoded team prompt > default
  const systemPrompt = (customPrompt && customPrompt.trim())
    ? customPrompt.trim()
    : (TEAM_PROMPTS[teamName] || TEAM_PROMPTS['일반']);

  const prompt = `${systemPrompt}

다음 고객 상담 통화 내용을 분석해주세요.

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:

[요약]
- 핵심 내용 1
- 핵심 내용 2
- 핵심 내용 3

[평가]
감정: [positive/negative/neutral 중 하나]
점수: [1-10 사이의 정수]
이유: [평가 근거를 한 문장으로]`;

  try {
    const response = await callOllama(prompt);

    // Parse summary (bullet points between [요약] and [평가])
    const summaryMatch = response.match(/\[요약\]([\s\S]*?)(?=\[평가\])/);
    let summary = '';
    if (summaryMatch) {
      summary = summaryMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .join('\n');
    }
    if (!summary) {
      // Fallback: collect all bullet lines
      const lines = response.split('\n').filter(l => l.trim().startsWith('-'));
      summary = lines.join('\n') || response.substring(0, 300);
    }

    // Parse sentiment
    const sentimentMatch = response.match(/감정:\s*(positive|negative|neutral)/i);
    const scoreMatch = response.match(/점수:\s*(\d+)/);
    const reasonMatch = response.match(/이유:\s*(.+)/);

    const sentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : 'neutral';
    const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : 5;
    const reason = reasonMatch ? reasonMatch[1].trim() : '';

    return { summary, sentiment: { sentiment, score, reason } };
  } catch (error) {
    console.error('팀 분석 실패:', error.message);
    throw error;
  }
}

/**
 * Extract customer name from call transcript.
 */
async function extractCustomerName(text) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 통화 내용에서 고객의 이름이나 호칭이 언급되었는지 확인해주세요.
예시: "김철수 고객님", "박영희씨", "이 대리님" 등

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
고객명: [이름 또는 "확인불가"]

이름을 추측하지 말고, 통화에서 명확히 언급된 이름만 적어주세요.`;

  try {
    const response = await callOllama(prompt);
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
    console.error('고객명 추출 실패:', error.message);
    return null;
  }
}

/**
 * Full analysis pipeline: reformat transcript + team analysis + customer name.
 * @param {string} text - Raw STT transcript
 * @param {string|null} teamName - Team name for specialized evaluation
 * @param {string|null} customPrompt - Custom evaluation prompt from teams DB
 */
async function analyzeCall(text, teamName, customPrompt) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  console.log(`[AI] Team-specific analysis: team=${teamName || 'default'}, customPrompt=${customPrompt ? 'yes' : 'no'}`);

  try {
    const [transcript, analysis, customerName] = await Promise.all([
      reformatTranscript(text),
      generateTeamAnalysis(text, teamName, customPrompt),
      extractCustomerName(text)
    ]);

    return {
      transcript,
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      customerName
    };
  } catch (error) {
    console.error('통합 분석 실패:', error.message);
    throw error;
  }
}

module.exports = {
  reformatTranscript,
  generateTeamAnalysis,
  extractCustomerName,
  analyzeCall
};
