#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
userflow.md 를 기준으로 와이어프레임 HTML(AI_배터리_열폭주_관제_시스템_v2.html)을 교정한다.

수정 항목 (계획 Phase 1):
 1. 회원가입 화면(n6) 신규 추가 + 네비 항목 추가
 2. 로그인 "계정 만들기"  n5 -> n6 (회원가입)
 3. 로그인 "계정을 찾을 수 없으신가요?"  n8 -> n5 (계정찾기)
 4. 로그인 "로그인" 버튼  n9 -> n8 (역할확인 경유)
 5. 역할확인 "대시보드로 이동"(n9) -> "디바이스로 이동"(n15)
 6. 전 화면 헤더에 로그아웃 추가 (-> n2)
 7. 대시보드(n9) -> AI 이상탐지(n23) 링크 추가
 8. 위험 등급 감지(n26) -> 자동 차단(Kill-Switch, n36) 링크 추가
 9. 모드 인터락(n17) -> 실시간 대시보드(n9) 링크 추가
10. 릴레이 차단(n36) "복구 요청" 라벨 -> "차단 요청"
11. 복구 확인(n39) "센서 수집 상태로"(n21) -> "관리자 콘솔로"(n35)

안전장치: 각 치환은 정확히 기대 횟수만큼 일어나야 하며, 아니면 AssertionError 로 중단.
"""
import re, shutil, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "AI_배터리_열폭주_관제_시스템_v2.html")
BAK = os.path.join(ROOT, "archive", "AI_배터리_열폭주_관제_시스템_v2.bak")
os.makedirs(os.path.dirname(BAK), exist_ok=True)

html = open(SRC, encoding="utf-8").read()
orig_len = len(html)

def replace_once(s, old, new, label):
    n = s.count(old)
    assert n == 1, f"[{label}] 기대 1회, 실제 {n}회: {old[:80]!r}"
    return s.replace(old, new, 1)

def section(s, pid):
    m = re.search(rf'<section[^>]*data-page-id="{pid}">.*?</section>', s, re.S)
    assert m, f"섹션 {pid} 못찾음"
    return m.group(0)

# ---------------------------------------------------------------------------
# 0) 재사용 스타일 원자(atom) 추출 (원본 인라인 스타일 그대로 사용)
# ---------------------------------------------------------------------------
FONT = "-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, sans-serif"

n2 = section(html, "n2")
n5 = section(html, "n5")

# renderer wrapper 시작 태그 (section -> align wrapper -> wf-renderer)
m = re.search(r'(<section hidden data-page-id="n5"><div style="[^"]*"><div class="wf-renderer" style="[^"]*">)', html)
assert m, "n5 wrapper 추출 실패"
n5_wrapper_open = m.group(1)
renderer_open = n5_wrapper_open.replace('data-page-id="n5"', 'data-page-id="n6"')

# 헤더 블록 (sticky top header, 아바타 포함) — 로그아웃 주입 전 원본
m = re.search(r'(<div style="display:flex;align-items:center;gap:16px;padding:12px 24px;background:#fff;border-bottom:1px solid #d0d0d0;flex-shrink:0;position:sticky;top:0;z-index:10">.*?사용</div></div>)', n2, re.S)
assert m, "헤더 블록 추출 실패"
header_block = m.group(1)

# 사이드바(메뉴) 블록
m = re.search(r'(<div style="width:240px;flex-shrink:0;background:#f5f5f5;border-right:1px solid #d0d0d0;.*?관리자</span></div>)', n2, re.S)
assert m, "사이드바 블록 추출 실패"
sidebar_block = m.group(1)

# 콘텐츠 영역 래퍼(우측 본문) 시작 div
content_open = '<div style="flex:1;min-width:0;padding:24px;display:flex;flex-direction:column;gap:16px;overflow:auto">'
assert content_open in n2

# 제목 span 스타일
title_style = f"font-size:16px;font-weight:600;color:#333;font-family:{FONT};display:block"
# 라벨 div 스타일
label_style = f"font-size:14px;font-weight:400;color:#333;font-family:{FONT};line-height:1.5"
# input 스타일 (로그인에서 그대로)
m = re.search(r'(<input type="text" placeholder="" style="[^"]*"/>)', n2)
assert m, "input 추출 실패"
input_atom = m.group(1)
# primary 버튼 스타일 (로그인 버튼에서 추출)
m = re.search(r'<div class="wf-clickable" data-wf-action="n9" style="([^"]*)">로그인</div>', n2)
assert m, "primary 버튼 스타일 추출 실패"
primary_btn_style = m.group(1)
# 링크 span 스타일 (계정 만들기 등)
m = re.search(r'<span class="wf-clickable" data-wf-action="n5" style="([^"]*)">계정 만들기</span>', n2)
assert m, "링크 스타일 추출 실패"
link_style = m.group(1)
helper_style = f"font-size:12px;color:#999;font-family:{FONT};display:block"

# ---------------------------------------------------------------------------
# 1) 로그아웃 전역 주입 (아바타 헤더 31개 일괄)
# ---------------------------------------------------------------------------
avatar = '<div style="width:32px;height:32px;border-radius:50%;background:#f5f5f5;color:#666;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;flex-shrink:0;overflow:hidden">사용</div>'
logout_span = (f'<span class="wf-clickable" data-wf-action="n2" style="font-size:13px;color:#666;'
               f'cursor:pointer;font-family:{FONT};margin-right:4px;font-weight:500">로그아웃</span>')
cnt = html.count(avatar)
assert cnt == 31, f"아바타 헤더 기대 31회, 실제 {cnt}회"
html = html.replace(avatar, logout_span + avatar)
print(f"[1] 로그아웃 주입: {cnt}개 헤더")

# 주입 후 헤더 블록(로그아웃 포함) — 회원가입 섹션에서 재사용
header_block_logout = re.search(
    r'(<div style="display:flex;align-items:center;gap:16px;padding:12px 24px;background:#fff;border-bottom:1px solid #d0d0d0;flex-shrink:0;position:sticky;top:0;z-index:10">.*?사용</div></div>)',
    section(html, "n2"), re.S).group(1)

# ---------------------------------------------------------------------------
# 2~5) 로그인 / 역할확인 액션 재배선
# ---------------------------------------------------------------------------
# 2) 계정 만들기 n5 -> n6
html = replace_once(html,
    '<span class="wf-clickable" data-wf-action="n5" style="'+link_style+'">계정 만들기</span>',
    '<span class="wf-clickable" data-wf-action="n6" style="'+link_style+'">계정 만들기</span>',
    "계정만들기→n6")
print("[2] 계정 만들기 → 회원가입(n6)")

# 3) 계정을 찾을 수 없으신가요? n8 -> n5
m = re.search(r'<span class="wf-clickable" data-wf-action="n8" style="([^"]*)">계정을 찾을 수 없으신가요\?</span>', html)
assert m, "계정 못찾음 앵커 실패"
html = replace_once(html, m.group(0),
    m.group(0).replace('data-wf-action="n8"', 'data-wf-action="n5"'),
    "계정못찾음→n5")
print("[3] 계정을 찾을 수 없으신가요? → 계정찾기(n5)")

# 4) 로그인 버튼 n9 -> n8
html = replace_once(html,
    '<div class="wf-clickable" data-wf-action="n9" style="'+primary_btn_style+'">로그인</div>',
    '<div class="wf-clickable" data-wf-action="n8" style="'+primary_btn_style+'">로그인</div>',
    "로그인버튼→n8")
print("[4] 로그인 버튼 → 역할확인(n8)")

# 5) 역할확인(n8) "대시보드로 이동"(n9) -> "디바이스로 이동"(n15)
m = re.search(r'(<[^>]*class="wf-clickable" data-wf-action="n9"[^>]*>)대시보드로 이동(</[a-z]+>)', html)
assert m, "역할확인 '대시보드로 이동' 앵커 실패"
html = replace_once(html, m.group(0),
    m.group(1).replace('data-wf-action="n9"', 'data-wf-action="n15"') + "디바이스로 이동" + m.group(2),
    "역할확인→디바이스")
print("[5] 역할확인 '대시보드로 이동' → '디바이스로 이동'(n15)")

# ---------------------------------------------------------------------------
# 6) 회원가입 섹션(n6) 생성 + 네비 항목 추가
# ---------------------------------------------------------------------------
def field(label):
    return (f'<div style="display:flex;flex-direction:column;gap:8px">'
            f'<div style="{label_style}">{label}</div>{input_atom}</div>')

signup_content = (
    f'<span style="{title_style}">회원가입</span>'
    f'<div style="display:flex;flex-direction:column;max-width:100%;box-sizing:border-box;gap:24px;width:400px;flex:0 1 auto;min-width:0">'
    f'<div style="display:flex;flex-direction:column;max-width:100%;box-sizing:border-box;gap:12px">'
    + field("이메일") + field("사용자명") + field("비밀번호") + field("비밀번호 확인")
    + f'<div class="wf-clickable" data-wf-action="n2" style="{primary_btn_style}">회원가입</div>'
    + f'</div>'
    + f'<span style="{helper_style}">가입 완료 후 로그인 화면으로 이동합니다</span>'
    + f'<div style="display:flex;flex-direction:column;max-width:100%;box-sizing:border-box;gap:12px;align-items:stretch">'
    + f'<span class="wf-clickable" data-wf-action="n2" style="{link_style}">로그인으로 돌아가기</span></div>'
    + f'</div>'
)

signup_section = (
    renderer_open
    + header_block_logout
    + '<div style="display:flex;flex-direction:row;flex:1;min-height:0">'
    + sidebar_block
    + content_open + signup_content + '</div>'  # close content area
    + '</div>'   # close flex-row
    + '</div>'   # close wf-renderer
    + '</div>'   # close align wrapper
    + '</section>'
)

# 로그인 섹션 바로 뒤에 삽입
login_section = section(html, "n2")
html = replace_once(html, login_section, login_section + "\n" + signup_section, "회원가입 섹션 삽입")
print("[6] 회원가입 섹션(n6) 삽입")

# 네비 항목: 로그인 다음에 회원가입 추가
login_nav = '<button type="button" class="wf-pagelist-item" data-wf-action="n2" data-wf-nav-id="n2" data-active><span class="wf-pagelist-num">1</span><span class="wf-pagelist-name">로그인 화면</span></button>'
signup_nav = '<button type="button" class="wf-pagelist-item" data-wf-action="n6" data-wf-nav-id="n6"><span class="wf-pagelist-num">2</span><span class="wf-pagelist-name">회원가입</span></button>'
html = replace_once(html, login_nav, login_nav + signup_nav, "네비 회원가입 추가")

# 네비 번호 재정렬
nums = re.findall(r'<span class="wf-pagelist-num">\d+</span>', html)
def renum():
    cnt = {"i": 0}
    def repl(m):
        cnt["i"] += 1
        return f'<span class="wf-pagelist-num">{cnt["i"]}</span>'
    return repl
html = re.sub(r'<span class="wf-pagelist-num">\d+</span>', renum(), html)
# 카운트 배지도 +1
html = re.sub(r'(<span class="wf-pagelist-count">)31(</span>)', r'\g<1>32\g<2>', html)
total_nav = len(re.findall(r'<span class="wf-pagelist-num">\d+</span>', html))
print(f"[6] 네비 항목 추가 + 번호 재정렬 ({total_nav}개)")

# ---------------------------------------------------------------------------
# 7~12) 신규 링크 추가 / 라벨 정정 (대상 섹션 내 기존 앵커 클론)
# ---------------------------------------------------------------------------
def clone_link_after(pid, new_label, new_target, tag_label):
    """대상 섹션의 (메뉴가 아닌) 마지막 클릭 앵커를 클론해 라벨/타겟 교체 후 그 뒤에 삽입."""
    global html
    sec = section(html, pid)
    # 메뉴(대시보드/디바이스/알림/관리자) 제외한 액션 앵커들
    anchors = re.findall(r'<(?:div|span) class="wf-clickable" data-wf-action="n\d+" style="[^"]*">[^<]*</(?:div|span)>', sec)
    anchors = [a for a in anchors if re.search(r'>(대시보드|디바이스|알림|관리자)</', a) is None]
    assert anchors, f"[{tag_label}] {pid} 클론할 앵커 없음"
    base = anchors[-1]
    new = re.sub(r'data-wf-action="n\d+"', f'data-wf-action="{new_target}"', base)
    new = re.sub(r'>([^<]*)</', f'>{new_label}</', new)
    new_sec = replace_once(sec, base, base + new, f"{tag_label} 클론")
    html = replace_once(html, sec, new_sec, f"{tag_label} 섹션반영")
    print(f"[{tag_label}] {pid} → {new_label}({new_target})")

clone_link_after("n9",  "AI 이상탐지", "n23", "7")    # 대시보드 → 이상탐지관리
clone_link_after("n26", "자동 차단(Kill-Switch)", "n36", "8")  # 위험감지 → 자동차단
clone_link_after("n17", "실시간 대시보드로", "n9", "9")  # 모드인터락 → 대시보드

# 10) 릴레이 차단(n36) "복구 요청" 라벨 -> "차단 요청"
m = re.search(r'(<[^>]*class="wf-clickable" data-wf-action="n37"[^>]*>)복구 요청(</[a-z]+>)', html)
assert m, "릴레이차단 '복구 요청' 라벨 실패"
html = replace_once(html, m.group(0), m.group(1) + "차단 요청" + m.group(2), "10 라벨정정")
print("[10] 릴레이 차단 '복구 요청' → '차단 요청'")

# 12) (드롭) 복구확인(n39) '센서 수집 상태로' 정리는 "센서 수집 상태로" 라벨이
#     여러 화면(n22 수집오류 복귀 등)에 중복되어 오작동 위험이 커서 진행하지 않음.
#     n39 는 이미 "이전으로"(n38) 복귀 경로가 있어 userflow 위반 아님.

# ---------------------------------------------------------------------------
# 저장
# ---------------------------------------------------------------------------
shutil.copyfile(SRC, BAK)
open(SRC, "w", encoding="utf-8").write(html)
print(f"\n완료: {SRC} (백업 {BAK})  길이 {orig_len} -> {len(html)}")
