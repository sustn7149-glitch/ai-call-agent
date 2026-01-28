// ===== Queue API Routes =====
// 작성: Claude CTO
// 목적: 분석 큐 상태 조회 및 관리 API

const express = require("express");
const router = express.Router();
const queueService = require("../services/queueService");

// ===== 큐 통계 조회 =====
/**
 * @route GET /api/queue/stats
 * @description 큐의 전체 상태 통계 조회
 * @returns {Object} { waiting, active, completed, failed, delayed, total }
 *
 * 사용처: 대시보드 상단의 큐 상태 표시
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await queueService.getQueueStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("[Queue API] 통계 조회 실패:", error);
    res.status(500).json({
      success: false,
      error: "큐 통계 조회 중 오류가 발생했습니다.",
    });
  }
});

// ===== 특정 작업 상태 조회 =====
/**
 * @route GET /api/queue/jobs/:jobId
 * @description 특정 작업의 상태 조회
 * @param {string} jobId - 작업 ID
 * @returns {Object} 작업 상태 정보
 */
router.get("/jobs/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await queueService.getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: "작업을 찾을 수 없습니다.",
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("[Queue API] 작업 조회 실패:", error);
    res.status(500).json({
      success: false,
      error: "작업 조회 중 오류가 발생했습니다.",
    });
  }
});

// ===== 최근 작업 목록 조회 =====
/**
 * @route GET /api/queue/jobs
 * @description 최근 작업 목록 조회
 * @query {string} status - 작업 상태 (waiting, active, completed, failed)
 * @query {number} limit - 조회 개수 (기본 10)
 * @returns {Array} 작업 목록
 */
router.get("/jobs", async (req, res) => {
  try {
    const { status = "completed", limit = 10 } = req.query;
    const jobs = await queueService.getRecentJobs(status, parseInt(limit));

    res.json({
      success: true,
      data: jobs,
    });
  } catch (error) {
    console.error("[Queue API] 작업 목록 조회 실패:", error);
    res.status(500).json({
      success: false,
      error: "작업 목록 조회 중 오류가 발생했습니다.",
    });
  }
});

// ===== 실패한 작업 전체 재시도 =====
/**
 * @route POST /api/queue/retry-all
 * @description 실패한 모든 작업 재시도
 * @returns {Object} { retriedCount }
 */
router.post("/retry-all", async (req, res) => {
  try {
    const retriedCount = await queueService.retryFailedJobs();

    res.json({
      success: true,
      data: { retriedCount },
      message: `${retriedCount}개의 작업이 재시도되었습니다.`,
    });
  } catch (error) {
    console.error("[Queue API] 전체 재시도 실패:", error);
    res.status(500).json({
      success: false,
      error: "작업 재시도 중 오류가 발생했습니다.",
    });
  }
});

// ===== 특정 작업 재시도 =====
/**
 * @route POST /api/queue/jobs/:jobId/retry
 * @description 특정 작업 재시도
 * @param {string} jobId - 작업 ID
 */
router.post("/jobs/:jobId/retry", async (req, res) => {
  try {
    const { jobId } = req.params;
    const success = await queueService.retryJob(jobId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: "작업을 찾을 수 없습니다.",
      });
    }

    res.json({
      success: true,
      message: `작업 #${jobId}이 재시도되었습니다.`,
    });
  } catch (error) {
    console.error("[Queue API] 작업 재시도 실패:", error);
    res.status(500).json({
      success: false,
      error: "작업 재시도 중 오류가 발생했습니다.",
    });
  }
});

// ===== 큐 정리 =====
/**
 * @route POST /api/queue/clean
 * @description 오래된 완료/실패 작업 정리
 * @body {number} hours - 유지 기간 (시간, 기본 24)
 */
router.post("/clean", async (req, res) => {
  try {
    const { hours = 24 } = req.body;
    const gracePeriod = hours * 60 * 60 * 1000;

    await queueService.cleanQueue(gracePeriod);

    res.json({
      success: true,
      message: `${hours}시간 이전의 완료/실패 작업이 정리되었습니다.`,
    });
  } catch (error) {
    console.error("[Queue API] 큐 정리 실패:", error);
    res.status(500).json({
      success: false,
      error: "큐 정리 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
