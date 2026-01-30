// ===== AI Call Agent - Whisper Service =====
// 작성: Claude Sonnet 4.5 | 검수: Ser8
// 목적: Whisper Docker API를 사용한 음성-텍스트 변환 (STT)
//
// 왜 Whisper를 사용하는가?
// - OpenAI의 강력한 음성 인식 모델 (다국어 지원)
// - 로컬 Docker로 실행하여 프라이버시 보호 및 비용 절감
// - 통화 녹취 파일을 텍스트로 변환하여 LLM 분석 가능

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

// ===== 환경 변수 로드 =====
// 왜 환경 변수를 사용하는가?
// - Docker 환경과 로컬 환경에서 다른 Whisper 주소 사용 가능
// - 테스트 시 Mock 서버로 쉽게 전환 가능
const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9000/asr";

// ===== 재시도 설정 =====
// 왜 재시도가 필요한가?
// - Whisper 서버가 일시적으로 과부하 상태일 수 있음
// - 네트워크 일시적 오류 복구
// - 안정적인 서비스 제공
const MAX_RETRIES = 3; // 최대 재시도 횟수
const RETRY_DELAY = 2000; // 재시도 간격 (밀리초)

// ===== 타임아웃 설정 =====
// 왜 타임아웃이 필요한가?
// - 큰 녹취 파일은 STT 처리에 시간이 오래 걸림
// - 무한 대기 방지
const REQUEST_TIMEOUT = 20 * 60 * 1000; // 20분 (1200초) - N100 CPU + medium 모델 대용량 파일 처리 대응

/**
 * @function sleep
 * @description 비동기 대기 함수
 * @param {number} ms - 대기 시간 (밀리초)
 * @returns {Promise<void>}
 *
 * 왜 sleep 함수가 필요한가?
 * - 재시도 시 서버 복구 시간 확보 (지수 백오프 구현)
 * - setTimeout을 Promise로 래핑하여 async/await 사용 가능
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @function transcribe
 * @description Whisper API를 호출하여 오디오 파일을 텍스트로 변환
 * @param {string} filePath - 변환할 오디오 파일의 절대 경로
 * @returns {Promise<Object>} 변환 결과
 * @returns {string} result.text - 변환된 텍스트
 * @returns {number} result.duration - 처리 시간 (초)
 *
 * 왜 이 함수가 필요한가?
 * - 통화 녹취 파일을 텍스트로 변환하여 LLM 분석 가능
 * - 다른 서비스에서 간단히 호출 가능한 인터페이스 제공
 *
 * 사용 예시:
 * const { text, duration } = await transcribe('/path/to/audio.mp3');
 * console.log('변환된 텍스트:', text);
 */
