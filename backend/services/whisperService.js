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
const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9000/asr";
const WHISPER_HEALTH_URL = WHISPER_URL.replace("/asr", "/health");

// ===== 타임아웃 설정 =====
const REQUEST_TIMEOUT = 20 * 60 * 1000; // 20분 - N100 CPU + medium 모델 대용량 파일 처리 대응

// ===== STT busy 대기 설정 =====
// BUSY_MAX_WAIT + REQUEST_TIMEOUT < Bull lockDuration(25분) 이어야 함
// 5분 대기 + 20분 처리 = 25분 ≤ lockDuration
const BUSY_CHECK_INTERVAL = 10000; // 10초마다 busy 상태 체크
const BUSY_MAX_WAIT = 5 * 60 * 1000; // 최대 5분 대기 (STT busy 상태일 때)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @function waitForSTTReady
 * @description STT 서버가 idle 상태가 될 때까지 대기 (busy면 폴링)
 * @returns {Promise<void>}
 */
async function waitForSTTReady() {
  const startWait = Date.now();

  while (Date.now() - startWait < BUSY_MAX_WAIT) {
    try {
      const res = await axios.get(WHISPER_HEALTH_URL, { timeout: 5000 });
      if (res.data && res.data.is_busy) {
        console.log(`⏳ [Whisper] STT 서버 처리 중... ${BUSY_CHECK_INTERVAL / 1000}초 후 재확인`);
        await sleep(BUSY_CHECK_INTERVAL);
        continue;
      }
      return; // STT가 idle 상태 → 요청 가능
    } catch (error) {
      if (error.code === "ECONNREFUSED") {
        throw new Error("Whisper 서버에 연결할 수 없습니다. Docker 컨테이너가 실행 중인지 확인하세요.");
      }
      // health 엔드포인트 일시 오류 → 잠시 대기 후 재시도
      console.log(`⏳ [Whisper] Health check 실패, ${BUSY_CHECK_INTERVAL / 1000}초 후 재시도...`);
      await sleep(BUSY_CHECK_INTERVAL);
    }
  }

  throw new Error(`STT 서버가 ${BUSY_MAX_WAIT / 60000}분 동안 busy 상태. 처리 건너뜀.`);
}

/**
 * @function transcribe
 * @description Whisper API를 호출하여 오디오 파일을 텍스트로 변환
 *   - Bull Queue가 재시도를 담당하므로 내부 재시도 없음 (1회 시도)
 *   - 요청 전 STT 서버 busy 상태 확인 (동시 요청 방지)
 * @param {string} filePath - 변환할 오디오 파일의 절대 경로
 * @returns {Promise<Object>} { text, duration }
 */
async function transcribe(filePath) {
  if (!filePath) {
    throw new Error("[Whisper] 파일 경로가 제공되지 않았습니다.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`[Whisper] 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const fileStats = fs.statSync(filePath);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

  console.log(`🎤 [Whisper] STT 시작: ${path.basename(filePath)} (${fileSizeMB}MB)`);

  // STT 서버가 ready 상태인지 확인 (busy면 대기)
  await waitForSTTReady();

  const startTime = Date.now();

  const formData = new FormData();
  formData.append("audio_file", fs.createReadStream(filePath));

  console.log(`📡 [Whisper] API 요청: ${WHISPER_URL}`);

  // STT 요청 전송 (503 수신 시 busy 대기 후 1회 재시도)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reqFormData = (attempt === 1) ? formData : new FormData();
      if (attempt > 1) {
        reqFormData.append("audio_file", fs.createReadStream(filePath));
      }

      const response = await axios.post(WHISPER_URL, reqFormData, {
        headers: { ...reqFormData.getHeaders() },
        timeout: REQUEST_TIMEOUT,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (!response.data || !response.data.text) {
        throw new Error("Whisper API 응답에 텍스트가 없습니다.");
      }

      const transcribedText = response.data.text.trim();

      console.log(`✅ [Whisper] STT 완료: ${transcribedText.length}자 변환 (${duration}초 소요)`);
      console.log(`📝 [Whisper] 변환 텍스트 미리보기: ${transcribedText.substring(0, 100)}...`);

      return {
        text: transcribedText,
        duration: parseFloat(duration),
      };
    } catch (error) {
      // 503 Busy → STT가 다른 파일 처리 중, busy 대기 후 1회 재시도
      if (error.response && error.response.status === 503 && attempt === 1) {
        console.log(`⏳ [Whisper] STT busy (503), 대기 후 재시도...`);
        await waitForSTTReady();
        continue;
      }

      const errorMessage = error.response
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.code === "ECONNREFUSED"
        ? "Whisper 서버에 연결할 수 없습니다. Docker 컨테이너가 실행 중인지 확인하세요."
        : error.message;

      console.error(`❌ [Whisper] STT 실패: ${errorMessage}`);
      throw new Error(`Whisper STT 실패: ${errorMessage}`);
    }
  }
}

// ===== 내보내기 =====
// 왜 개별 함수로 내보내는가?
// - 필요한 함수만 import 가능 (tree-shaking)
// - 향후 다른 함수 추가 시 확장 용이 (예: transcribeStream, getWhisperStatus)
module.exports = {
  transcribe,
};
