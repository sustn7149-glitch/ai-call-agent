#!/bin/bash
# ===== AI Call Agent - Auto Deploy Script =====
# GitHub에서 변경 감지 → 자동 pull & rebuild
# cron으로 1분마다 실행

set -e

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_FILE="${PROJECT_DIR}/deploy/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

cd "$PROJECT_DIR"

# Git fetch (remote 변경사항만 확인)
git fetch origin "$BRANCH" --quiet 2>/dev/null || { log "ERROR: git fetch failed"; exit 1; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

# 변경 없으면 종료
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Change detected: $LOCAL -> $REMOTE"
log "Pulling changes..."

# Pull
git pull origin "$BRANCH" --quiet
log "Git pull completed"

# 변경된 파일 확인
CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")
log "Changed files: $CHANGED_FILES"

# Dashboard 변경 감지 → backend 컨테이너 리빌드 (멀티스테이지 빌드에 포함)
if echo "$CHANGED_FILES" | grep -q "^dashboard/"; then
  log "Dashboard changed - rebuilding backend container (includes dashboard build)..."
  cd "$PROJECT_DIR"
  docker compose up -d --build backend >> "$LOG_FILE" 2>&1
  log "Dashboard + Backend rebuild completed"
fi

# Backend 변경 감지 → 컨테이너 리빌드
if echo "$CHANGED_FILES" | grep -q "^backend/"; then
  log "Backend changed - rebuilding container..."
  cd "$PROJECT_DIR"
  docker compose up -d --build backend >> "$LOG_FILE" 2>&1
  log "Backend rebuild completed"
fi

# AI Worker 변경 감지 → STT 컨테이너 리빌드
if echo "$CHANGED_FILES" | grep -q "^ai-worker/"; then
  log "AI Worker changed - rebuilding container..."
  cd "$PROJECT_DIR"
  docker compose up -d --build stt-server >> "$LOG_FILE" 2>&1
  log "STT server rebuild completed"
fi

# docker-compose.yml 변경 → 전체 재시작
if echo "$CHANGED_FILES" | grep -q "^docker-compose.yml"; then
  log "docker-compose.yml changed - restarting all..."
  cd "$PROJECT_DIR"
  docker compose up -d --build >> "$LOG_FILE" 2>&1
  log "Full rebuild completed"
fi

log "Deploy finished: $(git rev-parse --short HEAD)"
