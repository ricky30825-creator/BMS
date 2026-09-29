"""report_template.html 의 __CHART_DATA__ 자리에 chart_data.json 을 넣어 최종 HTML을 만든다."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(HERE, "report_template.html")
DATA = os.path.join(HERE, "chart_data.json")
OUT = os.path.join(HERE, "discharge_report.html")

with open(TPL, encoding="utf-8") as f:
    html = f.read()
with open(DATA, encoding="utf-8") as f:
    payload = json.load(f)

if "__CHART_DATA__" not in html:
    raise SystemExit("템플릿에 __CHART_DATA__ 자리표시자가 없다")

html = html.replace("__CHART_DATA__", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("생성: %s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024))
