#!/bin/bash
# heat_run.sh — 가열 실험(헤어드라이어 등) run 을 한 스크립트로 묶는다.  파이에서 실행.
#
#   bash ~/heat_run.sh help
#
# 프로브 배치 (한 run 에 DS18B20 두 개를 동시에 쓴다):
#   가까운 프로브(NEAR)  배터리 옆 공중, 배터리에 닿지 않게, MLX 시야 밖   -> CSV 의 ds18b20_c 열
#   먼 프로브(FAR)       배터리에서 10cm 이상, 드라이어 바람 밖            -> CSV 의 ds_ambient_c 열 + Kafka temp_ambient
#
# ⚠ 이 run 은 6채널 학습에 쓰지 말 것: ds18b20_c 가 배터리 접촉 온도가 아니라 '근처 공기'다.
#    preprocess 가 그 열을 cell_temp_c 로 읽는다. 접두에 _heat 를 붙여 구분한다.
# ⚠ tempguard 는 부하 릴레이만 연다. 열원(드라이어)은 사람이 끈다.
#
# pkill -f 를 쓰지 않는다 (자기 명령줄에도 걸려 SSH 를 죽인다). [x] 대괄호 트릭을 쓴다.
set -u

STATE=~/.heat_run.state
BK=~/.heat_run_backup
PATCHED="thermal_log_alarm.py tempguard.py preflight.py sensorwatch.py sensors_kafka.py"

SETTLE_MIN=${SETTLE_MIN:-20}   # IR 로거 정착 최소 분
TAIL_MIN=${TAIL_MIN:-30}       # 부하 차단 후 냉각 꼬리 분
IR_STOP=${IR_STOP:-50}         # 자동 차단 IR 문턱 (평소 60 — 이 실험은 낮춘다)
DS_STOP=${DS_STOP:-50}         # 가까운 프로브 문턱
WARN_C=${WARN_C:-45}           # watch 가 경고를 울리는 표면 온도
BROKER=${BROKER:-}             # 예: BROKER=<PC_IP>:19092  (비우면 Kafka 송신 안 함)
DRY=${DRY:-0}

say() { echo "[heat_run] $*"; }
die() { echo "[heat_run] !! $*" >&2; exit 1; }

save_state() { printf 'PREFIX=%s\nAMPS=%s\nIR_T0=%s\nGO_T0=%s\n' "$PREFIX" "$AMPS" "${IR_T0:-0}" "${GO_T0:-0}" > "$STATE"; }
load_state() { [ -f "$STATE" ] || return 1; . "$STATE"; [ -n "${PREFIX:-}" ]; }

mark() {  # 사건 기록: 라벨을 붙일 때의 근거가 된다
    load_state || die "start 를 먼저 실행하세요"
    local f=~/${PREFIX}_events.csv
    [ -f "$f" ] || echo "timestamp,label" > "$f"
    echo "$(date -Is),$1" >> "$f"
    say "기록: $1  ($(date +%T))"
}

# ── help ─────────────────────────────────────────────────────────────
cmd_help() { cat <<'EOF'
순서 (파이에서)
  1  bash ~/heat_run.sh probes              프로브 둘 중 어느 것이 어느 것인지 손으로 판정
  2  bash ~/heat_run.sh setprobes NEAR FAR   판정한 ID 로 상수를 맞춘다 (원본은 자동 백업)
  3  bash ~/heat_run.sh start PB5000_r16_1A_heat 1.0     로거 기동 + 점검   (접두, 전류A)
     -> IR 정착을 SETTLE_MIN(기본 20)분 기다린다
  4  BW150: CC 전류 설정 / Cap·Ene 0 / 출력 ON / 팩 버튼
  5  bash ~/heat_run.sh go                   CH3 를 닫고 방전 시작 (팩이 깼는지 자동 확인)
  6  bash ~/heat_run.sh watch                 표면 온도 실시간 (WARN_C 넘으면 경고)
  7  bash ~/heat_run.sh mark heat_on / heat_off   가열 시작·종료 시각 기록
  8  bash ~/heat_run.sh stop                  비상: 부하 차단 (꼬리 기록은 자동 계속)
  9  bash ~/heat_run.sh finish                파일 정리 + 프로브 상수 원복

기타: status (현재 상태)   restore (프로브 상수만 원복)
환경변수: SETTLE_MIN TAIL_MIN IR_STOP DS_STOP WARN_C BROKER FORCE=1 DRY=1
EOF
}

