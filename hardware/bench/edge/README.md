# edge/ — 파이에서 가져와야 하는 것

파이(<USER>@<HOST>)에만 있는 스크립트는 아직 이 저장소에 없다. **파이를 켤 때 scp 로 가져와 이 폴더에 넣을 것.**

    for f in sensors_kafka_v2.py sensors_kafka.py watch_run_end.sh thermal_log_alarm.py tempguard.py sensorwatch.py preflight.py; do
      scp <USER>@<LAN_IP>:~/$f edge/$f
    done

주의: `tools/` 의 tempguard/sensorwatch/preflight 는 PC 사본이라 **파이 쪽이 더 최신**일 수 있다
(2026-09-24~28 에 DS18B20 상수를 파이에서 직접 고쳤다: CELL_ID=None, AMBIENT_ID=28-0625650a2c2c).
파이 것을 받으면 tools/ 것을 덮어써도 된다.

`apply_temp_ambient_patch.py` 는 sensors_kafka_v2.py 에 temp_ambient 를 추가하는 패치다(2026-09-28, 이미 파이에 적용됨).
