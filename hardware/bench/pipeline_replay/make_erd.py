#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_erd.py — 슬라이드 1~4 ERD 그림.

정본: 배터리/backend/migrations/000~005.sql — 14 테이블 · 16 FK.
기존 ERD(12 테이블)는 notification·threshold_setting·calibration_history·notice
4개가 실제 스키마에 없고, diagnosis·battery_latest·battery_health·outbox·
idempotency_key 5개가 빠져 있었다.

    python make_erd.py
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BG = "#ffffff"
INK = "#111827"
MUTED = "#6b7280"
LINE = "#cbd5e1"
KR = "Malgun Gothic, 맑은 고딕, sans-serif"
MONO = "Consolas, D2Coding, monospace"

# 도메인별 색
C_AUTH = "#0f766e"     # 인증·자산
C_OPS = "#4f46e5"      # 관제·이상탐지
C_INFRA = "#b45309"    # 운영·인프라


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rect(x, y, w, h, fill=BG, stroke=LINE, rx=6, sw=1.4, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" '
            'stroke="%s" stroke-width="%g"%s/>' % (x, y, w, h, rx, fill, stroke, sw, d))


def text(x, y, s, size=12, fill=INK, weight="normal", anchor="start", family=MONO):
    return ('<text x="%g" y="%g" font-family="%s" font-size="%g" font-weight="%s" '
            'fill="%s" text-anchor="%s">%s</text>'
            % (x, y, family, size, weight, fill, anchor, esc(s)))


def line(x1, y1, x2, y2, stroke=LINE, sw=1.6, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="%g"%s/>'
            % (x1, y1, x2, y2, stroke, sw, d))


ROW = 19.0
HEAD = 26.0


def entity(x, y, w, name, cols, color):
    """엔티티 상자. cols = [(컬럼, 표기)] — 표기는 PK/FK/'' """
    h = HEAD + ROW * len(cols) + 6
    out = [rect(x, y, w, h, "#ffffff", color, 7, 1.8),
           rect(x, y, w, HEAD, color, color, 7, 0),
           rect(x, y + HEAD - 7, w, 7, color, color, 0, 0),
           text(x + 10, y + 18, name, 13, "#ffffff", "bold", "start", MONO)]
    for i, (cname, mark) in enumerate(cols):
        ty = y + HEAD + ROW * i + 14
        out.append(text(x + 10, ty, cname, 11.5,
                        INK if mark == "PK" else MUTED,
                        "bold" if mark == "PK" else "normal", "start", MONO))
        if mark:
            out.append(text(x + w - 10, ty, mark, 10.5,
                            color, "bold", "end", MONO))
    return "".join(out), h


def svg(w, h, body, extra=""):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
            'width="%g" height="%g"><rect width="%g" height="%g" fill="%s"/>%s%s</svg>'
            % (w, h, w, h, w, h, BG, extra, body))


