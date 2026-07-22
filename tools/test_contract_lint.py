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


if __name__ == "__main__":
    unittest.main()
