# -*- coding: utf-8 -*-
"""정부24 자동발급 커버리지 실측 프로브 — 코어 로직(CLI·앱 내 API 공용).

왜 rpa/ 안에 있나: 데스크탑앱(local_server)이 '앱 안에서' 서류명 하나로 실측 확인→β 등록을
하려면 이 로직이 PyInstaller 번들에 포함되는 rpa 패키지에 있어야 한다(tools/ 는 번들 밖).
CLI(tools/probe_gov24_docs.py)는 이 모듈을 감싸는 얇은 래퍼다.

정직성 원칙(날조 금지):
  · 여기서 등록되는 항목은 정부24 '실측'(검색→CappBizCD 발굴→AA020 제목·발급버튼 확인)을
    통과한 것만이다 — 코드 추측 등재 불가, 실패는 실패로 보고.
  · 등록돼도 β(첫 실발급 완주가 최종 검증) — 실패하면 정직한 오류 + 등록 해제 안내.
"""
import glob
import json
import re


def _extra_path():
    """docs_extra.json 경로 — gov24_rpa._EXTRA_DOCS_PATH 단일 소스(호출 시점 조회: 테스트 몽키패치 대응)."""
    from rpa import gov24_rpa
    return gov24_rpa._EXTRA_DOCS_PATH


def read_extra() -> list:
    p = _extra_path()
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    except Exception:
        return []


def write_extra(entries: list) -> None:
    _extra_path().write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


INFO_URL = ("https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD={code}"
            "&HighCtgCD=A01010001&tp_seq=01&Mcode=10200")
SEARCH_INPUTS = ["input[type='search']", "input[name*='srh' i]", "input[placeholder*='검색']", "#ptl-search input"]

# 서류 기본 후보 — 카탈로그 required_docs 빈도·복지 신청 통용 서류에서 선정(CLI·앱 후보 칩 공용).
# (신분증·통장사본·임대차계약서·진단서류는 실물/은행/병원 발급이라 📷 촬영·등록 경로가 정답 — 후보 제외)
DEFAULT_DOC_CANDIDATES = [
    "혼인관계증명서",
    "기본증명서",
    "입양관계증명서",
    "의료급여증",
    "차상위계층 확인서",
    "장기요양인정서",
    "국민연금 가입자 가입증명",
    "재학증명서",
    "사업자등록증명",
    # 주거급여·이사(전입 확인) + 학생·청년 장학 서류 — 실측 통과분만 등록된다
    "전입세대확인서",
    "졸업증명서",
]


def _launch_sync(p):
    """발급 RPA와 같은 우선순위(Chrome→Edge→번들 Chromium)로 첫 성공 브라우저 반환.
    (과거 프로브는 번들 Chromium 전용이라 playwright install 안 된 실사용 PC에서 실패 — 폴백으로 수정)"""
    from rpa.base import _browser_candidates
    tried, last = [], None
    for ch in _browser_candidates():
        opts: dict = {"headless": True}
        if ch:
            opts["channel"] = ch
        else:
            opts["args"] = ["--no-sandbox"]  # 번들 Chromium 한정(발급 RPA와 동일 원칙)
            exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
            if exe:
                opts["executable_path"] = exe[0]
        try:
            return p.chromium.launch(**opts)
        except Exception as e:
            last = e
            tried.append(ch or "chromium(번들)")
    raise RuntimeError(f"브라우저를 실행할 수 없어요(시도: {', '.join(tried)}) — Chrome/Edge 설치 또는 playwright install chromium ({str(last)[:80]})")


