#!/usr/bin/env bash
# Gary Budgets publisher watchdog — alerts via Telegram if the publisher stops running.
# Runs from VM cron every 15 minutes, so it works even when the Mac is off.
# Alerts at most once per 6 hours per outage to avoid spam.
LOG=/home/ubuntu/garybudgets/logs/publish.log
STATE=/tmp/gb-watchdog-alerted
MAX_AGE_MIN=35
ENV=/home/ubuntu/garybudgets/scripts/telegram_env

[ -f "$ENV" ] && . "$ENV"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  exit 0
fi

MSG=""
if [ ! -f "$LOG" ]; then
  MSG="🚨 Gary Budgets watchdog: publish.log missing — publisher may never have run on the Oracle VM."
elif [ "$(find "$LOG" -mmin +"$MAX_AGE_MIN" 2>/dev/null | wc -l)" -gt 0 ]; then
  AGE=$(( ($(date +%s) - $(stat -c %Y "$LOG" 2>/dev/null || echo "$(date +%s)")) / 60 ))
  MSG="🚨 Gary Budgets watchdog: publisher has NOT run in ${AGE} min — cron may be down on the Oracle VM. Last log line: $(tail -1 "$LOG")"
fi

[ -z "$MSG" ] && exit 0

NOW=$(date +%s)
LAST=0
[ -f "$STATE" ] && LAST=$(cat "$STATE" 2>/dev/null || echo 0)
if [ $(( NOW - LAST )) -lt 21600 ]; then
  exit 0
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" -d "text=${MSG}" > /dev/null 2>&1
echo "$NOW" > "$STATE"
exit 0
