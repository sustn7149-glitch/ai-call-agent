// ===== AI Call Agent - Analysis Worker =====
// 작성: Claude Sonnet 4.5 | 검수: Ser8
// 목적: Bull Queue 작업 처리 - Whisper STT → Ollama 분석 → DB 저장
//
// 왜 별도 Worker 프로세스가 필요한가?
// - N100 서버의 제한된 리소스로 동시 처리 제한 (concurrency: 1)
// - 메인 API 서버와 분리하여 무거운 AI 작업이 API 응답 속도에 영향 없음
// - 작업 실패 시 자동 재시도 및 에러 격리
// - Bull Queue를 통한 작업 우선순위 관리 및 모니터링

const queueService = require("../services/queueService");
const whisperService = require("../services/whisperService");
const ollamaService = require("../services/ollamaService");
const databaseService = require("../services/databaseService");

// ===== Worker 설정 상수 =====
// 왜 concurrency를 1로 설정하는가?
// - N100 서버는 저전력 CPU로 동시 분석 작업 시 성능 저하
// - Whisper STT와 Ollama LLM 모두 CPU 집약적
// - 순차 처리로 안정성 보장, 작업 실패율 감소
const CONCURRENCY = 1;

/**
 * @function processAnalysisJob
 * @description Bull Queue 작업 처리 핵심 로직
 * @param {Object} job - Bull Queue Job 인스턴스
 * @param {Object} job.data - 작업 데이터
 * @param {string} job.data.filePath - 녹취 파일 경로
 * @param {string} job.data.fileName - 녹취 파일 이름
 * @param {string} job.data.phoneNumber - 전화번호
 * @param {number} [job.data.callId] - 통화 DB ID (선택적)
 * @param {string} [job.data.recordingId] - 녹취 고유 ID (선택적)
 * @returns {Promise<Object>} 분석 결과
 *
 * 처리 흐름:
 * 1. 작업 데이터 추출 및 검증
 * 2. Whisper STT 수행 (음성 → 텍스트)
 * 3. Ollama AI 분석 (요약, 감정, 체크리스트)
 * 4. DB 저장 및 플래그 업데이트
 * 5. 진행률 리포트 (Socket.io로 실시간 대시보드 업데이트)
 */