def probe_names(names: list):
    """정부24에서 서류명별 CappBizCD 발굴 + AA020 검증. → (rows, None) 또는 (None, 오류문구).

    row: {name, code, title, issue_btn, verdict, note} — verdict '✅ …'만 등록 대상.
    """
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as p:
        try:
            browser = _launch_sync(p)
        except Exception as e:
            return None, str(e)
        pg = browser.new_page()
        try:
            pg.goto("https://www.gov.kr/", wait_until="domcontentloaded", timeout=20000)
        except Exception as e:
            browser.close()
            return None, f"정부24 접속 실패: {str(e)[:120]} — 인터넷 되는 PC에서 실행하세요(개발 컨테이너는 정부망 차단)."
        for name in names:
            row = {"name": name, "code": "", "title": "", "issue_btn": False, "verdict": "❌ 미발견", "note": ""}
            try:
                # ① 검색창에 서류명 입력(선택자 후보 순회 — 사이트 개편 시 note로 정직 보고)
                box = None
                for sel in SEARCH_INPUTS:
                    loc = pg.locator(sel).first
                    if loc.count() and loc.is_visible():
                        box = loc
                        break
                if box is None:
                    row["note"] = "검색창을 못 찾음(사이트 개편?) — SEARCH_INPUTS 선택자 보강 필요"
                    rows.append(row)
                    continue
                box.fill(name)
                box.press("Enter")
                pg.wait_for_timeout(2500)
                # ② 결과에서 민원 안내 링크의 CappBizCD 수집
                hrefs = pg.eval_on_selector_all(
                    "a[href*='CappBizCD'], a[href*='cappBizCd']",
                    "els => els.map(a => ({href: a.href, text: (a.textContent||'').trim()}))")
                cands = []
                for a in hrefs:
                    m = re.search(r"[Cc]app[Bb]iz[Cc][Dd]=([0-9A-Za-z]+)", a["href"])
                    if m:
                        cands.append((m.group(1), a["text"]))
                if not cands:
                    row["note"] = "검색 결과에 민원 코드 링크 없음(민원명이 다르거나 온라인 발급 비대상일 수 있음)"
                    rows.append(row)
                    continue
                # ③ 링크 텍스트가 서류명과 가장 겹치는 후보 우선
                nn = name.replace(" ", "")
                cands.sort(key=lambda c: (nn not in c[1].replace(" ", ""), len(c[1])))
                code = cands[0][0]
                row["code"] = code
                # ④ 안내 페이지(AA020) 검증 — 제목에 서류명·'발급하기/신청하기' 버튼 존재
                pg.goto(INFO_URL.format(code=code), wait_until="domcontentloaded", timeout=20000)
                pg.wait_for_timeout(1500)
                row["title"] = (pg.title() or "").strip()[:60]
                body = pg.inner_text("body")
                row["issue_btn"] = bool(re.search(r"발급하기|신청하기", body))
                title_hit = nn in row["title"].replace(" ", "") or nn in body.replace(" ", "")[:2000]
                row["verdict"] = ("✅ 후보(코드·발급버튼 확인)" if row["issue_btn"] and title_hit
                                  else "⚠️ 확인 필요(제목/버튼 불일치)")
                # 다음 검색을 위해 메인으로
                pg.goto("https://www.gov.kr/", wait_until="domcontentloaded", timeout=20000)
            except Exception as e:
                row["note"] = f"오류: {str(e)[:100]}"
                rows.append(row)
                continue
            rows.append(row)
        browser.close()
    return rows, None


def register_rows(rows: list) -> list:
    """✅ 판정 행만 docs_extra.json 에 병합(이름 기준 갱신) → 등록된 이름 목록 반환.
    내장 서류와 겹치면 로더(gov24_rpa)가 내장을 우선한다."""
    ok_rows = [r for r in rows if str(r.get("verdict", "")).startswith("✅") and r.get("code")]
    if not ok_rows:
        return []
    entries = {e.get("name"): e for e in read_extra()}
    for r in ok_rows:
        entries[r["name"]] = {
            "name": r["name"], "code": r["code"], "title": r.get("title", ""),
            "enabled": True, "source": "probe", "note": "β — 첫 실발급 완주가 최종 검증",
        }
    write_extra(list(entries.values()))
    return [r["name"] for r in ok_rows]


def remove_names(names: list) -> int:
    """등록 해제(첫 발급 실패 시) → 제거 건수."""
    entries = read_extra()
    keep = [e for e in entries if e.get("name") not in names]
    write_extra(keep)
    return len(entries) - len(keep)


def apply_runtime_reload() -> dict:
    """등록 변경을 재시작 없이 반영 — 발급 코드맵·URL·지원목록을 즉시 갱신하고 현황 반환."""
    from rpa import gov24_rpa, manager
    gov24_rpa.reload_extra_docs()
    supported = manager.refresh_supported_docs()
    return {"supported": supported, "beta": list(gov24_rpa.EXTRA_DOC_NAMES)}


