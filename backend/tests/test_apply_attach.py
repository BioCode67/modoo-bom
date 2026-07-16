"""apply_rpa._auto_attach — 발급 서류 자동 첨부의 '확신 매칭' 규칙 고정.

실브라우저 없이 모의 페이지로: ① 문맥에 서류명이 있는 칸에만 첨부 ② 모호(다칸·무문맥)하면 미첨부
③ 단일칸+단일서류는 문맥 없이 첨부 ④ 같은 서류를 두 칸에 중복 첨부하지 않음.
"""
import asyncio

from rpa.apply_rpa import _auto_attach


class _El:
    def __init__(self, ctx_text: str):
        self._ctx = ctx_text
        self.files = None

    async def evaluate(self, _script):
        return self._ctx

    async def set_input_files(self, path):
        self.files = path


class _Inputs:
    def __init__(self, els):
        self._els = els
        self.first = els[0] if els else None

    async def count(self):
        return len(self._els)

    def nth(self, i):
        return self._els[i]


class _Page:
    def __init__(self, els):
        self._inputs = _Inputs(els)

    def locator(self, _sel):
        return self._inputs


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_context_match_attaches_right_slot():
    els = [_El("주민등록등본 첨부"), _El("가족관계증명서 첨부")]
    issued = [("가족관계증명서", "C:/d/가족.pdf"), ("주민등록등본", "C:/d/등본.pdf")]
    out = _run(_auto_attach(_Page(els), issued))
    assert els[0].files == "C:/d/등본.pdf"
    assert els[1].files == "C:/d/가족.pdf"
    assert len(out) == 2


def test_ambiguous_multi_slot_no_context_skips():
    els = [_El("첨부파일 1"), _El("첨부파일 2")]  # 어떤 서류 칸인지 문맥 없음
    issued = [("주민등록등본", "C:/d/등본.pdf")]
    out = _run(_auto_attach(_Page(els), issued))
    assert out == [] and els[0].files is None and els[1].files is None


def test_single_slot_single_doc_attaches():
    els = [_El("파일 선택")]
    issued = [("주민등록등본", "C:/d/등본.pdf")]
    out = _run(_auto_attach(_Page(els), issued))
    assert els[0].files == "C:/d/등본.pdf" and len(out) == 1


def test_same_doc_not_attached_twice():
    els = [_El("주민등록등본 첨부"), _El("주민등록등본 사본 첨부")]
    issued = [("주민등록등본", "C:/d/등본.pdf")]
    _run(_auto_attach(_Page(els), issued))
    assert [e.files for e in els].count("C:/d/등본.pdf") == 1


def test_applicant_name_suffix_stripped_for_match():
    """저장 표시명이 '서류명_신청인이름'이어도 폼 라벨(이름 없음)에 매칭돼 다건 자동첨부가 성립한다.
    (이름 접미를 안 떼면 '임대차계약서_홍길동' ∉ '임대차계약서'라 청년월세 4종 첨부가 전부 실패)."""
    els = [_El("임대차계약서 첨부"), _El("주민등록등본 첨부"), _El("소득금액증명 첨부")]
    issued = [
        ("임대차계약서_홍길동", "C:/d/임대.jpg"),
        ("주민등록등본_홍길동", "C:/d/등본.pdf"),
        ("소득금액증명_홍길동", "C:/d/소득.pdf"),
    ]
    out = _run(_auto_attach(_Page(els), issued, "홍길동"))
    assert els[0].files == "C:/d/임대.jpg"
    assert els[1].files == "C:/d/등본.pdf"
    assert els[2].files == "C:/d/소득.pdf"
    assert len(out) == 3


def test_name_strip_does_not_cause_wrong_slot_attach():
    """이름 접미를 떼더라도 '서류명'이 일치하지 않으면 붙이지 않는다(오첨부 방지 유지).
    단일칸+단일서류 폴백을 피하려 발급물 2종을 둔다(둘 다 이 칸과 무관)."""
    els = [_El("가족관계증명서 첨부")]  # 발급물엔 가족관계증명서가 없음
    issued = [("소득금액증명_홍길동", "C:/d/소득.pdf"), ("임대차계약서_홍길동", "C:/d/임대.jpg")]
    out = _run(_auto_attach(_Page(els), issued, "홍길동"))
    assert out == [] and els[0].files is None
