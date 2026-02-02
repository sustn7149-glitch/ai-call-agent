// ===== AI Call Agent - Queue Service =====
// 작성: Ollama (qwen2.5-coder:7b) | 검수: Claude CTO
// 목적: Bull Queue를 사용한 분석 작업 대기열 관리
//
// 왜 Queue 시스템이 필요한가?
// - N100 서버의 제한된 리소스로 동시에 여러 분석 작업 처리 불가
// - 녹취 파일이 한꺼번에 들어와도 순차적으로 안정적 처리
// - 실패한 작업 자동 재시도로 데이터 손실 방지

const Queue = require("bull");
const Redis = require("ioredis");

// ===== 환경 변수 로드 =====
// 왜 환경 변수를 사용하는가?
// - Docker 환경과 로컬 환경에서 다른 Redis 주소 사용 가능
// - 보안상 민감한 정보를 코드에 하드코딩하지 않음
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// ===== 큐 이름 상수 =====
// 왜 상수로 분리하는가?
// - 여러 곳에서 동일한 큐 이름 사용 보장
// - 오타로 인한 버그 방지
const QUEUE_NAMES = {
  ANALYSIS: "call-analysis-queue", // 통화 녹취 분석 작업
  NOTIFICATION: "notification-queue", // 알림 발송 작업 (향후 확장)
};

// ===== Redis 클라이언트 생성 =====
// 왜 별도 클라이언트를 생성하는가?
// - Bull Queue 내부에서 사용하는 것과 별개로 상태 조회에 활용
// - 연결 상태 모니터링 가능
const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null, // Bull Queue 권장 설정
  enableReadyCheck: false,
});

// Redis 연결 이벤트 로깅
redisClient.on("connect", () => {
  console.log("📡 [Queue] Redis 연결 성공");
});

redisClient.on("error", (err) => {
  console.error("❌ [Queue] Redis 연결 오류:", err.message);
});

/**
 * @class QueueService
 * @description Bull Queue 기반 분석 작업 관리 서비스
 *
 * 왜 클래스로 구현하는가?
 * - 상태(큐 인스턴스, Socket.io)를 캡슐화
 * - 싱글톤 패턴으로 앱 전체에서 하나의 인스턴스만 사용
 * - 메서드 체이닝 및 확장 용이
 */
class QueueService {
  constructor() {
    // 싱글톤 패턴: 이미 인스턴스가 있으면 재사용
    if (QueueService.instance) {
      return QueueService.instance;
    }

    // ===== Bull Queue 인스턴스 생성 =====
    // 왜 createClient 옵션을 사용하는가?
    // - subscriber/client/bclient 각각 별도 연결 필요 (Bull 권장)
    // - 하나의 연결만 사용하면 블로킹 이슈 발생 가능
    this.analysisQueue = new Queue(QUEUE_NAMES.ANALYSIS, {
      createClient: (type) => {
        switch (type) {
          case "client":
            return redisClient;
          case "subscriber":
            return redisClient.duplicate();
          case "bclient":
            return redisClient.duplicate();
          default:
            return redisClient;
        }
      },
      settings: {
        // N100 CPU + Whisper medium 모델: 대용량 녹음파일 STT가 20분+ 소요 가능
        lockDuration: 1500000,      // 25분 (STT 20분 + Claude AI 5분 여유)
        stalledInterval: 1500000,   // 25분마다 stall 체크
        lockRenewTime: 720000,      // 12분마다 lock 자동 갱신
      },
    });

    // Socket.io 인스턴스 (나중에 주입)
    this.io = null;

    // 이벤트 리스너 등록
    this._setupEventListeners();

    // 싱글톤 인스턴스 저장
    QueueService.instance = this;
  }

  // ===== Socket.io 인스턴스 주입 =====
  /**
   * @method setSocketIO
   * @description Socket.io 인스턴스를 주입하여 실시간 이벤트 전송 활성화
   * @param {Object} io - Socket.io 서버 인스턴스
   *
   * 왜 별도 메서드로 주입하는가?
   * - QueueService가 먼저 생성되고, Socket.io는 나중에 초기화될 수 있음
   * - 의존성 주입 패턴으로 결합도 낮춤
   */
  setSocketIO(io) {
    this.io = io;
    console.log("🔌 [Queue] Socket.io 연동 완료");
  }