# ── probes: 손으로 어느 프로브가 어느 것인지 가린다 ────────────────────
cmd_probes() {
    local sec=${1:-40}
    say "판정 ${sec}초 — 지금 프로브 하나를 손으로 쥐어 데우세요."
    python3 - "$sec" <<'PY'
import glob, os, sys, time
sec = int(sys.argv[1])
ids = sorted(os.path.basename(p) for p in glob.glob("/sys/bus/w1/devices/28-*"))
if len(ids) < 2:
    print("프로브가 %d개만 보입니다 (2개 필요)" % len(ids)); sys.exit(1)
def rd(i):
    try:
        t = open("/sys/bus/w1/devices/%s/w1_slave" % i).read()
        v = int(t.split("t=")[-1]) / 1000.0
        return None if abs(v - 85.0) < 1e-3 else v      # 85.0 = VCC 불량
    except Exception:
        return None
hist = dict((i, []) for i in ids)
t0 = time.time()
while time.time() - t0 < sec:
    row = []
    for i in ids:
        v = rd(i); hist[i].append(v)
        row.append("%s %s" % (i[-6:], ("%.2f" % v) if v is not None else "FAIL"))
    print("  t+%3d   %s" % (time.time() - t0, "    ".join(row))); sys.stdout.flush()
    time.sleep(1.0)
print("")
best = None
for i in ids:
    vs = [v for v in hist[i] if v is not None]
    if not vs:
        print("  %s  읽기 실패 (85.0 = VCC 불량 포함)" % i); continue
    rise = max(vs) - min(vs)
    print("  %s  변화폭 %.2f C" % (i, rise))
    if best is None or rise > best[1]:
        best = (i, rise)
if best and best[1] >= 1.0:
    print("\n>> 손으로 데운 프로브 = %s" % best[0])
else:
    print("\n>> 어느 쪽도 1도 이상 안 올랐습니다. 더 오래 쥐고 다시 하세요.")
PY
}

# ── setprobes: 상수를 맞추고 원본을 백업한다 ──────────────────────────
cmd_setprobes() {
    local near=${1:-} far=${2:-}
    [ -n "$near" ] && [ -n "$far" ] || die "사용: setprobes <NEAR_ID> <FAR_ID>"
    [ "$near" != "$far" ] || die "NEAR 와 FAR 가 같습니다"
    [ -d "/sys/bus/w1/devices/$near" ] || die "$near 가 버스에 없습니다"
    [ -d "/sys/bus/w1/devices/$far" ]  || die "$far 가 버스에 없습니다"
    pgrep -f "[m]lx_fast_log|[t]hermal_log_alarm|[t]empguard|[i]na_log" > /dev/null && die "로거가 돌고 있습니다. 끝낸 뒤에 바꾸세요"

    local f
    for f in $PATCHED; do [ -f ~/"$f" ] || die "~/$f 가 없습니다"; done
    if [ "$DRY" = 1 ]; then say "DRY=1 — 검증만 하고 바꾸지 않습니다: NEAR=$near FAR=$far"; return 0; fi

    mkdir -p "$BK"
    for f in $PATCHED; do
        [ -f "$BK/$f" ] || cp ~/"$f" "$BK/$f"          # 최초 원본만 보존한다
    done
    say "원본 백업: $BK"

    # 근처 프로브 -> '셀' 자리, 먼 프로브 -> '실온' 자리
    sed -i -E "s/^CELL_ID = (None|\"[^\"]*\")/CELL_ID = \"$near\"/; s/^AMBIENT_ID = \"[^\"]*\"/AMBIENT_ID = \"$far\"/" ~/thermal_log_alarm.py
    sed -i -E "s/^CELL_ID = (None|\"[^\"]*\")/CELL_ID = \"$near\"/" ~/tempguard.py
    sed -i -E "s/^CELL, AMB = [^,]+, '[^']*'/CELL, AMB = '$near', '$far'/" ~/preflight.py ~/sensorwatch.py
    # Kafka 쪽은 실온만 바꾼다. CELL_ID 는 None 그대로 — 계약이 mode 2 접촉 온도를 금지한다.
    sed -i -E "s/^AMBIENT_ID = \"[^\"]*\"/AMBIENT_ID = \"$far\"/" ~/sensors_kafka.py

    local bad=0
    for f in $PATCHED; do
        python3 -m py_compile ~/"$f" 2>/dev/null || { echo "  !! 문법 오류 $f"; bad=1; }
    done
    [ "$bad" = 0 ] || die "문법 오류 — restore 로 되돌리세요"
    echo "--- 적용 결과 ---"
    grep -nE "^(CELL_ID|AMBIENT_ID|CELL, AMB) *=" ~/thermal_log_alarm.py ~/tempguard.py ~/preflight.py ~/sensorwatch.py ~/sensors_kafka.py | sed 's/#.*//'
    say "NEAR(가까운)=$near  FAR(먼)=$far"
}

