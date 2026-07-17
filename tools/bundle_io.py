"""셀가드 프로토타입 번들의 마크업 레이어를 안전하게 읽고 쓴다.

번들은 23MB 단일 HTML이며 실제 마크업은 210번 줄(1-기반)의 JSON 문자열
하나에 들어 있다. 202번 줄은 22MB base64 자산 매니페스트이므로 절대 건드리지
않는다. 파일 전체를 문자열로 다루면 메모리를 크게 쓰므로 줄 단위로 처리한다.
"""

import json
import os
import shutil
from datetime import date

TEMPLATE_LINE_INDEX = 209  # 0-기반. 1-기반 210번 줄.


def _read_lines(bundle_path):
    with open(bundle_path, encoding="utf-8") as f:
        return f.readlines()


def unpack(bundle_path):
    """번들에서 마크업 HTML 문자열을 꺼낸다."""
    lines = _read_lines(bundle_path)
    if len(lines) <= TEMPLATE_LINE_INDEX:
        raise ValueError(f"번들에 {TEMPLATE_LINE_INDEX + 1}번째 줄이 없다")
    raw = lines[TEMPLATE_LINE_INDEX].strip()
    if raw.endswith(";"):
        raw = raw[:-1]
    return json.loads(raw)


def pack(bundle_path, markup):
    """마크업을 JSON 인코딩해 210번 줄에 되쓴다. 다른 줄은 보존한다."""
    lines = _read_lines(bundle_path)
    if len(lines) <= TEMPLATE_LINE_INDEX:
        raise ValueError(f"번들에 {TEMPLATE_LINE_INDEX + 1}번째 줄이 없다")
    lines[TEMPLATE_LINE_INDEX] = json.dumps(markup, ensure_ascii=False) + "\n"
    tmp = bundle_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp, bundle_path)


def backup(bundle_path):
    """편집 전 백업. 대상 파일은 git 추적 대상이 아니므로 필수다."""
    base = os.path.basename(bundle_path)
    stem = base[:-5] if base.endswith(".html") else base
    dest_dir = os.path.join(os.path.dirname(bundle_path), "아카이브")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{stem} 백업_{date.today().isoformat()}.html")
    shutil.copy2(bundle_path, dest)
    return dest


if __name__ == "__main__":
    import sys

    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "unpack":
        sys.stdout.write(unpack(path))
    elif cmd == "pack":
        pack(path, sys.stdin.read())
    elif cmd == "backup":
        print(backup(path))
    else:
        raise SystemExit(f"알 수 없는 명령: {cmd}")
