#!/usr/bin/env bash
# Build the web target. Wraps `expo export --platform web` to force-exit
# once "Exported: dist" appears in stdout — under `output: "static"`,
# Metro keeps the worker pool alive after rendering completes and the
# process never naturally exits, which would hang Netlify (or any CI)
# until its build timeout fires. See expo/expo#28000.
set -euo pipefail

LOG=$(mktemp /tmp/expo-build.XXXXXX.log)
trap 'rm -f "$LOG"' EXIT

npx expo export --platform web 2>&1 | tee "$LOG" &
PIPE_PID=$!

# Poll the log; once the success marker appears, kill the whole pipeline
# (including the lingering Metro workers) and report success.
while kill -0 $PIPE_PID 2>/dev/null; do
  if grep -q '^Exported: dist' "$LOG"; then
    # Find every expo/metro child process under this shell and end them.
    pkill -P $$ -f "expo export"  2>/dev/null || true
    pkill -P $$ -f "metro"        2>/dev/null || true
    pkill        -f "expo export" 2>/dev/null || true
    wait $PIPE_PID 2>/dev/null || true
    echo "[build-web] export complete, forced exit"
    exit 0
  fi
  sleep 2
done

# Pipeline exited on its own — propagate its status.
wait $PIPE_PID
