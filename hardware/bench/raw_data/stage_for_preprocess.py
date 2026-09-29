# -*- coding: utf-8 -*-
"""raw_data/ (gzip) -> ai/model/preprocess.py 가 기대하는 배치로 푼다.

    python stage_for_preprocess.py <raw_data 폴더> <출력 폴더> [--include-b]

출력:  <out>/PB20000/run_r4_2A/{ina,soc,temp}.csv  (+ ina_part2.csv 가 있으면 같이)
       <out>/18650/BAT01/run_b1_1A/...

그 다음:
    python -m ai.model.preprocess --data-root <out> --output <processed> [--core5]
    python -m ai.model.preprocess --data-root <out> --output <processed_cell> --battery-type cell

- `_aborted` / `_startup` 파일은 방전이 아니므로 뺀다.
- PB10KB / PB20KB 는 원본과 다른 별개 팩(PB-10000B / PB-20000B)이라 기본은 뺀다. --include-b 로 넣는다.
- ina_part2.csv 를 반드시 같이 푼다 (preprocess 가 ina.csv 뒤에 이어 붙인다).
"""
import gzip, os, re, shutil, sys

PB = re.compile(r"^(PB\d+)_([A-Za-z0-9]+)_([0-9]+[AW])_(\d{8})$")
PB_B = re.compile(r"^PB(10|20)KB_([A-Za-z0-9]+)_([0-9]+[AW])_(\d{8})$")
CELL = re.compile(r"^18650_b(\d)_([0-9]+[AW])_(\d{8})$")


def pick(files, suffix):
    c = [f for f in files if f.endswith(suffix) and "aborted" not in f and "startup" not in f]
    return c[0] if c else None


def unzip(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with gzip.open(src, "rb") as a, open(dst, "wb") as b:
        shutil.copyfileobj(a, b)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    raw, out = args
    include_b = "--include-b" in sys.argv
    n_runs = n_part2 = 0
    for d in sorted(os.listdir(raw)):
        p = os.path.join(raw, d)
        if not os.path.isdir(p):
            continue
        m = PB.match(d); mb = PB_B.match(d); mc = CELL.match(d)
        if m:
            dest = os.path.join(out, m.group(1), "run_%s_%s" % (m.group(2), m.group(3)))
        elif mb and include_b:
            dest = os.path.join(out, "PB%s000B" % ("10" if mb.group(1) == "10" else "20"),
                                "run_%s_%s" % (mb.group(2), mb.group(3)))
        elif mc:
            dest = os.path.join(out, "18650", "BAT0%s" % mc.group(1), "run_b%s_%s" % (mc.group(1), mc.group(2)))
        else:
            continue
        files = sorted(os.listdir(p))
        ina, soc, temp = pick(files, "_ina.csv.gz"), pick(files, "_soc.csv.gz"), pick(files, "_temp.csv.gz")
        if not (ina and soc and temp):
            print("skip (ina/soc/temp 중 없음): %s" % d)
            continue
        unzip(os.path.join(p, ina), os.path.join(dest, "ina.csv"))
        unzip(os.path.join(p, soc), os.path.join(dest, "soc.csv"))
        unzip(os.path.join(p, temp), os.path.join(dest, "temp.csv"))
        part2 = pick(files, "_ina_part2.csv.gz")
        if part2:
            unzip(os.path.join(p, part2), os.path.join(dest, "ina_part2.csv"))
            n_part2 += 1
        n_runs += 1
    print("풀린 run %d개 (ina_part2 포함 %d개) -> %s" % (n_runs, n_part2, out))


if __name__ == "__main__":
    main()
