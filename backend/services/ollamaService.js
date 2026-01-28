const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

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

async function generateSummary(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('요약할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화를 2-3문장으로 요약해주세요.

통화 내용:
${text}

요약 (2-3문장으로 핵심 내용만 간결하게):`;

  return await callOllama(prompt);
}

async function analyzeSentiment(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화의 감정을 분석해주세요.

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
감정: [positive/negative/neutral 중 하나]
점수: [1-10 사이의 정수. 1=매우 부정적, 5=중립, 10=매우 긍정적]
이유: [감정 판단 근거를 한 문장으로]`;

  try {
    const response = await callOllama(prompt);

    const sentimentMatch = response.match(/감정:\s*(positive|negative|neutral)/i);
    const scoreMatch = response.match(/점수:\s*(\d+)/);
    const reasonMatch = response.match(/이유:\s*(.+)/);

    let sentiment = 'neutral';
    let score = 5;
    let reason = '';

    if (sentimentMatch) {
      sentiment = sentimentMatch[1].toLowerCase();
    }

    if (scoreMatch) {
      score = Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));
    }

    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    }

    return { sentiment, score, reason };
  } catch (error) {
    console.error('감정 분석 실패:', error.message);
    throw error;
  }
}

async function extractChecklist(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화에서 언급된 액션 아이템, 후속 조치, 약속 사항을 추출해주세요.

통화 내용:
${text}

다음 형식으로 답변해주세요 (각 항목은 새 줄에 "-"로 시작):
- [액션 아이템 1]
- [액션 아이템 2]

만약 액션 아이템이 없다면 "없음"이라고 답변해주세요.`;

  try {
    const response = await callOllama(prompt);

    if (response.match(/없음|없습니다|발견되지 않았습니다/i)) {
      return [];
    }

    const items = response
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim())
      .filter(item => item.length > 0);

    return items;
  } catch (error) {
    console.error('체크리스트 추출 실패:', error.message);
    throw error;
  }
}

/**
 * Extract customer name from call transcript.
 * Returns the customer name if mentioned, or null.
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
      // Filter out non-name responses
      if (name === '확인불가' || name === '없음' || name === '알수없음' || name.length > 20) {
        return null;
      }
      // Clean up suffixes like 고객님, 씨, 님
      return name.replace(/\s*(고객님|고객|님|씨|대리|과장|부장|사원|팀장)$/g, '').trim() || null;
    }

    return null;
  } catch (error) {
    console.error('고객명 추출 실패:', error.message);
    return null; // Non-critical, don't throw
  }
}

/**
 * Full analysis pipeline: summary + sentiment + checklist + customer name
 */
async function analyzeCall(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  try {
    const [summary, sentiment, checklist, customerName] = await Promise.all([
      generateSummary(text),
      analyzeSentiment(text),
      extractChecklist(text),
      extractCustomerName(text)
    ]);

    return {
      summary,
      sentiment,
      checklist,
      customerName
    };
  } catch (error) {
    console.error('통합 분석 실패:', error.message);
    throw error;
  }
}

module.exports = {
  generateSummary,
  analyzeSentiment,
  extractChecklist,
  extractCustomerName,
  analyzeCall
};
