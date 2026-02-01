#!/bin/bash
# DevClaw self-restart script
# Runs detached from the gateway process so it survives the restart
# Location: /home/pavi/dev/openclaw/scripts/dev-restart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/openclaw-dev-restart.log"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw-dev}"
SENTINEL_FILE="$STATE_DIR/restart-sentinel.json"
DEV_PID="${1:-}"
REASON="${2:-dev-restart script}"

echo "[$(date)] Starting dev restart script" > "$LOG_FILE"
echo "[$(date)] Repo: $REPO_DIR" >> "$LOG_FILE"
echo "[$(date)] State dir: $STATE_DIR" >> "$LOG_FILE"
echo "[$(date)] Target PID: $DEV_PID" >> "$LOG_FILE"
echo "[$(date)] Reason: $REASON" >> "$LOG_FILE"

# Wait for the gateway to finish sending its response
sleep 3

# Kill the old dev gateway if PID provided
if [[ -n "$DEV_PID" ]]; then
    echo "[$(date)] Killing old gateway PID $DEV_PID" >> "$LOG_FILE"
    kill "$DEV_PID" 2>/dev/null || true
    sleep 2
fi

# Build
echo "[$(date)] Building..." >> "$LOG_FILE"
cd "$REPO_DIR"
pnpm build >> "$LOG_FILE" 2>&1

# Write restart sentinel so the new gateway announces itself
TS_MS=$(($(date +%s) * 1000))
cat > "$SENTINEL_FILE" << EOF
{
  "version": 1,
  "payload": {
    "kind": "restart",
    "status": "ok",
    "ts": $TS_MS,
    "sessionKey": "agent:main:main",
    "deliveryContext": {
      "channel": "telegram"
    },
    "message": "Dev restart complete: $REASON",
    "stats": {
      "mode": "dev-restart.sh",
      "root": "$REPO_DIR"
    }
  }
}
EOF
echo "[$(date)] Wrote restart sentinel to $SENTINEL_FILE" >> "$LOG_FILE"

# Start new gateway
echo "[$(date)] Starting new gateway..." >> "$LOG_FILE"
exec pnpm openclaw --profile dev gateway --verbose >> "$LOG_FILE" 2>&1