async function transcribe(filePath) {
  // ===== 입력 검증 =====
  // 왜 검증이 필요한가?
  // - 잘못된 파일 경로로 인한 에러 사전 방지
  // - 명확한 에러 메시지로 디버깅 용이
  if (!filePath) {
    throw new Error("[Whisper] 파일 경로가 제공되지 않았습니다.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`[Whisper] 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const fileStats = fs.statSync(filePath);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

  console.log(`🎤 [Whisper] STT 시작: ${path.basename(filePath)} (${fileSizeMB}MB)`);

  // ===== 재시도 로직 =====
  // 왜 for 루프로 재시도를 구현하는가?
  // - 명확한 재시도 횟수 제어
  // - 각 시도마다 다른 로직 적용 가능 (지수 백오프)
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();

      // ===== FormData 생성 =====
      // 왜 FormData를 사용하는가?
      // - Whisper API는 multipart/form-data로 파일 전송 요구
      // - 파일 스트림을 효율적으로 전송 (메모리 절약)
      const formData = new FormData();
      formData.append("audio_file", fs.createReadStream(filePath));

      // ===== API 요청 전송 =====
      // 왜 axios를 사용하는가?
      // - Promise 기반으로 async/await 사용 가능
      // - 자동 JSON 파싱
      // - 요청/응답 인터셉터로 로깅 확장 가능
      console.log(
        `📡 [Whisper] API 요청 (시도 ${attempt}/${MAX_RETRIES}): ${WHISPER_URL}`
      );

      const response = await axios.post(WHISPER_URL, formData, {
        headers: {
          ...formData.getHeaders(), // Content-Type: multipart/form-data; boundary=...
        },
        timeout: REQUEST_TIMEOUT, // 5분 타임아웃
        maxContentLength: Infinity, // 응답 크기 제한 없음
        maxBodyLength: Infinity, // 요청 본문 크기 제한 없음
      });

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2); // 초 단위

      // ===== 응답 검증 =====
      // 왜 응답 검증이 필요한가?
      // - Whisper API가 200 OK를 반환해도 실제 텍스트가 없을 수 있음
      // - 빈 응답은 에러로 처리하여 재시도
      if (!response.data || !response.data.text) {
        throw new Error("Whisper API 응답에 텍스트가 없습니다.");
      }

      const transcribedText = response.data.text.trim();

      console.log(
        `✅ [Whisper] STT 완료: ${transcribedText.length}자 변환 (${duration}초 소요)`
      );
      console.log(`📝 [Whisper] 변환 텍스트 미리보기: ${transcribedText.substring(0, 100)}...`);

      // ===== 성공 응답 반환 =====
      return {
        text: transcribedText,
        duration: parseFloat(duration),
      };
    } catch (error) {
      lastError = error;

      // ===== 에러 로깅 =====
      // 왜 상세한 로깅이 필요한가?
      // - 네트워크 오류 vs Whisper 서버 오류 구분
      // - 디버깅 시 원인 파악 용이
      const errorMessage = error.response
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.code === "ECONNREFUSED"
        ? "Whisper 서버에 연결할 수 없습니다. Docker 컨테이너가 실행 중인지 확인하세요."
        : error.code === "ETIMEDOUT"
        ? `요청 타임아웃 (${REQUEST_TIMEOUT / 1000}초 초과)`
        : error.message;

      console.error(
        `❌ [Whisper] STT 실패 (시도 ${attempt}/${MAX_RETRIES}): ${errorMessage}`
      );

      // ===== 재시도 로직 =====
      // 왜 마지막 시도에서는 재시도하지 않는가?
      // - 불필요한 대기 시간 제거
      // - 즉시 에러를 상위 호출자에게 전달
      if (attempt < MAX_RETRIES) {
        // 지수 백오프: 2초 → 4초 → 8초
        const delayMs = RETRY_DELAY * attempt;
        console.log(`⏳ [Whisper] ${delayMs / 1000}초 후 재시도...`);
        await sleep(delayMs);
      }
    }
  }

  // ===== 모든 재시도 실패 =====
  // 왜 별도 에러 메시지를 생성하는가?
  // - 재시도 횟수를 명확히 표시
  // - 상위 호출자가 적절히 처리할 수 있도록 정보 제공
  const finalErrorMessage = lastError.response
    ? `Whisper API 호출 실패: HTTP ${lastError.response.status}`
    : lastError.code === "ECONNREFUSED"
    ? "Whisper 서버에 연결할 수 없습니다. Docker 컨테이너를 확인하세요."
    : `Whisper STT 실패: ${lastError.message}`;

  console.error(
    `🚨 [Whisper] ${MAX_RETRIES}번 재시도 후 최종 실패: ${finalErrorMessage}`
  );

  throw new Error(finalErrorMessage);
}

// ===== 내보내기 =====
// 왜 개별 함수로 내보내는가?
// - 필요한 함수만 import 가능 (tree-shaking)
// - 향후 다른 함수 추가 시 확장 용이 (예: transcribeStream, getWhisperStatus)
module.exports = {
  transcribe,
};