cmd_restore() {
    [ -d "$BK" ] || { say "백업이 없습니다 — 바뀐 것이 없습니다"; return 0; }
    pgrep -f "[m]lx_fast_log|[t]hermal_log_alarm|[t]empguard|[i]na_log" > /dev/null && die "로거가 돌고 있습니다"
    local f
    for f in $PATCHED; do [ -f "$BK/$f" ] && cp "$BK/$f" ~/"$f"; done
    rm -rf "$BK"
    say "프로브 상수를 원본으로 되돌렸습니다."
}

# ── start ────────────────────────────────────────────────────────────
cmd_start() {
    PREFIX=${1:-}; AMPS=${2:-}
    [ -n "$PREFIX" ] && [ -n "$AMPS" ] || die "사용: start <접두> <전류A>   예: start PB5000_r16_1A_heat 1.0"
    case "$PREFIX" in *_heat*) ;; *) say "권장: 접두에 _heat 를 붙이세요 (6채널 학습에서 구분하려고)";; esac
    pgrep -f "[m]lx_fast_log|[t]hermal_log_alarm|[t]empguard|[i]na_log" > /dev/null && die "이미 로거가 돌고 있습니다 (status 확인)"
    ls ~/${PREFIX}_* > /dev/null 2>&1 && die "접두 ${PREFIX} 파일이 이미 있습니다 — 이름을 바꾸세요"
    [ -d "$BK" ] || say "주의: setprobes 를 안 했습니다. 프로브 상수가 평소(가까운 프로브 없음) 그대로입니다."

    say "점검 (preflight)"
    local out; out=$(python3 ~/preflight.py "$PREFIX" 2>&1)
    echo "$out" | tail -16
    echo "$out" | grep -q "NO-GO" && die "preflight NO-GO — 위 내용을 고친 뒤 다시"

    pinctrl set 5,6,13 op dh      # 릴레이 안전 (CH3 열림)
    pinctrl set 19 op dl          # CH4 = 모드 2
    say "릴레이: CH3 열림 / CH4 모드2  ->  $(pinctrl get 13,19 | tr '\n' ' ')"

    cd ~ || die "홈 이동 실패"
    nohup python3 -u ~/mlx_fast_log.py 0.1 ~/${PREFIX}_mlx01.csv --rise 3 --window 30 </dev/null > ~/mlx_logger.out 2>&1 &
    IR_T0=$(date +%s); GO_T0=0
    sleep 2
    nohup python3 -u ~/tempguard.py --ir-stop "$IR_STOP" --ds-stop "$DS_STOP" --rise 10 --window 60 --rise-gate 40 --log ~/guard.log </dev/null > ~/guard.out 2>&1 &
    sleep 2
    nohup python3 -u ~/thermal_log_alarm.py 1 ~/${PREFIX}_temp.csv 60 </dev/null > ~/temp_logger.out 2>&1 &
    sleep 4
    save_state
    mark start

    local n=0
    pgrep -f "[m]lx_fast_log"      > /dev/null && n=$((n+1))
    pgrep -f "[t]empguard"         > /dev/null && n=$((n+1))
    pgrep -f "[t]hermal_log_alarm" > /dev/null && n=$((n+1))
    [ "$n" = 3 ] || die "로거 3개 중 ${n}개만 떴습니다 — status 와 *_logger.out 확인"
    say "로거 3개 가동 (IR / tempguard ir-stop=${IR_STOP} ds-stop=${DS_STOP} / 온도)"
    cat <<EOF

다음:
  · IR 정착 ${SETTLE_MIN}분 (기다리는 동안 sensorwatch 로 부착 검증을 권장)
  · BW150: CC ${AMPS}A 설정 / Cap·Ene 0 초기화 / 출력 ON / 팩 버튼으로 깨우기
  · 준비되면:  bash ~/heat_run.sh go
EOF
}

