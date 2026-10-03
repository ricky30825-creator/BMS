#!/bin/bash
# safe_shutdown.sh - CellGuard bench safe power-down
#
#   sudo bash ~/safe_shutdown.sh          # cut load, stop loggers, halt
#   sudo bash ~/safe_shutdown.sh --dry    # show what it would do, no halt
#
# Order matters: open the master relay FIRST, then stop the watchdog.
# Stopping tempguard while current still flows would leave the bench
# unprotected for those few seconds.

DRY=0
[ "$1" = "--dry" ] && DRY=1

echo "=============================================="
echo " CellGuard safe shutdown"
echo "=============================================="

# 1) master OFF first -- CH3 is the kill switch
echo "[1/5] opening CH3 master (GPIO13)"
pinctrl set 13 op dh
sleep 1

# 2) all relays back to the boot-safe state (config.txt: gpio=5,6,13,19=op,dh)
echo "[2/5] all relays -> OFF (5,6,13,19 = high)"
pinctrl set 5 op dh
pinctrl set 6 op dh
pinctrl set 13 op dh
pinctrl set 19 op dh
sleep 1
pinctrl get 5,6,13,19

# 3) now it is safe to stop the watchdog and loggers
#    [x] bracket trick: keeps pgrep from matching its own command line
echo "[3/5] stopping tempguard and loggers"
for pat in '[t]empguard' '[i]na_log' '[t]hermal_log' '[m]lx_fast'; do
    pgrep -f "$pat" | xargs -r kill 2>/dev/null
done
sleep 1

# 4) confirm nothing is left holding the I2C bus / GPIO
echo "[4/5] remaining processes:"
pgrep -af 'tempguar|ina_log|thermal_log|mlx_fast' || echo "     (none)"

# 5) flush filesystem, then halt
echo "[5/5] sync + halt"
sync

if [ "$DRY" = "1" ]; then
    echo ""
    echo "--dry: stopping here, no shutdown."
    exit 0
fi

echo ""
echo "  >> Wait for the green ACT LED to stop blinking before"
echo "     pulling power. Red PWR LED alone is normal."
echo ""
shutdown -h now
