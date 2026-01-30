const queueService = require("../services/queueService");
const whisperService = require("../services/whisperService");
const ollamaService = require("../services/ollamaService");
const aiCliService = require("../services/aiCliService");
const databaseService = require("../services/databaseService");

// AI Provider 선택: claude | gemini | codex → aiCliService, ollama → ollamaService
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const aiService = (AI_PROVIDER === 'ollama') ? ollamaService : aiCliService;

const CONCURRENCY = 1;

// Minimum thresholds for AI evaluation
const MIN_DURATION_SECONDS = 30;
const MIN_TRANSCRIPT_LENGTH = 50;

async function processAnalysisJob(job) {
  try {
    const { filePath, fileName, phoneNumber, callId, recordingId } = job.data;

    console.log(`[Worker] Job #${job.id} started: ${fileName || filePath} (${phoneNumber})`);
    await job.progress(10);

    if (!filePath) throw new Error("파일 경로가 제공되지 않았습니다.");

    // Find call ID
    let finalCallId = callId;
    let callDuration = 0;
    let uploaderPhone = null;
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
        callDuration = matchingCall[6] || 0;
        uploaderPhone = matchingCall[10] || null; // uploader_phone index
      } else {
        throw new Error(`통화 기록을 찾을 수 없습니다: ${phoneNumber} / ${filePath}`);
      }
    } else {
      const callData = databaseService.getCallWithAnalysis(finalCallId);
      if (callData) {
        callDuration = callData.duration || 0;
        uploaderPhone = callData.uploader_phone || null;
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

    // ===== Check minimum thresholds for AI evaluation =====
    const durationTooShort = callDuration < MIN_DURATION_SECONDS;
    const textTooShort = transcribedText.length < MIN_TRANSCRIPT_LENGTH;
    const skipAiEvaluation = durationTooShort || textTooShort;

    if (skipAiEvaluation) {
      console.log(`[Worker] Skipping AI evaluation: duration=${callDuration}s (min ${MIN_DURATION_SECONDS}s), text=${transcribedText.length} chars (min ${MIN_TRANSCRIPT_LENGTH})`);

      const dbResults = {
        transcript: transcribedText,
        raw_transcript: transcribedText,
        summary: durationTooShort ? '30초 미만 평가생략' : 'STT 50자 미만 평가생략',
        sentiment: null,
        sentiment_score: null,
        ai_score: null,
        customer_name: null,
        outcome: null
      };

      databaseService.saveAnalysisResult(finalCallId, dbResults);

      console.log(`[Worker] Job #${job.id} complete (skipped evaluation, Call ID: ${finalCallId})`);
      await job.progress(100);

      return {
        callId: finalCallId,
        recordingId: recordingId || `call_${finalCallId}`,
        phoneNumber,
        sttDuration,
        transcriptLength: transcribedText.length,
        skipped: true,
        skipReason: durationTooShort ? 'duration_too_short' : 'text_too_short'
      };
    }

    // Step 2: Look up team-specific evaluation prompt
    let teamPrompt = null;
    let teamName = null;
    if (uploaderPhone) {
      const teamId = databaseService.getAgentTeamId(uploaderPhone);
      if (teamId) {
        teamPrompt = databaseService.getTeamEvaluationPrompt(teamId);
        const teamData = databaseService.getTeamById(teamId);
        teamName = teamData ? teamData.name : null;
      }
      if (!teamName) {
        teamName = databaseService.getAgentTeam(uploaderPhone);
      }
    }

    console.log(`[Worker] AI analysis starting... (team: ${teamName || 'N/A'}, custom prompt: ${teamPrompt ? 'YES' : 'NO'})`);

    // Step 3: AI Analysis (conversation format + summary + sentiment + customer name + outcome)
    const analysisResults = await aiService.analyzeCall(transcribedText, teamPrompt, teamName);

    console.log(`[Worker] AI complete | summary: ${analysisResults.summary.substring(0, 80)}...`);
    console.log(`[Worker] Emotion: ${analysisResults.sentiment.sentiment} (${analysisResults.sentiment.score}/10)`);
    console.log(`[Worker] Customer name (AI): ${analysisResults.customerName || 'N/A'}`);
    console.log(`[Worker] Outcome: ${analysisResults.outcome || 'N/A'}`);
    await job.progress(90);

    // Step 4: Save to DB
    // Use formatted conversation text as transcript (with speaker labels)
    const dbResults = {
      transcript: analysisResults.formattedText || transcribedText,
      raw_transcript: transcribedText,
      summary: analysisResults.summary,
      sentiment: analysisResults.sentiment.sentiment,
      sentiment_score: analysisResults.sentiment.score,
      ai_score: analysisResults.sentiment.score,
      customer_name: analysisResults.customerName || null,
      outcome: analysisResults.outcome || null
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

  console.log(`[Worker] Analysis Worker started (Concurrency: ${CONCURRENCY}, AI Provider: ${AI_PROVIDER})`);

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