# ════════════════════════════════════════════════════════════════════
def domain1():
    """① 인증·자산 도메인 — user, app_user_profile, device, battery_asset"""
    W, H = 1360, 620
    b = []
    b.append(text(24, 34, "모든 소유권이 \"user\".id 에서 뻗어 나간다  ·  4 테이블",
                  14, MUTED, "normal", "start", KR))

    e1, h1 = entity(24, 56, 300, '"user"', [
        ("id", "PK"), ("email", "UQ"), ("name", ""), ('"emailVerified"', ""),
        ("image", ""), ('"createdAt"', ""), ('"updatedAt"', "")], C_AUTH)
    e2, h2 = entity(368, 56, 300, "app_user_profile", [
        ("user_id", "PK/FK"), ("role", ""), ("status", ""), ("phone", ""),
        ("is_active", ""), ("created_at", ""), ("updated_at", "")], C_AUTH)
    e3, h3 = entity(712, 56, 300, "device", [
        ("id", "PK"), ("owner_user_id", "FK"), ("label", ""),
        ("hardware_profile", ""), ("status", ""), ("last_seen_at", ""),
        ("created_at", "")], C_AUTH)
    e4, h4 = entity(1056, 56, 280, "battery_asset", [
        ("id", "PK"), ("owner_user_id", "FK"), ("label", ""), ("chemistry", ""),
        ("target_mode", ""), ("capacity_wh/mah", ""), ("ops_status", ""),
        ("memo/admin_memo", ""), ("version", "")], C_AUTH)
    b += [e1, e2, e3, e4]

    # 관계선
    b.append(line(324, 56 + HEAD + 10, 368, 56 + HEAD + 10, C_AUTH, 2))
    b.append(text(346, 56 + HEAD + 4, "1:1", 10.5, C_AUTH, "bold", "middle", MONO))
    b.append(line(174, 56 + h1 + 8, 174, 470, C_AUTH, 1.6, "5 4"))
    b.append(line(174, 470, 862, 470, C_AUTH, 1.6, "5 4"))
    b.append(line(862, 470, 862, 56 + h3 + 8, C_AUTH, 1.6, "5 4"))
    b.append(line(1196, 470, 1196, 56 + h4 + 8, C_AUTH, 1.6, "5 4"))
    b.append(line(862, 470, 1196, 470, C_AUTH, 1.6, "5 4"))
    b.append(text(520, 464, "\"user\".id  1 : N  (device · battery_asset 소유)",
                  12, C_AUTH, "bold", "middle", KR))

    b.append(rect(24, 500, 1312, 92, "#f9fafb", LINE, 8))
    b.append(text(44, 526, "설계 포인트", 13, INK, "bold", "start", KR))
    b.append(text(44, 550,
                  "· 신원(\"user\")과 앱 권한(app_user_profile)을 분리했다 — "
                  "Better Auth 코어 스키마를 미리 맞춰둬 나중에 켤 수 있다.",
                  12.5, MUTED, "normal", "start", KR))
    b.append(text(44, 572,
                  "· battery_asset.version 은 낙관적 잠금용이다. 관리자 수정이 "
                  "충돌하면 VERSION_CONFLICT 로 되돌린다.",
                  12.5, MUTED, "normal", "start", KR))
    return svg(W, H, "".join(b))


def domain2():
    """② 관제·이상탐지 도메인"""
    W, H = 1360, 620
    b = []
    b.append(text(24, 34, "측정 세션이 시계열·진단·이상점수를 한데 묶는다  ·  5 테이블",
                  14, MUTED, "normal", "start", KR))

    e1, h1 = entity(24, 56, 320, "measurement_session", [
        ("id", "PK"), ("battery_id", "FK"), ("owner_user_id", "FK"),
        ("device_id", "FK"), ("target_mode", ""), ("status", ""),
        ("started_at / ended_at", "")], C_OPS)
    e2, h2 = entity(384, 56, 320, "telemetry_metric", [
        ("device_id", "PK"), ("measured_at", "PK"), ("session_id", "FK"),
        ("battery_id", "FK"), ("voltage/current/power", ""),
        ("temp_contact / ir", ""), ("soc_pct / soc_basis", ""),
        ("mode · age_ms · temp_pts", "")], C_OPS)
    e3, h3 = entity(744, 56, 320, "anomaly_score", [
        ("device_id", "PK"), ("evaluated_at", "PK"), ("battery_id", "FK"),
        ("session_id", "FK"), ("score", ""), ("ae_score", ""),
        ("informer_score", ""), ("contributions", "")], C_OPS)
    e4, h4 = entity(1104, 56, 232, "diagnosis", [
        ("id", "PK"), ("battery_id", "FK"), ("session_id", "FK"),
        ("kind", ""), ("status", ""), ("input / result", "")], C_OPS)
    e5, h5 = entity(384, 330, 320, "battery_latest", [
        ("battery_id", "PK/FK"), ("measured_at", ""), ("voltage/current/power", ""),
        ("soc_pct", ""), ("score / evaluated_at", "")], C_OPS)
    b += [e1, e2, e3, e4, e5]

    b.append(line(344, 56 + HEAD + 30, 384, 56 + HEAD + 30, C_OPS, 2))
    b.append(line(704, 56 + HEAD + 30, 744, 56 + HEAD + 30, C_OPS, 2))
    b.append(line(1064, 56 + HEAD + 30, 1104, 56 + HEAD + 30, C_OPS, 2))

    b.append(rect(744, 330, 592, 128, "#eef2ff", C_OPS, 8, 1.6))
    b.append(text(768, 356, "TimescaleDB 하이퍼테이블 2개", 14, C_OPS, "bold",
                  "start", KR))
    for i, s in enumerate([
            "telemetry_metric · anomaly_score — 1일 청크 · 보존 60일",
            "PK 를 (device_id, measured_at) 자연키로 바꿨다 —",
            "Consumer 가 on conflict do nothing 으로 멱등 적재한다",
            "진단기 1대 × 10 rows/s ≈ 86만 행/일 ≈ 130MB/일"]):
        b.append(text(768, 382 + i * 20, "· " + s, 12, MUTED, "normal", "start", KR))

    b.append(rect(24, 480, 1312, 112, "#f9fafb", LINE, 8))
    b.append(text(44, 506, "설계 포인트", 13, INK, "bold", "start", KR))
    b.append(text(44, 530,
                  "· ACTIVE 세션은 설비 전체에 1개다 — 부분 유니크 인덱스로 강제한다"
                  " (BQ27441 I2C 주소 고정이라 동시 측정 불가).",
                  12.5, MUTED, "normal", "start", KR))
    b.append(text(44, 552,
                  "· anomaly_score 에 grade 컬럼을 두지 않았다. 등급은 0.3/0.6/0.8 "
                  "임계로 서버가 계산한다 — 저장하면 점수와 어긋난다.",
                  12.5, MUTED, "normal", "start", KR))
    b.append(text(44, 574,
                  "· battery_latest 를 자산표에 합치지 않았다. 초당 10회 갱신이 "
                  "version 낙관적 잠금과 충돌하기 때문이다.",
                  12.5, MUTED, "normal", "start", KR))
    return svg(W, H, "".join(b))


