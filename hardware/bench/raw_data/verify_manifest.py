# -*- coding: utf-8 -*-
"""MANIFEST.csv 의 sha256 과 실제 압축 파일의 내용을 대조한다.

    python verify_manifest.py <raw_data 폴더>
"""
import csv, gzip, hashlib, os, sys

root = sys.argv[1] if len(sys.argv) > 1 else "."
bad = ok = 0
with open(os.path.join(root, "MANIFEST.csv"), encoding="utf-8", newline="") as fh:
    for row in csv.DictReader(fh):
        path = os.path.join(root, row["path_gz_minus_suffix"] + ".gz")
        if not os.path.exists(path):
            print("MISSING", path); bad += 1; continue
        h = hashlib.sha256()
        with gzip.open(path, "rb") as g:
            for chunk in iter(lambda: g.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() == row["sha256_raw"]:
            ok += 1
        else:
            print("MISMATCH", path); bad += 1
print("ok %d  bad %d" % (ok, bad))
sys.exit(1 if bad else 0)