# ── go ───────────────────────────────────────────────────────────────
cmd_go() {
    load_state || die "start 를 먼저 실행하세요"
    pgrep -f "[m]lx_fast_log"      > /dev/null || die "IR 로거가 없습니다"
    pgrep -f "[t]empguard"         > /dev/null || die "tempguard 가 없습니다 (유일한 자동 방어선)"
    pgrep -f "[t]hermal_log_alarm" > /dev/null || die "온도 로거가 없습니다"
    pgrep -f "[i]na_log"           > /dev/null && die "INA 로거가 이미 돕니다 (go 는 한 번만)"

    local age=$(( $(date +%s) - IR_T0 ))
    if [ "$age" -lt $(( SETTLE_MIN * 60 )) ]; then
        [ "${FORCE:-0}" = 1 ] || die "IR 정착 ${age}초 < ${SETTLE_MIN}분. 기다리거나 FORCE=1 (정착 부족이 기록에 남습니다)"
        mark settle_short_${age}s
    fi

    say "CH3 를 5초 뒤에 닫습니다. BW150 출력이 ON 이고 팩 버튼을 눌렀는지 확인하세요. (Ctrl+C 로 취소)"
    sleep 5
    pinctrl set 13 op dl
    say "CH3 닫음 — 팩이 깼는지 확인 (최대 25초)"

    if ! python3 - "$AMPS" <<'PY'
import os, fcntl, sys, time
amps = float(sys.argv[1])
fd = os.open("/dev/i2c-1", os.O_RDWR)
fcntl.ioctl(fd, 0x0703, 0x40)
def rd(r):
    os.write(fd, bytes([r])); b = os.read(fd, 2); return (b[0] << 8) | b[1]
t0 = time.time(); v = a = 0.0
while time.time() - t0 < 25:
    v = rd(0x02) * 1.25 / 1000.0
    s = rd(0x01)
    if s > 32767: s -= 65536
    a = s * 2.5e-6 / 0.01
    if v > 4.5 and abs(a) > 0.3 * amps:
        print("  깨어남: %.3f V  %.3f A" % (v, abs(a))); sys.exit(0)
    time.sleep(0.4)
print("  마지막 읽기: %.3f V  %.3f A" % (v, abs(a))); sys.exit(1)
PY
    then
        pinctrl set 13 op dh
        die "팩이 안 깼거나 BW150 출력이 OFF 입니다. CH3 다시 열었습니다. BW150 출력 ON 확인 + 팩 버튼 후 go 를 다시 실행하세요."
    fi

    local maxa; maxa=$(awk "BEGIN{printf \"%.2f\", $AMPS*1.25}")
    cd ~ || die "홈 이동 실패"
    nohup python3 -u ~/ina_log.py 0.1 ~/${PREFIX}_ina.csv --stop-v 3.0 --max-a "$maxa" </dev/null > ~/ina_logger.out 2>&1 &
    sleep 3
    pgrep -f "[i]na_log" > /dev/null || { pinctrl set 13 op dh; die "INA 로거가 안 떴습니다. CH3 열었습니다 — ina_logger.out 확인"; }

    rm -f ~/run_end.log
    nohup bash ~/watch_run_end.sh "$TAIL_MIN" "$PREFIX" </dev/null > ~/run_end.out 2>&1 &

    if [ -n "$BROKER" ]; then
        nohup python3 -u ~/sensors_kafka_v2.py --broker "$BROKER" --interval 1.0 --duration 14400 --print-every 60 </dev/null > ~/kafka_live.out 2>&1 &
        say "Kafka 송신 시작 -> $BROKER"
    fi

    GO_T0=$(date +%s); save_state
    mark go
    say "방전 시작. 종료는 자동(컷오프 -> CH3 개방 -> 꼬리 ${TAIL_MIN}분). 표면 온도는:  bash ~/heat_run.sh watch"
    say "가열을 시작/멈출 때마다:  bash ~/heat_run.sh mark heat_on   /   mark heat_off"
}

# ── watch: 표면 온도 실시간 ───────────────────────────────────────────
cmd_watch() {
    load_state || die "start 를 먼저 실행하세요"
    say "Ctrl+C 로 종료. 표면 ${WARN_C}C 이상이면 경고음 + 문구."
    while :; do
        local L near far ir
        L=$(tail -n1 ~/temp_logger.out 2>/dev/null)
        near=$(echo "$L" | sed -n 's/.*셀= *\([0-9.-]*\).*/\1/p')
        far=$(echo  "$L" | sed -n 's/.*실온= *\([0-9.-]*\).*/\1/p')
        ir=$(echo   "$L" | sed -n 's/.*IR= *\([0-9.-]*\).*/\1/p')
        printf '%s  근처 %-6s 먼(실온) %-6s IR표면 %-6s' "$(date +%T)" "${near:---}" "${far:---}" "${ir:---}"
        if [ -n "$ir" ] && awk -v a="$ir" -v b="$WARN_C" 'BEGIN{exit !(a>=b)}'; then
            printf '   !!! %sC 초과 — 가열을 멈추세요\a' "$WARN_C"
        fi
        echo
        sleep 2
    done
}