def domain3():
    """③ 운영·인프라 도메인"""
    W, H = 1360, 620
    b = []
    b.append(text(24, 34, "제어 상태·건강도·감사, 그리고 발행 원자성  ·  5 테이블",
                  14, MUTED, "normal", "start", KR))

    e1, h1 = entity(24, 56, 320, "relay_state", [
        ("battery_id", "PK/FK"), ("state", ""), ("interlock_engaged", ""),
        ("interlock_condition", ""), ("reason_code", ""), ("reason_params", ""),
        ("changed_at / by", "")], C_INFRA)
    e2, h2 = entity(384, 56, 320, "battery_health", [
        ("battery_id", "PK/FK"), ("design_capacity_mah", ""),
        ("full_charge_capacity_mah", ""), ("cycle_count", ""),
        ("rul_cycles", ""), ("internal_resistance_mohm", ""),
        ("calculated_at", "")], C_INFRA)
    e3, h3 = entity(744, 56, 300, "audit_log", [
        ("id", "PK"), ("actor_user_id", "FK"), ("action", ""), ("resource", ""),
        ("result", ""), ("ip_address", ""), ("created_at", "")], C_INFRA)
    e4, h4 = entity(1084, 56, 252, "outbox", [
        ("id", "PK"), ("topic", ""), ("partition_key", ""), ("payload", ""),
        ("sent_at", ""), ("attempts", "")], C_INFRA)
    e5, h5 = entity(1084, 320, 252, "idempotency_key", [
        ("actor_user_id", "PK"), ("key", "PK"), ("request_hash", ""),
        ("status", ""), ("response", "")], C_INFRA)
    b += [e1, e2, e3, e4, e5]

    b.append(rect(24, 320, 1012, 148, "#fffbeb", C_INFRA, 8, 1.6))
    b.append(text(48, 348, "outbox 가 있는 이유 — dual-write 원자성", 14, C_INFRA,
                  "bold", "start", KR))
    for i, s in enumerate([
            "\"DB 커밋 → 그 다음 Kafka 발행\" 순서는 브로커가 죽어 있으면",
            "DB 의 릴레이 상태만 바뀌고 에지는 영영 모르는 상태를 만든다.",
            "도메인 트랜잭션 안에서 outbox 에 INSERT 하고, 별도 워커가",
            "발행한 뒤 sent_at 을 채운다. 미발행분은 부분 인덱스로 찾는다."]):
        b.append(text(48, 376 + i * 22, "· " + s, 12.5, MUTED, "normal", "start", KR))

    b.append(rect(24, 490, 1312, 102, "#f9fafb", LINE, 8))
    b.append(text(44, 516, "설계 포인트", 13, INK, "bold", "start", KR))
    b.append(text(44, 540,
                  "· relay_state 는 이력이 아니라 배터리당 1행 현재 상태다. "
                  "reason_code 는 코드만 싣는다 — 파이가 코드로 음성을 고른다.",
                  12.5, MUTED, "normal", "start", KR))
    b.append(text(44, 562,
                  "· battery_health 는 모드 1 전용이다. 모드 2 는 내부 BMS 에 못 "
                  "닿아 사이클·RUL·내부저항이 null 확정이다.",
                  12.5, MUTED, "normal", "start", KR))
    return svg(W, H, "".join(b))


