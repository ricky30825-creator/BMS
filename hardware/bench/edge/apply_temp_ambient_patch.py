import os, shutil, py_compile

p = os.path.expanduser("~/sensors_kafka_v2.py")
bak = p + ".bak-20260928"
src = open(p, encoding="utf-8").read()
if not os.path.exists(bak):
    shutil.copy2(p, bak)
    print("backup ->", os.path.basename(bak))

edits = []

# 1) optional key
OLD = 'OPTIONAL_KEYS = {"diag_phase", "load_target_a"}'
NEW = 'OPTIONAL_KEYS = {"diag_phase", "load_target_a", "temp_ambient"}'
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("OPTIONAL_KEYS")

# 2) build_frame signature
OLD = "def build_frame(device_id, mode, ts, ina, mlx, ages):"
NEW = "def build_frame(device_id, mode, ts, ina, mlx, ages, ambient=None):"
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("build_frame signature")

# 3) frame field -- kept OUT of temp_points so the peak invariant is untouched
OLD = '        "temp_points": {"contact": None, "ir": ir_points},\n'
NEW = ('        "temp_points": {"contact": None, "ir": ir_points},\n'
       '        # Room temperature. Not a cell point, so it stays out of\n'
       '        # temp_points and out of the max() that feeds temp_ir_surface.\n'
       '        # Optional in the contract [2026-09-25]; null = not measured.\n'
       '        "temp_ambient": _r(ambient, 2),\n')
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("temp_ambient field")

# 4) validator -- number-or-null, tolerant of the key being absent
OLD = ('    for k in ("voltage_v", "current_a", "power_w", "temp_contact",\n'
       '              "temp_ir_surface", "gas_raw", "pressure_raw", "acoustic_raw"):')
NEW = ('    ta = f.get("temp_ambient")\n'
       '    if ta is not None and not isinstance(ta, (int, float)):\n'
       '        errs.append("temp_ambient must be a finite number or null")\n'
       '\n'
       '    for k in ("voltage_v", "current_a", "power_w", "temp_contact",\n'
       '              "temp_ir_surface", "gas_raw", "pressure_raw", "acoustic_raw"):')
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("validator check")

# 5) call site
OLD = "frame = build_frame(args.device_id, args.mode, now, ina, mlx, ages)"
NEW = "frame = build_frame(args.device_id, args.mode, now, ina, mlx, ages,\n                                  ds.ambient)"
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("call site")

# 6) startup banner
OLD = ('    print("             ambient has no field in the contract -- it is read for")\n'
       '    print("             the console only and is NOT published.")')
NEW = ('    print("             ambient -> temp_ambient (contract optional, 2026-09-25)")')
if OLD in src:
    src = src.replace(OLD, NEW, 1); edits.append("startup banner")

if not edits:
    print("NO CHANGES -- patterns not found")
    raise SystemExit(1)

open(p, "w", encoding="utf-8").write(src)
print("patched:", ", ".join(edits))

py_compile.compile(p, doraise=True)
print("syntax OK")

print()
print("=== built frame (dry check) ===")
import sys
sys.path.insert(0, os.path.expanduser("~"))
import importlib.util
spec = importlib.util.spec_from_file_location("sk2", p)
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass
fr = m.build_frame("PI-TEST", 2, 1790000000.0, (4.9, -1.98, -9.7),
                   {0x5A: (27.31, 26.9), 0x5B: (26.87, 26.9)},
                   {"voltage_v": 2, "current_a": 2, "temp_ir_surface": 3},
                   25.31)
import json
print(json.dumps(fr, ensure_ascii=False, indent=1))
errs = m.validate_frame(fr)
print()
print("validate_frame ->", "PASS" if not errs else errs)
