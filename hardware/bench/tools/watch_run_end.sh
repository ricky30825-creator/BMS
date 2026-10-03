#!/bin/bash
# watch_run_end.sh — run 자동 종료 처리.  사용: nohup bash ~/watch_run_end.sh 45 &
#
#   ① ina_log 가 스스로 끝날 때까지 기다린다 (--stop-v 컷오프 / --max-a 초과)
#   ② 그 즉시 CH3(마스터)를 연다
#        안 열면 팩이 컷오프 뒤에도 깼다 잠들었다를 반복하며 간헐 발열을 만들고,
#        그게 냉각 꼬리를 오염시킨다. 꼬리 진폭이 1차 발열 지표다.
#   ③ 꼬리를 N분 더 기록한다 (기본 45분. 20분 미만이면 그 run 은 발열값을 못 쓴다)
#   ④ 로거를 정리한다
#
# pkill -f 를 쓰지 않는다 — 그 문자열이 자기 명령줄에도 있어서 자기 자신을 죽인다.
# CLAUDE.md 「도구 사용 시 주의」 참조. 대신 [i]na 꼴의 대괄호 트릭을 쓴다.
set -u
TAIL_MIN=${1:-45}
PREFIX=${2:-RUN}          # 종료 후 행수를 찍을 파일 접두
LOG=~/run_end.log

say() { echo "$(date -Is)  $*" >> "$LOG"; }

say "=== 감시 시작 — ina_log 종료 대기 (꼬리 ${TAIL_MIN}분, 접두 ${PREFIX}) ==="

while pgrep -f "[i]na_log.py" > /dev/null; do
    sleep 10
done

say "ina_log 종료 감지 — CH3 를 연다"
pinctrl set 13 op dh
sleep 1
say "CH3 상태: $(pinctrl get 13)"
say "INA 마지막: $(tail -2 ~/ina_logger.out | tr '\n' ' ')"

say "냉각 꼬리 ${TAIL_MIN}분 기록 시작"
sleep $(( TAIL_MIN * 60 ))

say "꼬리 종료 — 로거 정리"
pgrep -f "[m]lx_fast_log"     | xargs -r kill
pgrep -f "[t]hermal_log_alarm" | xargs -r kill
pgrep -f "[t]empguard"         | xargs -r kill
sleep 2

say "남은 프로세스: $(pgrep -af python3 | tr '\n' ' ')"
say "파일:"
for f in ~/${PREFIX}_*.csv; do
    say "   $(wc -l < "$f") 행  $f"
done
say "=== 완료 ==="
