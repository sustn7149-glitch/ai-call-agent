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

    // Step 1: Whisper STT
    console.log(`[Worker] STT starting...`);
    const { text: transcribedText, duration: sttDuration } =
      await whisperService.transcribe(filePath);

    console.log(`[Worker] STT complete: ${transcribedText.length} chars (${sttDuration}s)`);
    await job.progress(50);

    // Step 2: AI Analysis (summary + sentiment + checklist + customer name)
    console.log(`[Worker] AI analysis starting...`);
    const analysisResults = await ollamaService.analyzeCall(transcribedText);

    console.log(`[Worker] AI complete | summary: ${analysisResults.summary.substring(0, 80)}...`);
    console.log(`[Worker] Emotion: ${analysisResults.sentiment.sentiment} (${analysisResults.sentiment.score}/10)`);
    console.log(`[Worker] Customer name (AI): ${analysisResults.customerName || 'N/A'}`);
    await job.progress(90);

    // Step 3: Save to DB
    const dbResults = {
      transcript: transcribedText,
      summary: analysisResults.summary,
      sentiment: analysisResults.sentiment.sentiment,
      sentiment_score: analysisResults.sentiment.score,
      ai_score: analysisResults.sentiment.score,
      checklist: analysisResults.checklist,
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
      transcriptLength: transcribedText.length,
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
