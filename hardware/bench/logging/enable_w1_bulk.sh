#!/bin/bash
# DS18B20 동시 변환(therm_bulk_read)을 gpio 그룹에서 쓸 수 있게 한다.
#
#   sudo bash ~/enable_w1_bulk.sh
#
# 왜 필요한가:
#   `therm_bulk_read`는 기본이 root:root 644라 일반 사용자가 못 쓴다.
#   이걸 못 쓰면 DS18B20 두 개를 순차로 변환해야 해서 센서당 750ms,
#   두 개면 1.5초가 깔린다(실측 약 2.6초). 동시 변환하면 750ms 한 번으로
#   끝나 약 0.85초가 된다 — 급상승 경보의 반응이 3배 빨라진다.
#
# 부팅할 때마다 sysfs가 새로 만들어지므로 systemd 서비스로 등록한다.
set -e

if [ "$EUID" -ne 0 ]; then
  echo "sudo로 실행하시오:  sudo bash $0"
  exit 1
fi

SVC=/etc/systemd/system/w1-bulk-perm.service

cat > "$SVC" <<'EOF'
[Unit]
Description=Allow gpio group to trigger DS18B20 bulk conversion
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for f in /sys/bus/w1/devices/w1_bus_master*/therm_bulk_read; do [ -e "$f" ] && chgrp gpio "$f" && chmod g+w "$f"; done; exit 0'

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now w1-bulk-perm.service

echo
echo "적용 결과:"
ls -l /sys/bus/w1/devices/w1_bus_master*/therm_bulk_read
echo
echo "'-rw-rw-r-- root gpio' 로 보이면 성공."
echo "이제 thermal_log_bulk.py 가 동시 변환을 씁니다 (약 0.85초)."
