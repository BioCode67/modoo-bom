"""정부24 발급 결과 창 선택(_pick_result_page) — 여정 공유 세션의 '문서 뒤바뀜 + false success' 회귀 락.

배경(감사 확정 HIGH): 여정에서 이전 단계의 잔류 출력창(plus.gov.kr → 'gov.kr' 키워드 매칭)을
이번 서류의 결과로 오인해, 엉뚱한 문서를 '이 서류'로 저장하고 성공 보고하던 결함.
baseline(단계 시작 시점의 창 집합)으로 '이번 단계에서 새로 열린 창'만 결과 후보로 삼아 차단한다.

브라우저 불필요 — URL·is_closed·객체 정체성만 쓰는 순수 함수라 가짜 페이지로 결정론 검증.
"""
from rpa.gov24_rpa import _pick_result_page


class _FakePage:
    def __init__(self, url, closed=False):
        self.url = url
        self._closed = closed

    def is_closed(self):
        return self._closed


class _FakeCtx:
    def __init__(self, pages):
        self.pages = pages


def test_baseline_excludes_residual_prev_step_window():
    work = _FakePage("https://plus.gov.kr/ap/form")            # 이번 단계 작업 페이지
    residual = _FakePage("https://plus.gov.kr/ap/issDocView")  # 이전 단계 잔류 출력창(gov.kr 매칭)
    result = _FakePage("https://efamily.scourt.go.kr/pt/view")  # 이번 단계 새로 열린 결과창
    baseline = {id(work), id(residual)}
    ctx = _FakeCtx([work, residual, result])

    # baseline 없으면(구동작): 잔류 창이 'gov.kr' 키워드에 걸려 결과로 오선택 — 결함 재현
    assert _pick_result_page(ctx, work) is residual
    # baseline 있으면: 이번 단계 '새 창'만 후보 → 결과창 선택(잔류 배제)
    assert _pick_result_page(ctx, work, baseline) is result


def test_baseline_no_new_window_returns_fallback_not_residual():
    """새 창이 안 열리면(결과가 작업 페이지에 인라인 렌더) 잔류 창을 절대 고르지 않고 작업 페이지를 돌려준다."""
    work = _FakePage("https://plus.gov.kr/ap/form")
    residual = _FakePage("https://plus.gov.kr/ap/issDocView")
    baseline = {id(work), id(residual)}
    ctx = _FakeCtx([work, residual])
    assert _pick_result_page(ctx, work, baseline) is work  # fallback — 잔류(residual) 아님


def test_no_baseline_backward_compatible():
    """baseline 미지정(단독 발급 — 잔류 창 없음)에선 기존 동작 유지: 결과 키워드 창 우선, 없으면 최신."""
    work = _FakePage("https://plus.gov.kr/ap/form")
    result = _FakePage("https://plus.gov.kr/ap/mbrAplySrvcList")
    ctx = _FakeCtx([work, result])
    assert _pick_result_page(ctx, work) is result
    # 살아있는 창이 없으면 fallback
    dead = _FakePage("https://x", closed=True)
    assert _pick_result_page(_FakeCtx([dead]), work) is work
