#!/bin/bash
# ===== Auto Deploy 크론잡 설정 =====
# N100 서버에서 한 번만 실행하면 됩니다

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/auto-deploy.sh"

echo "=== AI Call Agent Auto Deploy Setup ==="
echo "Project: $PROJECT_DIR"
echo "Script:  $DEPLOY_SCRIPT"
echo ""

# 실행 권한 부여
chmod +x "$DEPLOY_SCRIPT"

# 로그 파일 초기화
touch "$SCRIPT_DIR/deploy.log"

# 크론잡 등록 (기존 항목 중복 방지)
CRON_ENTRY="* * * * * cd $PROJECT_DIR && $DEPLOY_SCRIPT"

if crontab -l 2>/dev/null | grep -q "auto-deploy.sh"; then
  echo "[!] Cron job already exists. Updating..."
  crontab -l 2>/dev/null | grep -v "auto-deploy.sh" | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "[OK] Cron job registered (runs every 1 minute)"
echo ""
echo "=== Verify ==="
crontab -l | grep auto-deploy
echo ""
echo "=== Commands ==="
echo "View logs:    tail -f $SCRIPT_DIR/deploy.log"
echo "Remove cron:  crontab -l | grep -v auto-deploy | crontab -"
echo ""
echo "Setup complete!"
