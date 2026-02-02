# ===== AI Call Agent - Whisper STT Server =====
# faster-whisper 기반 로컬 음성 인식 HTTP 서버
#
# 기존 whisperService.js와 100% 호환되는 API:
#   POST /asr  (multipart: audio_file) -> { "text": "..." }
#   GET /health -> { "status": "ok"|"busy", "is_busy": bool, ... }
#
# 과부하 방지:
#   - threading.Lock으로 동시 처리 차단 (1건씩만 처리)
#   - 처리 중 요청 시 503 반환
#   - Waitress threads=1 (단일 스레드)
#
# 실행: python stt_server.py
# 포트: 9000

import os
import sys
import tempfile
import time
import threading
from flask import Flask, request, jsonify

# ===== 설정 =====
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # CPU 최적화 (N100 저전력 CPU용)
LANGUAGE = "ko"        # 한국어 고정 (통화 녹음 전용)
PORT = int(os.environ.get("STT_PORT", "9000"))

# ===== 한국어 콜센터 도메인 Initial Prompt =====
INITIAL_PROMPT = os.environ.get("WHISPER_INITIAL_PROMPT",
    "안녕하세요 고객님. 네, 상담원입니다. "
    "요금제 변경, 해지 방어, 신규 가입, 기기 변경, 번호 이동, "
    "할부금, 위약금, 공시지원금, 선택약정, 유심, 이심, "
    "통화 품질, 데이터, 로밍, 부가서비스, 결합 할인, "
    "본인 인증, 신분증, 계좌 이체, 카드 결제."
)

app = Flask(__name__)
model = None
processing_lock = threading.Lock()  # STT 동시 처리 방지 (thread-safe)


def load_model():
    """Whisper 모델 로드 (서버 시작 시 1회)"""
    global model
    print(f"Loading faster-whisper model: {MODEL_SIZE} (device={DEVICE}, compute={COMPUTE_TYPE})")
    start = time.time()

    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE,
                         cpu_threads=os.cpu_count() or 4)

    elapsed = time.time() - start
    print(f"Model loaded in {elapsed:.1f}s")


@app.route("/asr", methods=["POST"])
def asr():
    """
    음성 파일을 텍스트로 변환하는 API 엔드포인트
    - Lock 획득 실패 시 503 반환 (동시 요청 차단)
    """
    # Lock으로 동시 처리 방지 (thread-safe, TOCTOU 방지)
    if not processing_lock.acquire(blocking=False):
        return jsonify({"error": "STT server is busy processing another file"}), 503

    tmp_path = None
    try:
        if "audio_file" not in request.files:
            return jsonify({"error": "audio_file is required"}), 400

        audio = request.files["audio_file"]
        if not audio.filename:
            return jsonify({"error": "Empty filename"}), 400

        # 임시 파일로 저장
        suffix = os.path.splitext(audio.filename)[1] or ".m4a"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp_path = tmp.name
        audio.save(tmp)
        tmp.close()

        file_size_mb = os.path.getsize(tmp_path) / (1024 * 1024)
        print(f"[STT] Processing: {audio.filename} ({file_size_mb:.2f}MB)")

        start = time.time()

        # faster-whisper 변환
        segments, info = model.transcribe(
            tmp_path,
            language=LANGUAGE,
            beam_size=5,
            best_of=3,
            initial_prompt=INITIAL_PROMPT,
            condition_on_previous_text=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
        )

        # 세그먼트를 텍스트로 결합
        texts = []
        segment_count = 0
        for segment in segments:
            text = segment.text.strip()
            if text:
                texts.append(text)
                segment_count += 1

        full_text = " ".join(texts)
        elapsed = time.time() - start

        print(f"[STT] Done: {len(full_text)} chars, {segment_count} segments in {elapsed:.1f}s "
              f"(lang={info.language}, prob={info.language_probability:.2f})")

        return jsonify({
            "text": full_text,
            "segments": segment_count,
            "language_probability": round(info.language_probability, 3),
            "duration_seconds": round(elapsed, 2),
        })

    except Exception as e:
        print(f"[STT] Error: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

    finally:
        processing_lock.release()
        # 임시 파일 정리
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.route("/health", methods=["GET"])
def health():
    """헬스 체크 + busy 상태 보고 엔드포인트
    - Docker healthcheck: HTTP 200이면 healthy (busy 여부 무관)
    - whisperService: is_busy 필드로 요청 전 busy 상태 확인
    """
    is_busy = processing_lock.locked()
    return jsonify({
        "status": "busy" if is_busy else "ok",
        "is_busy": is_busy,
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "initial_prompt": INITIAL_PROMPT[:50] + "...",
    })


if __name__ == "__main__":
    load_model()
    print(f"STT Server running on 0.0.0.0:{PORT}")

    try:
        from waitress import serve
        serve(app, host="0.0.0.0", port=PORT, threads=1)
    except ImportError:
        print("Warning: waitress not installed, using Flask dev server")
        app.run(host="0.0.0.0", port=PORT, debug=False)
