#!/bin/bash
# Wait for a logger PID to exit, then write a marker. Survives SSH loss.
# usage: nohup bash ~/watch_run.sh <PID> <marker> </dev/null >/dev/null 2>&1 &
PID=$1
MARK=$2
while kill -0 "$PID" 2>/dev/null; do sleep 30; done
date "+%Y-%m-%d %H:%M:%S  run ended" > "$MARK"
tail -15 ~/ina_logger.out >> "$MARK"