def overview():
    """④ ERD 전체 — 14 테이블 · 16 FK"""
    W, H = 1360, 760
    b = []
    b.append(text(24, 34, "backend/migrations/000~005.sql 기준", 14, MUTED,
                  "normal", "start", KR))

    groups = [
        ("인증·자산", C_AUTH, 24, ['"user"', "app_user_profile", "device",
                                 "battery_asset"]),
        ("관제·이상탐지", C_OPS, 470, ["measurement_session", "telemetry_metric ▲",
                                  "anomaly_score ▲", "diagnosis", "battery_latest"]),
        ("운영·인프라", C_INFRA, 916, ["relay_state", "battery_health", "audit_log",
                                   "outbox", "idempotency_key"]),
    ]
    for title, col, x, names in groups:
        b.append(rect(x, 64, 420, 330, "#ffffff", col, 10, 2))
        b.append(rect(x, 64, 420, 34, col, col, 10, 0))
        b.append(rect(x, 64 + 24, 420, 10, col, col, 0, 0))
        b.append(text(x + 210, 87, title, 14.5, "#ffffff", "bold", "middle", KR))
        for i, n in enumerate(names):
            yy = 116 + i * 52
            b.append(rect(x + 20, yy, 380, 40, "#f9fafb", col, 6, 1.4))
            b.append(text(x + 36, yy + 25, n, 14, INK, "bold", "start", MONO))
    b.append(text(24, 422, "▲ = TimescaleDB 하이퍼테이블 (1일 청크 · 보존 60일)",
                  12.5, C_OPS, "bold", "start", KR))

    b.append(rect(24, 470, 1312, 128, "#f9fafb", LINE, 8))
    b.append(text(44, 496, "FK 16개 — 모든 관계가 3개 축으로 모인다", 14, INK,
                  "bold", "start", KR))
    axes = [
        ('"user".id', "5", "app_user_profile · audit_log · battery_asset · "
                           "measurement_session · device"),
        ("battery_asset.id", "6", "measurement_session · telemetry_metric · diagnosis · "
                                  "anomaly_score · battery_latest · battery_health"),
        ("measurement_session.id", "4", "telemetry_metric · diagnosis · anomaly_score"),
        ("device.id", "1", "measurement_session"),
    ]
    for i, (k, n, v) in enumerate(axes):
        yy = 522 + i * 20
        b.append(text(44, yy, k, 12.5, INK, "bold", "start", MONO))
        b.append(text(240, yy, "← " + n + "개", 12, C_OPS, "bold", "start", MONO))
        b.append(text(310, yy, v, 11.5, MUTED, "normal", "start", MONO))

    b.append(rect(24, 616, 1312, 128, "#fff1f2", "#dc2626", 8, 1.6))
    b.append(text(44, 642, "이전 설계에서 바뀐 것", 14, "#dc2626", "bold", "start", KR))
    for i, s in enumerate([
            "빠짐 4 — notification · threshold_setting · calibration_history · notice "
            "(백엔드 스키마에 없다)",
            "추가 5 — diagnosis · battery_latest · battery_health · outbox · "
            "idempotency_key",
            "이름·구조 변경 4 — user_info → \"user\"+app_user_profile · device_info → "
            "device · sensor_metric → telemetry_metric · anomaly_event → anomaly_score",
            "relay_control_log → relay_state — 이력 테이블에서 배터리당 1행 현재 상태로"]):
        b.append(text(44, 668 + i * 20, "· " + s, 11.5, MUTED, "normal", "start", KR))
    return svg(W, H, "".join(b))


def main():
    for name, fn in (("erd1_auth", domain1), ("erd2_ops", domain2),
                     ("erd3_infra", domain3), ("erd4_overview", overview)):
        p = os.path.join(HERE, name + ".svg")
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(fn())
        print("  %s.svg" % name)


if __name__ == "__main__":
    main()
