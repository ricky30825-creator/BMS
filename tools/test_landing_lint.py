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

    def test_flags_disallowed_radius(self):
        issues = check(wrap('<div style="border-radius:11px">가</div>'))
        self.assertTrue(any("11px" in i for i in issues))

    def test_allows_the_three_radii(self):
        for r in ("12px", "20px", "999px"):
            body = f'<div style="border-radius:{r}">가</div>'
            self.assertEqual(
                [i for i in check(wrap(body)) if "radius" in i], [], f"radius {r} 는 허용"
            )

    def test_flags_dot_pattern_background(self):
        body = '<div style="background-image:radial-gradient(circle,#EEF0F3 1px,transparent 1px)">가</div>'
        issues = check(wrap(body))
        self.assertTrue(any("도트" in i for i in issues))

    def test_flags_emoji_icon(self):
        issues = check(wrap("<div>🔥 위험</div>"))
        self.assertTrue(any("이모지" in i for i in issues))

    def test_app_shell_violations_are_ignored(self):
        # 랜딩 밖의 #6B7280 / radius:11px 는 이번 범위가 아니다
        self.assertEqual(check(wrap(CLEAN)), [])


if __name__ == "__main__":
    unittest.main()