def probe_and_register(names: list) -> dict:
    """앱 내 [🔎 실측 확인] 한 번에: 실측 → ✅만 등록 → 런타임 반영. 실패는 실패로 보고(날조 금지)."""
    rows, err = probe_names(names)
    if err:
        return {"status": "error", "message": err}
    registered = register_rows(rows)
    out = {"status": "ok" if registered else "not_supported",
           "rows": [{"name": r["name"], "verdict": r["verdict"], "note": r.get("note", "")} for r in rows],
           "registered": registered}
    if registered:
        out.update(apply_runtime_reload())
    return out


# ── 자동신청(복지로) 커버리지 실측 ────────────────────────────────────────────
# 한계를 먼저(정직성, tools/probe_bokjiro_apply.py 2026-07-12 조사와 동일):
# 복지로는 비로그인 상태에서 방문형 서비스에도 '신청하기' 요소를 렌더한다. 따라서 여기서는
#   ① 서비스명 → wlfareInfoId 매핑 실측 발굴 + ② 상세 페이지가 그 서비스가 맞는지 확인
# 까지만 자동화한다 — 결과는 '후보(candidate)'이며, 온라인 신청형인지는 **첫 자동신청 실행**이
# 정직하게 판별한다(신청 버튼이 없으면 apply_rpa가 실패를 실패로 보고 → 공식 링크 폴백).
BOKJIRO_DETAIL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId={wid}"
BOKJIRO_SEARCH_INPUTS = ["input[type='search']", "input[name*='search' i]", "input[placeholder*='검색']"]


def probe_apply_names(names: list):
    """복지로에서 서비스명별 wlfareInfoId 발굴 + 상세 일치 확인. → (rows, None) 또는 (None, 오류문구).

    row: {name, id, url, title, verdict, note} — verdict '🟡 후보'만 β 등재 대상(클라이언트 로컬 기억).
    """
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as p:
        try:
            browser = _launch_sync(p)
        except Exception as e:
            return None, str(e)
        pg = browser.new_page()
        try:
            pg.goto("https://www.bokjiro.go.kr/", wait_until="domcontentloaded", timeout=20000)
        except Exception as e:
            browser.close()
            return None, f"복지로 접속 실패: {str(e)[:120]} — 인터넷 되는 PC에서 실행하세요(개발 컨테이너는 정부망 차단)."
        for name in names:
            row = {"name": name, "id": "", "url": "", "title": "", "verdict": "❌ 미발견", "note": ""}
            try:
                box = None
                for sel in BOKJIRO_SEARCH_INPUTS:
                    loc = pg.locator(sel).first
                    if loc.count() and loc.is_visible():
                        box = loc
                        break
                if box is None:
                    row["note"] = "검색창을 못 찾음(사이트 개편?) — BOKJIRO_SEARCH_INPUTS 보강 필요"
                    rows.append(row)
                    continue
                box.fill(name)
                box.press("Enter")
                pg.wait_for_timeout(2500)
                hrefs = pg.eval_on_selector_all(
                    "a[href*='wlfareInfoId']",
                    "els => els.map(a => ({href: a.href, text: (a.textContent||'').trim()}))")
                cands = []
                for a in hrefs:
                    m = re.search(r"wlfareInfoId=(WLF\w+)", a["href"])
                    if m:
                        cands.append((m.group(1), a["text"]))
                if not cands:
                    row["note"] = "검색 결과에 wlfareInfoId 링크 없음(서비스명이 다르거나 복지로 미등재)"
                    rows.append(row)
                    continue
                nn = name.replace(" ", "")
                cands.sort(key=lambda c: (nn not in c[1].replace(" ", ""), len(c[1])))
                wid = cands[0][0]
                row["id"] = wid
                row["url"] = BOKJIRO_DETAIL.format(wid=wid)
                pg.goto(row["url"], wait_until="domcontentloaded", timeout=20000)
                pg.wait_for_timeout(1500)
                row["title"] = (pg.title() or "").strip()[:60]
                hit = nn in pg.inner_text("body").replace(" ", "")[:3000]
                row["verdict"] = ("🟡 후보(ID·서비스 일치 확인)" if hit
                                  else "⚠️ 상세 페이지 불일치(다른 서비스일 수 있음)")
                pg.goto("https://www.bokjiro.go.kr/", wait_until="domcontentloaded", timeout=20000)
            except Exception as e:
                row["note"] = f"오류: {str(e)[:100]}"
                rows.append(row)
                continue
            rows.append(row)
        browser.close()
    return rows, None
