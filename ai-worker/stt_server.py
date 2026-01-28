# ===== AI Call Agent - Whisper STT Server =====
# faster-whisper 기반 로컬 음성 인식 HTTP 서버
# Docker 불필요 - Python 직접 실행
#
# 기존 whisperService.js와 100% 호환되는 API:
#   POST /asr  (multipart: audio_file) -> { "text": "..." }
#
# 실행: python stt_server.py
# 포트: 9000 (기존 Docker Whisper와 동일)

import os
import sys
import tempfile
import time
from flask import Flask, request, jsonify

# ===== 설정 =====
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # CPU 최적화 (N100 저전력 CPU용)
LANGUAGE = "ko"        # 한국어 고정 (통화 녹음 전용)
PORT = int(os.environ.get("STT_PORT", "9000"))

app = Flask(__name__)
model = None


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
    - Input:  multipart/form-data (audio_file)
    - Output: { "text": "변환된 텍스트" }
    """
    if "audio_file" not in request.files:
        return jsonify({"error": "audio_file is required"}), 400

    audio = request.files["audio_file"]
    if not audio.filename:
        return jsonify({"error": "Empty filename"}), 400

    # 임시 파일로 저장
    suffix = os.path.splitext(audio.filename)[1] or ".m4a"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        audio.save(tmp)
        tmp.close()

        file_size_mb = os.path.getsize(tmp.name) / (1024 * 1024)
        print(f"[STT] Processing: {audio.filename} ({file_size_mb:.2f}MB)")

        start = time.time()

        # faster-whisper 변환
        segments, info = model.transcribe(
            tmp.name,
            language=LANGUAGE,
            beam_size=5,
            vad_filter=True,         # VAD로 무음 구간 건너뛰기 (속도 향상)
            vad_parameters=dict(
                min_silence_duration_ms=500,
            ),
        )

        # 세그먼트를 텍스트로 결합
        texts = []
        for segment in segments:
            texts.append(segment.text.strip())

        full_text = " ".join(texts)
        elapsed = time.time() - start

        print(f"[STT] Done: {len(full_text)} chars in {elapsed:.1f}s (lang={info.language}, prob={info.language_probability:.2f})")

        return jsonify({"text": full_text})

    except Exception as e:
        print(f"[STT] Error: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

    finally:
        # 임시 파일 정리
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@app.route("/health", methods=["GET"])
def health():
    """헬스 체크 엔드포인트"""
    return jsonify({
        "status": "ok",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    })


if __name__ == "__main__":
    load_model()
    print(f"STT Server running on 0.0.0.0:{PORT}")

    # Windows에서는 waitress 사용 (안정적)
    try:
        from waitress import serve
        serve(app, host="0.0.0.0", port=PORT, threads=2)
    except ImportError:
        print("Warning: waitress not installed, using Flask dev server")
        app.run(host="0.0.0.0", port=PORT, debug=False)
