"""🔬 실패 자가 진단 — RPA가 막힌 '그 순간의 실제 화면'을 PII 없이 구조로 남긴다.

배경(2026-07-20, 사용자 지시): 개발 환경에서 실제 정부 사이트(정부24·복지로·대법원)는 조직 정책으로
차단돼(프록시 403) 개발자가 실화면을 직접 볼 수 없다. 그래서 지금까지 스크린샷+합성 폼으로 '눈 감고'
개발한 게 실기기 오류로 이어졌다. 이 모듈은 실패 시 '실제 화면의 접근성 트리·프레임·마커·시도한 셀렉터'를
파일 하나로 남겨, 사용자가 스크린샷을 100장 찍지 않아도 무엇이 왜 안 됐는지 정확히 알 수 있게 한다.

프라이버시 계약(불변): 값(이름·주민등록번호·전화 등)은 절대 담지 않는다 — 요소의 role·접근성 라벨·
채움여부·옵션 텍스트(선택지)·페이지 마커·URL(쿼리 제거)만. 값이 담길 경로 자체를 두지 않는다.
"""
import json
import re
from datetime import datetime

# 실화면의 '구조'만 읽는 수집기(값 미수집·페이지 미변형). ai_fill._COLLECT_JS와 달리 data-attr를 안 붙인다.
_STRUCT_JS = r"""() => {
  const txt = (n) => (n && (n.innerText || n.textContent) || '').replace(/\s+/g, ' ').trim();
  const accName = (el) => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    if (el.id) { try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l)) return txt(l); } catch (e) {} }
    const wl = el.closest('label'); if (wl && txt(wl)) return txt(wl);
    const row = el.closest('tr'); if (row) { const th = row.querySelector('th'); if (th && txt(th)) return txt(th); }
    const ph = el.getAttribute('placeholder'); if (ph && ph.trim()) return ph.trim();
    return '';
  };
  const roleOf = (el) => { const t = el.tagName.toLowerCase();
    if (t === 'select') return 'combobox'; if (t === 'textarea') return 'textbox';
    if (t === 'a') return 'link'; if (t === 'button') return 'button';
    if (t === 'input') { const y = (el.type || 'text').toLowerCase();
      return ({checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', tel: 'textbox', password: 'textbox', number: 'spinbutton'})[y] || 'textbox'; }
    return t; };
  const out = []; let n = 0;
  for (const el of document.querySelectorAll('input,select,textarea,button,a,[role=button],[role=checkbox],[role=radio]')) {
    const t = (el.type || el.tagName).toLowerCase();
    if (['hidden', 'image', 'file'].includes(t)) continue;
    if (el.offsetParent === null) continue;  // 보이는 것만
    const role = roleOf(el);
    const item = { role, name: accName(el).slice(0, 44) };
    if (['button', 'link'].includes(role) || ['submit', 'button'].includes(t)) {
      const b = (txt(el) || el.value || '').trim(); if (b) item.text = b.slice(0, 28);
    } else if (role === 'combobox') {
      item.filled = el.selectedIndex > 0;
      item.opts = [...el.options].slice(0, 10).map((o) => (o.text || '').trim().slice(0, 18));  // 선택지 텍스트(값 아님)
    } else {
      item.filled = !!(el.value && el.value.trim() && el.value.trim() !== '-');  // 채웠는지(불리언)만 — 값 미수집
      item.ro = !!(el.readOnly || el.disabled);
    }
    out.push(item); if (++n >= 90) break;
  }
  return out;
}"""

# 페이지에 '있으면' 상황 판단에 결정적인 마커들(존재 여부만 — 값 아님)
_MARKERS = [
    "점검", "서비스 점검", "일시 중단", "오류", "간편인증", "공동인증", "카카오", "PASS", "네이버", "토스",
    "본인인증", "인증 요청", "인증 완료", "신청하기", "발급", "출력", "인쇄", "로그인", "전체동의", "동의",
    "시도 선택", "시군구", "주민등록", "가족관계", "소득", "세대주", "대리인", "배우자", "전자문서지갑",
    "팝업", "닫기", "다음", "확인", "제출",
]


def _safe_url(u) -> str:
    """쿼리·프래그먼트 제거(인가 토큰·PII 유출 방지) — host+path만."""
    return re.sub(r"[?#].*$", "", str(u or ""))[:140]


async def capture(page, label: str = "", tried=None, note: str = "") -> dict:
    """막힌 화면을 '전 프레임'에 걸쳐 구조로 캡처 → dict(PII 없음). 프레임 접근 실패해도 부분 결과 반환.

    - label: 어느 단계에서 막혔는지(예: '등본-주소선택', '가족관계-부성명')
    - tried: 시도했던 셀렉터/전략 요약(무엇을 해봤는지 — 값 아님)
    - note: 사람용 한 줄 메모
    """
    contexts = [page] + list(getattr(page, "frames", None) or [])
    frames = []
    for i, c in enumerate(contexts[:12]):
        entry: dict = {"i": i}
        try:
            u = getattr(c, "url", "")
            entry["url"] = _safe_url(u if isinstance(u, str) else "")
        except Exception:
            entry["url"] = ""
        try:
            fields = await c.evaluate(_STRUCT_JS)
            if isinstance(fields, list):
                entry["n"] = len(fields)
                entry["fields"] = fields[:44]
            else:
                entry["n"] = 0
        except Exception as e:
            entry["fields_error"] = str(e)[:80]
        try:
            entry["markers"] = await c.evaluate(
                "(ms) => { const t = document.body ? document.body.innerText : ''; return ms.filter((m) => t.includes(m)); }",
                _MARKERS,
            )
        except Exception:
            entry["markers"] = []
        # 구조·마커·오류가 하나도 없는 빈 프레임은 생략(잡음↓)
        if entry.get("n") or entry.get("markers") or entry.get("fields_error"):
            frames.append(entry)
    return {
        "label": str(label)[:60],
        "note": str(note)[:200],
        "tried": [str(t)[:60] for t in (tried or [])][:12],
        "captured_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "frames": frames,
    }


def summarize(diag: dict) -> str:
    """진행 카드/로그용 한 줄 요약 — 어느 프레임에 칸 몇 개·어떤 마커가 있었는지."""
    bits = []
    for f in (diag.get("frames") or [])[:4]:
        mk = "·".join((f.get("markers") or [])[:4])
        bits.append(f"f{f.get('i')}:칸{f.get('n', 0)}" + (f"·{mk}" if mk else ""))
    return " | ".join(bits) or "구조 판독 없음"


def save(diag: dict, dirpath) -> str:
    """진단을 타임스탬프 JSON 파일로 저장 → 경로(str). 사용자는 이 파일 '하나만' 공유하면 된다."""
    import pathlib
    d = pathlib.Path(dirpath) / "_diagnostics"
    d.mkdir(parents=True, exist_ok=True)
    lab = re.sub(r"[^0-9A-Za-z가-힣_-]", "", str(diag.get("label") or "diag"))[:30] or "diag"
    fp = d / f"{lab}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    fp.write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(fp)
