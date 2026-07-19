import unittest

from landing_lint import LANDING_END_MARK, LANDING_START_MARK, check, landing_region


def wrap(landing_body):
    return (
        "<html>\n"
        + LANDING_START_MARK
        + "\n"
        + landing_body
        + "\n"
        + LANDING_END_MARK
        + "\n<div>앱 화면 style=\"border-radius:11px;color:#6B7280\"</div>\n</html>"
    )


CLEAN = '<div style="border-radius:12px;color:var(--ink);background:var(--surface)">셀가드</div>'


class TestLandingRegion(unittest.TestCase):
    def test_region_excludes_app_shell(self):
        region = landing_region(wrap(CLEAN))
        self.assertIn("셀가드", region)
        self.assertNotIn("앱 화면", region)


class TestCheck(unittest.TestCase):
    def test_clean_landing_passes(self):
        self.assertEqual(check(wrap(CLEAN)), [])

    def test_flags_tailwind_gray_hardcode(self):
        issues = check(wrap('<div style="color:#6B7280">가</div>'))
        self.assertTrue(any("#6B7280" in i for i in issues))

    def test_alpha_hex_not_flagged_as_banned_color(self):
        # #6B7280CC는 8자리 RGBA 알파 헥스이며 금지된 #6B7280(6자리)과는
        # 다른 색이다. 경계 검사 없이 부분 문자열로 매칭하면 오탐이 난다.
        issues = check(wrap('<div style="color:#6B7280CC">가</div>'))
        self.assertFalse(any("#6B7280" in i for i in issues))

    def test_flags_disallowed_radius(self):
        issues = check(wrap('<div style="border-radius:11px">가</div>'))
        self.assertTrue(any("11px" in i for i in issues))

    def test_allows_the_three_radii(self):
        for r in ("12px", "20px", "999px"):
            body = f'<div style="border-radius:{r}">가</div>'
            self.assertEqual(
                [i for i in check(wrap(body)) if "radius" in i], [], f"radius {r} 는 허용"
            )

    def test_flags_multivalue_radius_shorthand(self):
        # border-radius: 12px 12px 4px 4px; 처럼 다중값 축약형에서
        # 첫 토큰(12px, 허용)만 보지 말고 4px(비허용)도 잡아야 한다.
        issues = check(wrap('<div style="border-radius:12px 12px 4px 4px">가</div>'))
        self.assertTrue(any("4px" in i for i in issues))

    def test_allows_zero_radius(self):
        # 0 / 0px 는 반경 스케일 위반이 아니다 (모서리를 안 깎는 것도 유효한 값)
        for value in ("0", "0px"):
            body = f'<div style="border-radius:{value}">가</div>'
            self.assertEqual(
                [i for i in check(wrap(body)) if "radius" in i], [], f"radius {value} 는 허용"
            )

    def test_flags_dot_pattern_background(self):
        body = '<div style="background-image:radial-gradient(circle,#EEF0F3 1px,transparent 1px)">가</div>'
        issues = check(wrap(body))
        self.assertTrue(any("도트" in i for i in issues))

    def test_flags_emoji_icon(self):
        issues = check(wrap("<div>🔥 위험</div>"))
        self.assertTrue(any("이모지" in i for i in issues))

    def test_flags_trusted_in_the_field_section(self):
        issues = check(wrap('<section>TRUSTED IN THE FIELD</section>'))
        self.assertTrue(any("STATS" in i for i in issues))

    def test_clean_landing_has_no_stats_violation(self):
        issues = check(wrap(CLEAN))
        self.assertFalse(any("STATS" in i for i in issues))

    def test_flags_fabricated_metric_labels(self):
        # STATS 섹션을 제거한 근거(실제 운영 배포가 없는데 지어낸 수치)는
        # 같은 문구를 쓰는 CTA 통계 행에도 적용된다. 이 지표 라벨이 다시
        # 유입되면 잡아야 한다.
        for label in ("관제 가동률", "모니터링 중 배터리", "오늘 안전 차단"):
            body = f'<div>{label}</div>'
            issues = check(wrap(body))
            self.assertTrue(
                any("지어낸" in i for i in issues), f"'{label}' 는 지어낸 지표로 잡혀야 한다"
            )

    def test_clean_landing_has_no_fabricated_metric_violation(self):
        issues = check(wrap(CLEAN))
        self.assertFalse(any("지어낸 지표" in i for i in issues))

    def test_app_shell_violations_are_ignored(self):
        # wrap()이 SIGNUP 마커 뒤(앱 화면 구간)에 실제로 위반을 심어둔다는
        # 것을 먼저 확인하고, 그럼에도 check()가 이를 보고하지 않아야
        # 스코프 격리가 검증된다. (단순히 CLEAN만 검사하는 것과는 다르다 —
        # 그 경우는 test_clean_landing_passes가 이미 담당한다.)
        doc = wrap(CLEAN)
        self.assertIn("#6B7280", doc)
        self.assertIn("border-radius:11px", doc)
        self.assertEqual(check(doc), [])


class TestCheckRegion(unittest.TestCase):
    def test_check_region_flags_banned_color(self):
        from landing_lint import check_region
        issues = check_region('<div style="color:#6B7280">가</div>')
        self.assertTrue(any("#6B7280" in i for i in issues))

    def test_check_region_clean_passes(self):
        from landing_lint import check_region
        self.assertEqual(check_region('<div style="color:var(--ink)">가</div>'), [])

    def test_app_region_extracts_after_signup(self):
        from landing_lint import app_region, LANDING_START_MARK, SIGNUP_MARK
        doc = (
            LANDING_START_MARK + "\n<div>랜딩</div>\n"
            + SIGNUP_MARK + "\n<div>앱화면</div>\n"
        )
        region = app_region(doc)
        self.assertIn("앱화면", region)
        self.assertNotIn("랜딩", region)

    def test_check_uses_check_region(self):
        # 기존 check(랜딩)은 여전히 동작해야 한다(하위호환)
        from landing_lint import check, LANDING_START_MARK, LANDING_END_MARK
        doc = LANDING_START_MARK + '\n<div style="color:#6B7280">가</div>\n' + LANDING_END_MARK
        self.assertTrue(any("#6B7280" in i for i in check(doc)))


class TestGlassMisuse(unittest.TestCase):
    def test_flags_backdrop_filter_in_body(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div style="backdrop-filter:blur(20px)">표</div>')
        self.assertTrue(any("글래스" in i for i in issues))

    def test_flags_cg_glass_class_in_body(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div class="cg-surface cg-glass">표</div>')
        self.assertTrue(any("글래스" in i for i in issues))

    def test_opaque_surface_passes(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div class="cg-surface" style="background:var(--surface)">표</div>')
        self.assertEqual(issues, [])


if __name__ == "__main__":
    unittest.main()