# ── stop / status / finish ────────────────────────────────────────────
cmd_stop() {
    pinctrl set 13 op dh
    say "CH3 열림 (부하 차단): $(pinctrl get 13)"
    load_state && mark stop_manual
    say "냉각 꼬리 기록은 자동으로 이어집니다. 열원(드라이어)은 직접 끄세요."
}

cmd_status() {
    echo "--- 프로세스 ---"
    local p
    for p in "m|lx_fast_log" "t|hermal_log_alarm" "t|empguard" "i|na_log" "s|ensors_kafka_v2" "w|atch_run_end"; do
        if pgrep -f "[${p%%|*}]${p#*|}" > /dev/null; then echo "  ON   ${p%%|*}${p#*|}"; else echo "  --   ${p%%|*}${p#*|}"; fi
    done
    echo "--- 릴레이 ---"; pinctrl get 13,19 | sed 's/^/  /'
    if load_state; then
        echo "--- run: $PREFIX  (${AMPS}A) ---"
        [ "${IR_T0:-0}" != 0 ] && echo "  IR 정착 경과: $(( ($(date +%s) - IR_T0) / 60 ))분"
        [ "${GO_T0:-0}" != 0 ] && echo "  방전 경과  : $(( ($(date +%s) - GO_T0) / 60 ))분"
        echo "--- 최근 값 ---"
        tail -n1 ~/ina_logger.out 2>/dev/null | sed 's/^/  INA   /'
        tail -n1 ~/temp_logger.out 2>/dev/null | sed 's/^/  TEMP  /'
        tail -n1 ~/guard.out 2>/dev/null | sed 's/^/  GUARD /'
        [ -f ~/run_end.log ] && tail -n2 ~/run_end.log | sed 's/^/  END   /'
    else
        echo "  (진행 중인 run 없음)"
    fi
    [ -d "$BK" ] && echo "--- 프로브 상수: 가열 배치로 바뀐 상태 (finish 나 restore 로 원복) ---"
}

cmd_finish() {
    load_state || die "진행 중인 run 이 없습니다"
    if pgrep -f "[i]na_log|[w]atch_run_end" > /dev/null; then
        die "아직 방전/꼬리 기록 중입니다. run_end.log 에 '=== 완료 ===' 가 보인 뒤에 finish 하세요 (status 확인)"
    fi
    pgrep -f "[s]ensors_kafka_v2" | xargs -r kill
    pgrep -f "[m]lx_fast_log|[t]hermal_log_alarm|[t]empguard" | xargs -r kill
    sleep 2
    pinctrl set 5,6,13,19 op dh
    local d=~/runs/${PREFIX}_$(date +%Y%m%d)
    mkdir -p "$d"
    mv ~/${PREFIX}_* "$d"/ 2>/dev/null
    local f; for f in guard.log guard.out ina_logger.out mlx_logger.out temp_logger.out kafka_live.out run_end.log run_end.out; do
        [ -f ~/"$f" ] && mv ~/"$f" "$d"/
    done
    cmd_restore
    rm -f "$STATE"
    say "정리 완료 -> $d"
    ls -l "$d" | sed 's/^/  /'
    cat <<EOF

PC 로 가져오기 (PC 의 PowerShell 에서):
  scp -r <USER>@<PI_IP>:~/runs/$(basename "$d") .
그리고 프로브를 물리적으로 평소 배치로 되돌리세요 (가까운 프로브 -> 다시 실온용 위치).
EOF
}

case "${1:-help}" in
    help|-h|--help) cmd_help ;;
    probes)     shift; cmd_probes "$@" ;;
    setprobes)  shift; cmd_setprobes "$@" ;;
    restore)    cmd_restore ;;
    start)      shift; cmd_start "$@" ;;
    go)         cmd_go ;;
    mark)       shift; [ -n "${1:-}" ] || die "사용: mark <라벨>"; mark "$1" ;;
    watch)      cmd_watch ;;
    stop)       cmd_stop ;;
    status)     cmd_status ;;
    finish)     cmd_finish ;;
    *) die "모르는 명령: $1  (help 참조)" ;;
esac