async function processAnalysisJob(job) {
  try {
    // ===== 단계 1: 작업 데이터 추출 및 검증 =====
    const { filePath, fileName, phoneNumber, callId, recordingId } = job.data;

    console.log(`🚀 [Worker] 작업 시작: Job #${job.id}`);
    console.log(`📞 [Worker] 전화번호: ${phoneNumber}`);
    console.log(`📁 [Worker] 파일: ${fileName || filePath}`);
    console.log(`🔑 [Worker] Call ID: ${callId || "미지정 (전화번호로 조회)"}`);

    // 진행률 0% → 10% (시작)
    await job.progress(10);

    // ===== 필수 데이터 검증 =====
    // 왜 filePath 검증이 중요한가?
    // - 잘못된 파일 경로로 인한 Whisper 에러 사전 방지
    // - 명확한 에러 메시지로 디버깅 용이
    if (!filePath) {
      throw new Error("파일 경로가 제공되지 않았습니다.");
    }

    if (!phoneNumber) {
      throw new Error("전화번호가 제공되지 않았습니다.");
    }

    // ===== 단계 2: Whisper STT 수행 =====
    // 왜 별도 서비스로 분리했는가?
    // - 재사용성: 다른 Worker에서도 동일한 STT 로직 사용 가능
    // - 테스트 용이: whisperService만 독립적으로 테스트 가능
    // - 관심사 분리: Worker는 작업 흐름 관리, Whisper는 STT 전담
    console.log(`🎤 [Worker] STT 시작 (Whisper)...`);

    const { text: transcribedText, duration: sttDuration } =
      await whisperService.transcribe(filePath);

    console.log(`✅ [Worker] STT 완료: ${transcribedText.length}자 (${sttDuration}초)`);
    console.log(`📝 [Worker] STT 미리보기: ${transcribedText.substring(0, 150)}...`);

    // 진행률 10% → 50% (STT 완료)
    await job.progress(50);

    // ===== 단계 3: Ollama AI 분석 수행 =====
    // 왜 analyzeCall을 사용하는가?
    // - 요약, 감정, 체크리스트를 한 번에 병렬 처리 (성능 최적화)
    // - 일관된 분석 결과 형식 보장
    console.log(`🤖 [Worker] AI 분석 시작 (Ollama)...`);

    const analysisResults = await ollamaService.analyzeCall(transcribedText);

    console.log(`✅ [Worker] AI 분석 완료`);
    console.log(`📊 [Worker] 요약: ${analysisResults.summary.substring(0, 100)}...`);
    console.log(
      `😊 [Worker] 감정: ${analysisResults.sentiment.sentiment} (${analysisResults.sentiment.score}/100)`
    );
    console.log(
      `✔️ [Worker] 체크리스트: ${analysisResults.checklist.length}개 항목`
    );

    // 진행률 50% → 90% (분석 완료)
    await job.progress(90);

    // ===== 단계 4: DB 저장 =====
    // 왜 callId가 없을 수 있는가?
    // - 이전 버전의 코드에서 callId 대신 phoneNumber만 전달했을 수 있음
    // - 호환성 유지를 위해 전화번호로 최근 통화 조회
    let finalCallId = callId;

    if (!finalCallId) {
      console.log(
        `⚠️ [Worker] callId 미제공 - phoneNumber로 최근 통화 조회 중...`
      );

      // phoneNumber로 최근 통화 찾기
      // 왜 이 로직이 필요한가?
      // - 녹취 파일 업로드 시점과 분석 시점이 다를 수 있음
      // - DB에는 이미 통화 기록이 저장되어 있음 (recording_path 포함)
      const allCalls = databaseService.getAllCalls();

      // getAllCalls는 [array of arrays] 형식 반환 (sql.js 특성)
      // columns: [id, call_id, phone_number, direction, status, recording_path, ...]
      const matchingCall = allCalls.find((callRow) => {
        const phoneNumberIndex = 2; // phone_number는 3번째 컬럼 (0-based)
        const recordingPathIndex = 5; // recording_path는 6번째 컬럼
        return (
          callRow[phoneNumberIndex] === phoneNumber &&
          callRow[recordingPathIndex] === filePath
        );
      });

      if (matchingCall) {
        finalCallId = matchingCall[0]; // id는 첫 번째 컬럼
        console.log(`✅ [Worker] 통화 찾음: Call ID ${finalCallId}`);
      } else {
        throw new Error(
          `전화번호 ${phoneNumber}와 파일 ${filePath}에 해당하는 통화 기록을 찾을 수 없습니다.`
        );
      }
    }

    // ===== 분석 결과 DB 저장 =====
    // 왜 이 형식으로 저장하는가?
    // - databaseService.saveAnalysisResult의 인터페이스에 맞춤
    // - transcript: STT 원본 텍스트 (재분석 시 활용)
    // - summary: 통화 요약
    // - sentiment: 감정 (positive/negative/neutral)
    // - sentiment_score: 감정 점수 (0-100)
    // - checklist: JSON 배열 (액션 아이템 목록)
    console.log(`💾 [Worker] DB 저장 중... (Call ID: ${finalCallId})`);

    const dbResults = {
      transcript: transcribedText,
      summary: analysisResults.summary,
      sentiment: analysisResults.sentiment.sentiment,
      sentiment_score: analysisResults.sentiment.score,
      checklist: analysisResults.checklist,
    };

    databaseService.saveAnalysisResult(finalCallId, dbResults);

    console.log(`✅ [Worker] DB 저장 완료 (Call ID: ${finalCallId})`);

    // 진행률 90% → 100% (완료)
    await job.progress(100);

    // ===== 단계 5: 최종 결과 반환 =====
    // 왜 결과를 반환하는가?
    // - Bull Queue의 completed 이벤트로 결과 전달
    // - 대시보드에서 실시간 결과 표시
    // - 테스트 시 검증 용이
    const finalResult = {
      callId: finalCallId,
      recordingId: recordingId || `call_${finalCallId}`,
      phoneNumber,
      sttDuration,
      transcriptLength: transcribedText.length,
      ...analysisResults,
    };

    console.log(`🎉 [Worker] 작업 완료: Job #${job.id}`);

    return finalResult;
  } catch (error) {
    // ===== 에러 처리 =====
    // 왜 상세한 에러 로깅이 필요한가?
    // - STT 실패 vs AI 분석 실패 vs DB 저장 실패 구분
    // - 재시도 시 원인 파악 용이
    // - 프로덕션 환경에서 디버깅 필수
    console.error(`❌ [Worker] 작업 실패: Job #${job.id}`);
    console.error(`❌ [Worker] 에러 메시지: ${error.message}`);
    console.error(`❌ [Worker] 스택 트레이스:`, error.stack);

    // ===== 에러를 상위로 전달 =====
    // 왜 에러를 throw하는가?
    // - Bull Queue의 재시도 메커니즘 활성화 (최대 3번)
    // - failed 이벤트 발생 → Socket.io로 대시보드에 실패 알림
    // - 에러 로그가 Bull Queue에 저장되어 수동 디버깅 가능
    throw error;
  }
}

