/**
 * Ollama AI 서비스
 * 로컬 Ollama API를 사용하여 통화 내용을 분석하는 서비스
 *
 * 주요 기능:
 * - 통화 요약 생성
 * - 감정 분석
 * - 체크리스트/액션 아이템 추출
 */

const axios = require('axios');

/**
 * Ollama API 설정
 * 환경 변수를 통해 커스터마이징 가능
 */
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

/**
 * Ollama API 호출 헬퍼 함수
 * @param {string} prompt - AI에게 전달할 프롬프트
 * @returns {Promise<string>} AI 응답 텍스트
 */
async function callOllama(prompt) {
  try {
    const response = await axios.post(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false // 스트리밍 비활성화 - 전체 응답을 한 번에 받음
    }, {
      timeout: 180000 // 180초 타임아웃 (N100 저전력 CPU 고려)
    });

    // Ollama 응답에서 텍스트 추출
    if (response.data && response.data.response) {
      return response.data.response.trim();
    }

    throw new Error('Ollama API 응답 형식이 올바르지 않습니다.');
  } catch (error) {
    // 상세한 에러 로깅
    console.error('Ollama API 호출 실패:', {
      message: error.message,
      url: OLLAMA_URL,
      model: OLLAMA_MODEL
    });

    // 에러 타입별 처리
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama 서버에 연결할 수 없습니다. Ollama가 실행 중인지 확인하세요.');
    } else if (error.code === 'ETIMEDOUT') {
      throw new Error('Ollama API 요청 시간이 초과되었습니다.');
    }

    throw new Error(`Ollama API 오류: ${error.message}`);
  }
}

/**
 * 통화 내용 요약 생성
 * 통화 텍스트를 분석하여 2-3문장으로 핵심 내용을 요약
 *
 * @param {string} text - 통화 전사 텍스트
 * @returns {Promise<string>} 요약된 텍스트
 */
async function generateSummary(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('요약할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화를 2-3문장으로 요약해주세요.

통화 내용:
${text}

요약 (2-3문장으로 핵심 내용만 간결하게):`;

  try {
    const summary = await callOllama(prompt);
    return summary;
  } catch (error) {
    console.error('통화 요약 생성 실패:', error.message);
    throw new Error(`요약 생성 중 오류가 발생했습니다: ${error.message}`);
  }
}

/**
 * 감정 분석 수행
 * 통화 내용의 전반적인 감정(긍정/부정/중립)과 점수를 분석
 *
 * @param {string} text - 통화 전사 텍스트
 * @returns {Promise<{sentiment: string, score: number, reason: string}>} 감정 분석 결과
 */
async function analyzeSentiment(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  const prompt = `다음은 고객 상담 통화 내용입니다. 이 통화의 감정을 분석해주세요.

통화 내용:
${text}

다음 형식으로 정확히 답변해주세요:
감정: [positive/negative/neutral 중 하나]
점수: [0-100 사이의 숫자]
이유: [감정 판단 근거를 한 문장으로]`;

  try {
    const response = await callOllama(prompt);

    // 응답 파싱
    const sentimentMatch = response.match(/감정:\s*(positive|negative|neutral)/i);
    const scoreMatch = response.match(/점수:\s*(\d+)/);
    const reasonMatch = response.match(/이유:\s*(.+)/);

    // 기본값 설정
    let sentiment = 'neutral';
    let score = 50;
    let reason = '분석 결과를 파싱할 수 없습니다.';

    if (sentimentMatch) {
      sentiment = sentimentMatch[1].toLowerCase();
    }

    if (scoreMatch) {
      score = Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10)));
    }

    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    }

    return {
      sentiment,
      score,
      reason
    };
  } catch (error) {
    console.error('감정 분석 실패:', error.message);
    throw new Error(`감정 분석 중 오류가 발생했습니다: ${error.message}`);
  }
}

/**
 * 체크리스트 및 액션 아이템 추출
 * 통화에서 언급된 할 일, 후속 조치, 약속 사항 등을 추출
 *
 * @param {string} text - 통화 전사 텍스트
 * @returns {Promise<Array<string>>} 액션 아이템 배열
 */
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
- [액션 아이템 3]

만약 액션 아이템이 없다면 "없음"이라고 답변해주세요.`;

  try {
    const response = await callOllama(prompt);

    // "없음" 또는 유사한 응답 체크
    if (response.match(/없음|없습니다|발견되지 않았습니다/i)) {
      return [];
    }

    // "-"로 시작하는 라인 추출
    const items = response
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim())
      .filter(item => item.length > 0);

    return items;
  } catch (error) {
    console.error('체크리스트 추출 실패:', error.message);
    throw new Error(`체크리스트 추출 중 오류가 발생했습니다: ${error.message}`);
  }
}

/**
 * 통합 분석 함수
 * 요약, 감정 분석, 체크리스트 추출을 한 번에 수행
 *
 * @param {string} text - 통화 전사 텍스트
 * @returns {Promise<{summary: string, sentiment: object, checklist: Array<string>}>} 통합 분석 결과
 */
async function analyzeCall(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('분석할 텍스트가 비어있습니다.');
  }

  try {
    // 모든 분석을 병렬로 실행하여 성능 향상
    const [summary, sentiment, checklist] = await Promise.all([
      generateSummary(text),
      analyzeSentiment(text),
      extractChecklist(text)
    ]);

    return {
      summary,
      sentiment,
      checklist
    };
  } catch (error) {
    console.error('통합 분석 실패:', error.message);
    throw new Error(`통화 분석 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 모듈 내보내기
module.exports = {
  generateSummary,
  analyzeSentiment,
  extractChecklist,
  analyzeCall
};