  // ===== 분석 작업 추가 =====
  /**
   * @method addAnalysisJob
   * @description 새로운 통화 녹취 분석 작업을 큐에 추가
   * @param {Object} jobData - 작업 데이터
   * @param {string} jobData.recordingId - 녹취 파일 고유 ID
   * @param {string} jobData.filePath - 녹취 파일 경로
   * @param {string} jobData.phoneNumber - 통화 상대방 전화번호
   * @param {string} jobData.agentId - 상담원 ID
   * @param {number} jobData.callDuration - 통화 시간 (초)
   * @param {Date} jobData.timestamp - 통화 시작 시간
   * @returns {Promise<Object>} 생성된 Job 객체
   *
   * 왜 이 데이터가 필요한가?
   * - recordingId: DB 업데이트 시 식별자로 사용
   * - filePath: Whisper가 파일을 읽어 STT 수행
   * - phoneNumber: 고객 식별 및 통계
   * - agentId: 상담원별 성과 분석
   * - callDuration: 분석 우선순위 결정에 활용 가능
   */
  async addAnalysisJob(jobData) {
    const { recordingId, filePath, phoneNumber, agentId, callDuration, timestamp } = jobData;

    // ===== 작업 옵션 설정 =====
    const jobOptions = {
      // 실패 시 최대 2번 재시도
      // whisperService 내부 재시도 제거 → Bull만 재시도 담당 (증폭 방지)
      attempts: 2,

      // 지수 백오프: 30초 → 60초 간격으로 재시도
      // STT 서버 복구 시간 확보 (짧은 간격은 과부하 악화)
      backoff: {
        type: "exponential",
        delay: 30000,
      },

      // 완료된 작업은 100개만 유지
      // 왜 유지하는가? - 최근 작업 이력 조회 가능
      // 왜 100개인가? - Redis 메모리 절약 (N100 제한)
      removeOnComplete: 100,

      // 실패한 작업은 50개만 유지
      // 왜 유지하는가? - 수동 재시도 및 디버깅용
      removeOnFail: 50,
    };

    const job = await this.analysisQueue.add(
      {
        recordingId,
        filePath,
        phoneNumber,
        agentId,
        callDuration,
        timestamp: timestamp || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      jobOptions
    );

    console.log(`📝 [Queue] 분석 작업 추가: Job #${job.id} (Recording: ${recordingId})`);

    // 실시간 대시보드에 새 작업 알림
    if (this.io) {
      this.io.emit("queue:job-added", {
        jobId: job.id,
        recordingId,
        agentId,
      });
    }

    return job;
  }

  // ===== 작업 상태 조회 =====
  /**
   * @method getJobStatus
   * @description 특정 작업의 현재 상태 조회
   * @param {string} jobId - 작업 ID
   * @returns {Promise<Object|null>} 작업 상태 정보 또는 null
   *
   * 반환 데이터:
   * - id: 작업 ID
   * - data: 원본 작업 데이터
   * - progress: 진행률 (0-100)
   * - state: 상태 (waiting, active, completed, failed, delayed)
   * - attemptsMade: 시도 횟수
   * - failedReason: 실패 사유 (실패 시)
   */
  async getJobStatus(jobId) {
    const job = await this.analysisQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();

    return {
      id: job.id,
      data: job.data,
      progress: job.progress(),
      state,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || null,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  // ===== 큐 통계 조회 =====
  /**
   * @method getQueueStats
   * @description 큐의 전체 상태 통계 조회
   * @returns {Promise<Object>} 큐 통계 정보
   *
   * 왜 이 통계가 필요한가?
   * - 대시보드에서 시스템 상태 모니터링
   * - 대기 작업이 많으면 알림 발송
   * - 실패율 높으면 문제 감지
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.analysisQueue.getWaitingCount(),
      this.analysisQueue.getActiveCount(),
      this.analysisQueue.getCompletedCount(),
      this.analysisQueue.getFailedCount(),
      this.analysisQueue.getDelayedCount(),
    ]);

    return {
      waiting, // 대기 중인 작업 수
      active, // 현재 처리 중인 작업 수
      completed, // 완료된 작업 수
      failed, // 실패한 작업 수
      delayed, // 지연된 작업 수 (재시도 대기)
      total: waiting + active + delayed,
    };
  }

  // ===== 최근 작업 목록 조회 =====
  /**
   * @method getRecentJobs
   * @description 최근 작업 목록 조회 (상태별)
   * @param {string} status - 작업 상태 ('waiting', 'active', 'completed', 'failed')
   * @param {number} limit - 조회할 작업 수 (기본 10개)
   * @returns {Promise<Array>} 작업 목록
   */
  async getRecentJobs(status = "completed", limit = 10) {
    const jobs = await this.analysisQueue.getJobs([status], 0, limit - 1);

    return jobs.map((job) => ({
      id: job.id,
      data: job.data,
      progress: job.progress(),
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));
  }

  // ===== 실패한 작업 재시도 =====
  /**
   * @method retryFailedJobs
   * @description 실패한 모든 작업을 재시도
   * @returns {Promise<number>} 재시도된 작업 수
   *
   * 왜 수동 재시도 기능이 필요한가?
   * - 자동 재시도 횟수를 초과한 작업 복구
   * - 외부 서비스(Whisper, Ollama) 복구 후 일괄 재처리
   */
  async retryFailedJobs() {
    const failedJobs = await this.analysisQueue.getJobs(["failed"]);
    let retriedCount = 0;

    for (const job of failedJobs) {
      await job.retry();
      retriedCount++;
      console.log(`🔄 [Queue] 작업 재시도: Job #${job.id}`);
    }

    console.log(`✅ [Queue] 총 ${retriedCount}개 작업 재시도 완료`);
    return retriedCount;
  }

  // ===== 특정 작업 재시도 =====
  /**
   * @method retryJob
   * @description 특정 작업을 재시도
   * @param {string} jobId - 작업 ID
   * @returns {Promise<boolean>} 성공 여부
   */
  async retryJob(jobId) {
    const job = await this.analysisQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    await job.retry();
    console.log(`🔄 [Queue] 작업 재시도: Job #${jobId}`);
    return true;
  }

  // ===== 이벤트 리스너 설정 =====
  /**
   * @method _setupEventListeners
   * @private
   * @description 큐 이벤트 리스너 등록
   *
   * 왜 이벤트 리스너가 필요한가?
   * - 작업 상태 변화를 실시간으로 대시보드에 전달
   * - 로깅 및 모니터링
   * - 실패 시 알림 발송 (향후 확장)
   */
  _setupEventListeners() {
    // 작업 완료 이벤트
    this.analysisQueue.on("completed", (job, result) => {
      console.log(`✅ [Queue] 작업 완료: Job #${job.id}`);

      if (this.io) {
        this.io.emit("queue:job-completed", {
          jobId: job.id,
          recordingId: job.data.recordingId,
          result,
        });
      }
    });

    // 작업 실패 이벤트
    this.analysisQueue.on("failed", (job, err) => {
      console.error(`❌ [Queue] 작업 실패: Job #${job.id} (시도 ${job.attemptsMade}/${job.opts.attempts})`, err.message);

      // 모든 Bull 재시도 소진 → 영구 실패 마킹 (worker에서 못 처리한 경우 안전장치)
      if (job.attemptsMade >= job.opts.attempts && job.data.callId) {
        try {
          const databaseService = require("./databaseService");
          databaseService.markAnalysisFailed(job.data.callId, err.message);
          console.log(`🔒 [Queue] Job #${job.id} 영구 실패 마킹 완료 (재큐잉 방지)`);
        } catch (e) {
          console.error(`[Queue] markAnalysisFailed 실패:`, e.message);
        }
      }

      if (this.io) {
        this.io.emit("queue:job-failed", {
          jobId: job.id,
          recordingId: job.data.recordingId,
          error: err.message,
          attemptsMade: job.attemptsMade,
        });
      }
    });

    // 작업 진행률 업데이트 이벤트
    this.analysisQueue.on("progress", (job, progress) => {
      console.log(`📊 [Queue] 작업 진행: Job #${job.id} - ${progress}%`);

      if (this.io) {
        this.io.emit("queue:job-progress", {
          jobId: job.id,
          recordingId: job.data.recordingId,
          progress,
        });
      }
    });

    // 작업 시작 이벤트
    this.analysisQueue.on("active", (job) => {
      console.log(`🚀 [Queue] 작업 시작: Job #${job.id}`);

      if (this.io) {
        this.io.emit("queue:job-active", {
          jobId: job.id,
          recordingId: job.data.recordingId,
        });
      }
    });

    console.log("👂 [Queue] 이벤트 리스너 등록 완료");
  }

  // ===== 큐 정리 =====
  /**
   * @method cleanQueue
   * @description 오래된 완료/실패 작업 정리
   * @param {number} gracePeriod - 유지 기간 (밀리초, 기본 24시간)
   * @returns {Promise<void>}
   */
  async cleanQueue(gracePeriod = 24 * 60 * 60 * 1000) {
    await this.analysisQueue.clean(gracePeriod, "completed");
    await this.analysisQueue.clean(gracePeriod, "failed");
    console.log(`🧹 [Queue] 큐 정리 완료 (${gracePeriod / 1000 / 60 / 60}시간 이전 작업 삭제)`);
  }

  // ===== 큐 인스턴스 반환 (Worker용) =====
  /**
   * @method getQueue
   * @description Bull Queue 인스턴스 반환 (Worker에서 process 등록용)
   * @returns {Queue} Bull Queue 인스턴스
   */
  getQueue() {
    return this.analysisQueue;
  }
}

// ===== 싱글톤 인스턴스 내보내기 =====
// 왜 싱글톤인가?
// - 앱 전체에서 하나의 Queue 인스턴스만 사용
// - 중복 연결 방지, 이벤트 리스너 중복 등록 방지
module.exports = new QueueService();
