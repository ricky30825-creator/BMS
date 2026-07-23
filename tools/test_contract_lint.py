import unittest

from contract_lint import lint


class TestForbiddenVocab(unittest.TestCase):
    def test_flags_widget_word(self):
        text = "## F1. 랜딩\n연결 확인 모달을 연다.\n"
        self.assertTrue(any("모달" in v for v in lint(text)))

    def test_clean_text_has_no_vocab_violation(self):
        text = "## F1. 랜딩\n현재 맥락을 잃지 않고 확인한다.\n"
        self.assertFalse(any("금지 어휘" in v for v in lint(text)))


class TestAreaCoverage(unittest.TestCase):
    def test_flags_missing_area(self):
        text = "### F1. 랜딩\n"
        self.assertTrue(any("영역 누락" in v for v in lint(text)))

    def test_flags_f5_present(self):
        text = "### F5. 디바이스 상태\n"
        self.assertTrue(any("F5" in v for v in lint(text)))


class TestReqCoverage(unittest.TestCase):
    def test_flags_deleted_req_069(self):
        text = "**추적** — REQ-WEB-069\n"
        self.assertTrue(any("069" in v for v in lint(text)))

    def test_flags_uncited_req(self):
        text = "**추적** — REQ-WEB-001\n"
        self.assertTrue(any("미인용 REQ" in v for v in lint(text)))


class TestGateMarkers(unittest.TestCase):
    def test_flags_missing_gates(self):
        text = "## T1. 가입\n1. 가입한다\n"
        self.assertTrue(any("게이트" in v for v in lint(text)))


class TestSectionSchema(unittest.TestCase):
    def test_flags_area_missing_required_heading(self):
        text = "### F1. 랜딩\n**목적** — 소개한다.\n"
        self.assertTrue(any("필수 항목 누락" in v for v in lint(text)))


class TestExemptSections(unittest.TestCase):
    """금지 대상을 이름으로 지목해야 하는 절은 어휘 검사에서 뺀다."""

    def test_exempts_prohibition_list(self):
        text = "### 하지 말 것\n- 메뉴 접기를 쓰지 않는다\n\n---\n"
        self.assertFalse(any("접기" in v for v in lint(text)))

    def test_exempts_appendix_b(self):
        text = "## 부록 B. 계약서에서 제외한 요구사항\n메뉴 접기·펼치기\n"
        self.assertFalse(any("접기" in v for v in lint(text)))

    def test_still_flags_vocab_outside_exempt_sections(self):
        text = "### F1. 랜딩\n메뉴 접기를 제공한다.\n\n### 하지 말 것\n- 없음\n\n---\n"
        self.assertTrue(any("접기" in v for v in lint(text)))

    def test_appendix_b_does_not_swallow_following_section(self):
        """부록 B 뒤에 오는 실제 조항까지 예외 처리되면 안 된다."""
        text = (
            "## 부록 B. 계약서에서 제외한 요구사항\n"
            "메뉴 접기·펼치기\n"
            "\n"
            "## 부록 C. 실제로 남는 조항\n"
            "메뉴 접기를 제공한다.\n"
        )
        self.assertTrue(any("접기" in v for v in lint(text)))

    def test_closed_prohibition_list_does_not_swallow_following_prose(self):
        """'하지 말 것' 절이 '---'로 곧바로 닫히면, 그 뒤에 오는 일반
        조항까지 예외로 삼켜서는 안 된다."""
        text = (
            "### 하지 말 것\n"
            "- 접기를 쓰지 않는다\n"
            "\n"
            "---\n"
            "\n"
            "이 영역은 메뉴 접기 구조를 제공한다.\n"
            "\n"
            "### F1. 랜딩\n내용\n"
        )
        self.assertTrue(any("접기" in v for v in lint(text)))

    def test_prohibition_list_itself_still_exempt(self):
        """'하지 말 것' 목록 안의 금지 어휘는 여전히 검사에서 빠져야 한다."""
        text = "### 하지 말 것\n- 메뉴 접기를 쓰지 않는다\n\n---\n\n### F1. 랜딩\n내용\n"
        self.assertFalse(any("접기" in v for v in lint(text)))

    def test_unclosed_prohibition_list_does_not_swallow_until_distant_dashes(self):
        """'하지 말 것' 절이 즉시 '---'로 닫히지 않으면, 다음 헤딩부터는
        더 이상 예외가 아니어야 한다."""
        text = (
            "### 하지 말 것\n"
            "- 메뉴 접기를 쓰지 않는다\n"
            "\n"
            "### F1. 실제 영역\n"
            "메뉴 접기를 제공한다.\n"
            "\n"
            "안내문이 길게 이어진다.\n"
            "\n"
            "---\n"
        )
        self.assertTrue(any("접기" in v for v in lint(text)))


class TestLegendCheckDoesNotShadow(unittest.TestCase):
    """게이지 범례 검사는 문서 전체를 봐야 하며, 루프의 마지막 영역
    본문으로 좁혀지면 안 된다."""

    def test_flags_legend_outside_any_area(self):
        text = (
            "0-39 정상\n40-69 주의\n70+ 위험\n"
            "\n"
            "### F1. 랜딩\n내용\n"
            "\n"
            "### F2. 이력\n다른내용\n"
        )
        self.assertTrue(any("게이지 범례" in v for v in lint(text)))

    def test_flags_legend_in_non_last_area(self):
        text = (
            "### F1. 랜딩\n0-39 정상 40-69 주의 70+ 위험\n"
            "\n"
            "### F2. 이력\n다른내용\n"
        )
        self.assertTrue(any("게이지 범례" in v for v in lint(text)))


if __name__ == "__main__":
    unittest.main()


class TestExcludedReqs(unittest.TestCase):
    """범위에서 제외된 요구사항은 본문이 인용하면 안 되고, 부록 B에서만 언급할 수 있다."""

    def test_flags_excluded_req_in_body(self):
        text = "### F1. 랜딩\n**추적** — REQ-WEB-071\n"
        self.assertTrue(any("REQ-WEB-071" in v and "제외" in v for v in lint(text)))

    def test_allows_excluded_req_in_appendix_b(self):
        text = "## 부록 B. 계약서에서 제외한 요구사항\nREQ-WEB-071 캘리브레이션 이력\n"
        self.assertFalse(any("제외된 기능" in v for v in lint(text)))

    def test_excluded_reqs_are_not_expected(self):
        from contract_lint import EXCLUDED_REQS, EXPECTED_REQS
        self.assertEqual(len(EXPECTED_REQS), 103)
        self.assertFalse(EXPECTED_REQS & EXCLUDED_REQS)
