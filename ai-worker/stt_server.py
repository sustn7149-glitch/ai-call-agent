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
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # CPU 최적화 (N100 저전력 CPU용)
LANGUAGE = "ko"        # 한국어 고정 (통화 녹음 전용)
PORT = int(os.environ.get("STT_PORT", "9000"))

# ===== 한국어 콜센터 도메인 Initial Prompt =====
# Whisper에 한국어 콜센터 맥락을 제공하여 인식 정확도 향상
# - 자주 등장하는 호칭, 인사말, 업무 용어를 포함
# - 모델이 한국어 콜센터 대화 패턴을 기대하게 유도
INITIAL_PROMPT = os.environ.get("WHISPER_INITIAL_PROMPT",
    "안녕하세요 고객님. 네, 상담원입니다. "
    "요금제 변경, 해지 방어, 신규 가입, 기기 변경, 번호 이동, "
    "할부금, 위약금, 공시지원금, 선택약정, 유심, 이심, "
    "통화 품질, 데이터, 로밍, 부가서비스, 결합 할인, "
    "본인 인증, 신분증, 계좌 이체, 카드 결제."
)

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

        # faster-whisper 변환 (Phase 4: 파라미터 최적화)
        segments, info = model.transcribe(
            tmp.name,
            language=LANGUAGE,
            beam_size=5,
            best_of=3,                          # 후보 중 최선 선택 (정확도 향상)
            initial_prompt=INITIAL_PROMPT,       # 한국어 콜센터 도메인 힌트
            condition_on_previous_text=True,     # 이전 세그먼트 문맥 연결 (대화 연속성)
            vad_filter=True,                     # VAD로 무음 구간 건너뛰기
            vad_parameters=dict(
                min_silence_duration_ms=500,     # 500ms 이상 무음 구간 분리
                speech_pad_ms=200,               # 음성 전후 200ms 패딩 (끊김 방지)
            ),
            no_speech_threshold=0.6,             # 비음성 구간 필터링 임계값
            compression_ratio_threshold=2.4,     # 반복/환각 텍스트 필터링
            log_prob_threshold=-1.0,             # 저신뢰 세그먼트 필터링
        )

        # 세그먼트를 텍스트로 결합 (저신뢰 세그먼트 필터링)
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
        "initial_prompt": INITIAL_PROMPT[:50] + "...",
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