/**
 * @function start
 * @description Worker 시작 함수 (외부에서 호출)
 * @returns {void}
 *
 * 왜 start() 함수로 분리하는가?
 * - 메인 서버(index.js)에서 명시적으로 Worker 시작
 * - 테스트 환경에서는 Worker를 시작하지 않을 수 있음
 * - 프로세스 관리 용이 (PM2, Docker 등)
 */
function start() {
  // ===== Bull Queue 인스턴스 가져오기 =====
  // 왜 getQueue()를 사용하는가?
  // - queueService는 싱글톤이므로 같은 Queue 인스턴스 공유
  // - 메인 서버에서 추가한 작업을 Worker가 처리
  const queue = queueService.getQueue();

  // ===== 작업 처리 프로세서 등록 =====
  // 왜 queue.process()를 호출하는가?
  // - Bull Queue에게 "이 Worker가 작업을 처리하겠다"고 선언
  // - concurrency: 1 → 한 번에 하나의 작업만 처리
  // - processAnalysisJob → 각 작업마다 호출되는 핸들러
  queue.process(CONCURRENCY, processAnalysisJob);

  console.log(`👷 [Worker] Analysis Worker 시작 (Concurrency: ${CONCURRENCY})`);
  console.log(`📡 [Worker] Queue 대기 중... (새 작업 수신 대기)`);

  // ===== Worker 프로세스 종료 이벤트 처리 =====
  // 왜 graceful shutdown이 필요한가?
  // - 작업 처리 중 프로세스가 종료되면 데이터 손실 가능
  // - Bull Queue에 "작업 실패"로 기록하여 재시도 가능
  // - Redis 연결 정리 (메모리 누수 방지)
  process.on("SIGTERM", async () => {
    console.log(`🛑 [Worker] SIGTERM 수신 - Graceful Shutdown 시작...`);
    await queue.close();
    console.log(`✅ [Worker] Queue 종료 완료`);
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log(`🛑 [Worker] SIGINT 수신 - Graceful Shutdown 시작...`);
    await queue.close();
    console.log(`✅ [Worker] Queue 종료 완료`);
    process.exit(0);
  });
}

// ===== 모듈 내보내기 =====
// 왜 start 함수만 내보내는가?
// - 메인 서버에서 analysisWorker.start()로 간단히 시작
// - processAnalysisJob은 내부 구현이므로 외부 노출 불필요
module.exports = {
  start,
};
