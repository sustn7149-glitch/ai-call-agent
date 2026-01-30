const queueService = require("../services/queueService");
const whisperService = require("../services/whisperService");
const ollamaService = require("../services/ollamaService");
const databaseService = require("../services/databaseService");

const CONCURRENCY = 1;

async function processAnalysisJob(job) {
  try {
    const { filePath, fileName, phoneNumber, callId, recordingId } = job.data;

    console.log(`[Worker] Job #${job.id} started: ${fileName || filePath} (${phoneNumber})`);
    await job.progress(10);

    if (!filePath) throw new Error("파일 경로가 제공되지 않았습니다.");

    // Find call ID
    let finalCallId = callId;
    if (!finalCallId) {
      const allCalls = databaseService.getAllCalls();
      const matchingCall = allCalls.find((callRow) => {
        const phoneNumberIndex = 2;
        const recordingPathIndex = 5;
        return (
          callRow[phoneNumberIndex] === phoneNumber &&
          callRow[recordingPathIndex] === filePath
        );
      });

      if (matchingCall) {
        finalCallId = matchingCall[0];
      } else {
        throw new Error(`통화 기록을 찾을 수 없습니다: ${phoneNumber} / ${filePath}`);
      }
    }

    // Update status to processing
    databaseService.updateAiStatus(finalCallId, 'processing');

    // Look up team for team-specific evaluation
    const teamName = databaseService.getCallTeam(finalCallId);
    const customPrompt = databaseService.getTeamEvaluationPrompt(teamName);
    console.log(`[Worker] Call #${finalCallId} team: ${teamName || 'default'}, customPrompt: ${customPrompt ? 'yes' : 'no'}`);

    // Check call duration (from DB)
    const callRecord = databaseService.getCallWithAnalysis(finalCallId);
    const callDuration = callRecord ? (callRecord.duration || 0) : 0;

    // Step 1: Whisper STT
    console.log(`[Worker] STT starting...`);
    const { text: rawText, duration: sttDuration } =
      await whisperService.transcribe(filePath);

    console.log(`[Worker] STT complete: ${rawText.length} chars (${sttDuration}s)`);
    await job.progress(50);

    // Step 2: Skip AI evaluation if (duration is known and < 30s) or STT text < 50 chars
    const skipAi = (callDuration > 0 && callDuration < 30) || rawText.length < 50;
    if (skipAi) {
      console.log(`[Worker] AI evaluation SKIPPED: duration=${callDuration}s, textLen=${rawText.length} (min: 30s / 50chars)`);

      const dbResults = {
        transcript: rawText,
        summary: '통화 시간이 짧거나 인식된 텍스트가 부족하여 AI 평가를 생략했습니다.',
        sentiment: null,
        sentiment_score: null,
        ai_score: null,
        checklist: null,
        raw_transcript: rawText,
        customer_name: null
      };
      databaseService.saveAnalysisResult(finalCallId, dbResults);

      console.log(`[Worker] Job #${job.id} complete (skipped AI, Call ID: ${finalCallId})`);
      await job.progress(100);

      return {
        callId: finalCallId,
        recordingId: recordingId || `call_${finalCallId}`,
        phoneNumber,
        sttDuration,
        transcriptLength: rawText.length,
        skipped: true,
      };
    }

    // Step 3: AI Analysis (reformat transcript + team analysis + customer name)
    console.log(`[Worker] AI analysis starting (team: ${teamName || 'default'})...`);
    const analysisResults = await ollamaService.analyzeCall(rawText, teamName, customPrompt);

    console.log(`[Worker] AI complete | summary: ${analysisResults.summary.substring(0, 80)}...`);
    console.log(`[Worker] Emotion: ${analysisResults.sentiment.sentiment} (${analysisResults.sentiment.score}/10)`);
    console.log(`[Worker] Customer name (AI): ${analysisResults.customerName || 'N/A'}`);
    await job.progress(90);

    // Step 4: Save to DB (reformatted transcript, no checklist)
    const dbResults = {
      transcript: analysisResults.transcript,
      summary: analysisResults.summary,
      sentiment: analysisResults.sentiment.sentiment,
      sentiment_score: analysisResults.sentiment.score,
      ai_score: analysisResults.sentiment.score,
      checklist: null,
      raw_transcript: rawText,
      customer_name: analysisResults.customerName || null
    };

    databaseService.saveAnalysisResult(finalCallId, dbResults);

    console.log(`[Worker] Job #${job.id} complete (Call ID: ${finalCallId})`);
    await job.progress(100);

    return {
      callId: finalCallId,
      recordingId: recordingId || `call_${finalCallId}`,
      phoneNumber,
      sttDuration,
      transcriptLength: rawText.length,
      ...analysisResults,
    };
  } catch (error) {
    console.error(`[Worker] Job #${job.id} FAILED: ${error.message}`);

    // Try to update status to failed
    try {
      const { callId, filePath, phoneNumber } = job.data;
      if (callId) {
        databaseService.updateAiStatus(callId, 'failed');
      } else {
        const allCalls = databaseService.getAllCalls();
        const match = allCalls.find(r => r[2] === phoneNumber && r[5] === filePath);
        if (match) databaseService.updateAiStatus(match[0], 'failed');
      }
    } catch (e) {
      // ignore status update failure
    }

    throw error;
  }
}

function start() {
  const queue = queueService.getQueue();
  queue.process(CONCURRENCY, processAnalysisJob);

  console.log(`[Worker] Analysis Worker started (Concurrency: ${CONCURRENCY})`);

  process.on("SIGTERM", async () => {
    console.log(`[Worker] SIGTERM - shutting down...`);
    await queue.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log(`[Worker] SIGINT - shutting down...`);
    await queue.close();
    process.exit(0);
  });
}

module.exports = { start };
