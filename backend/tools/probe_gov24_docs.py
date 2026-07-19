# -*- coding: utf-8 -*-
"""정부24 서류 자동발급 '후보 코드(CappBizCD)' 실측 발굴·검증 도구.

왜 이 도구인가(정직성 원칙)
---------------------------
자동발급 서류를 늘리려면 정부24 민원 코드(CappBizCD)가 필요한데, 코드를 추측으로
등재하면 데모/실사용에서 빈 페이지·엉뚱한 민원으로 끊긴다(과장 금지 원칙 위반).
이 도구는 **정부24 검색에서 코드를 실측으로 발굴**하고 안내 페이지(AA020)의
제목·'발급하기' 버튼 존재까지 확인해 보고서로 만든다 — 등재는 사람이 보고서를
검토한 뒤 수동으로(마지막엔 실발급 1회 확인).

사용법 (인터넷 되는 PC에서 — 개발 컨테이너는 정부망 차단):
    cd backend && python tools/probe_gov24_docs.py                       # 기본 후보 7종 조사(보고서만)
    python tools/probe_gov24_docs.py 혼인관계증명서 기본증명서              # 지정 서류만 조사
    python tools/probe_gov24_docs.py --register 혼인관계증명서 기본증명서   # ✅ 통과분을 바로 등록(β)
    python tools/probe_gov24_docs.py --list                              # 등록된 동적 서류 확인
    python tools/probe_gov24_docs.py --remove 혼인관계증명서               # 등록 해제(첫 발급 실패 시)

--register 는 실측 통과(✅) 항목만 rpa/docs_extra.json 에 기록한다 → 앱 재시작하면
발급 패널·여정·자동첨부에 β 배지로 즉시 나타난다(코드 수정 불필요).
β의 의미(정직성): 코드·발급버튼은 실측 확인됐고, '첫 실발급 완주'가 최종 검증이다 —
실패하면 앱이 정직한 오류를 보여주니 --remove 로 내리면 된다. 완주 확인 후 영구 등재(내장)를
원하면 기존 절차(DOC_CAPP·_SUPPORTED_DOCS·LOCAL_RPA_DOCS 3곳)로 승격한다.
"""
import json
import os
import re
import sys
import glob
import pathlib

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
REPORT = HERE / "probe-report.md"

# 기본 후보 — 카탈로그 required_docs 빈도·복지 신청 통용 서류에서 선정.
# (차상위·국민연금은 과거 조사에서 '발급폼 미확인/별도 흐름'으로 보류된 이력 있음 — 재확인 후보)
DEFAULT_CANDIDATES = [
    "혼인관계증명서",
    "기본증명서",
    "입양관계증명서",
    "의료급여증",
    "차상위계층 확인서",
    "장기요양인정서",
    "국민연금 가입자 가입증명",
    # 카탈로그 required_docs 빈도 분석(2026-07-19) 추가 후보 — 정부24 온라인 발급 가능성이 있는 것만.
    # (신분증·통장사본·임대차계약서·진단서류는 실물/은행/병원 발급이라 📷 촬영·등록 경로가 정답 — 후보 제외)
    "재학증명서",
    "사업자등록증명",
]

INFO_URL = ("https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD={code}"
            "&HighCtgCD=A01010001&tp_seq=01&Mcode=10200")
SEARCH_INPUTS = ["input[type='search']", "input[name*='srh' i]", "input[placeholder*='검색']", "#ptl-search input"]


def probe(names):
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as p:
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        browser = p.chromium.launch(executable_path=(exe[0] if exe else None), headless=True)
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


# 동적 등록 파일 — gov24_rpa._EXTRA_DOCS_PATH 와 동일 규칙(env 우선, 기본 rpa/docs_extra.json)
EXTRA_PATH = pathlib.Path(os.getenv("MODOOBOM_EXTRA_DOCS", "") or (HERE.parent / "rpa" / "docs_extra.json"))


def _read_extra():
    try:
        return json.loads(EXTRA_PATH.read_text(encoding="utf-8")) if EXTRA_PATH.exists() else []
    except Exception:
        return []


def _write_extra(entries):
    EXTRA_PATH.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def cmd_list():
    entries = _read_extra()
    if not entries:
        print(f"[probe] 등록된 동적 서류 없음 ({EXTRA_PATH})")
        return 0
    print(f"[probe] 등록된 동적 서류 {len(entries)}건 ({EXTRA_PATH}):")
    for e in entries:
        print(f"  {'β' if e.get('enabled') else '(꺼짐)'}  {e.get('name')}  code={e.get('code')}  {e.get('title', '')[:40]}")
    return 0


def cmd_remove(names):
    entries = _read_extra()
    keep = [e for e in entries if e.get("name") not in names]
    removed = len(entries) - len(keep)
    _write_extra(keep)
    print(f"[probe] {removed}건 등록 해제 → 앱을 재시작하면 목록에서 사라져요.")
    return 0


def register_rows(rows):
    """✅ 판정 행만 docs_extra.json 에 병합(이름 기준 갱신). 내장 서류와 겹치면 앱이 내장을 우선한다."""
    ok_rows = [r for r in rows if r["verdict"].startswith("✅") and r["code"]]
    if not ok_rows:
        print("[probe] 등록할 ✅ 통과 항목이 없어요 — 보고서를 확인하세요.")
        return
    entries = {e.get("name"): e for e in _read_extra()}
    for r in ok_rows:
        entries[r["name"]] = {
            "name": r["name"], "code": r["code"], "title": r["title"],
            "enabled": True, "source": "probe", "note": "β — 첫 실발급 완주가 최종 검증",
        }
    _write_extra(list(entries.values()))
    print(f"[probe] ✅ {len(ok_rows)}건 등록 → {EXTRA_PATH}")
    print("[probe] 앱(run-local-app.bat)을 재시작하면 발급 패널·여정에 β 배지로 나타나요.")
    print("[probe] β = 코드·발급버튼 실측 확인됨. 첫 실발급 1회가 최종 검증 — 실패하면 --remove 로 내리세요.")


def main():
    args = sys.argv[1:]
    if args and args[0] == "--list":
        return cmd_list()
    if args and args[0] == "--remove":
        return cmd_remove(args[1:]) if args[1:] else print("[probe] --remove 서류명") or 2
    do_register = bool(args) and args[0] == "--register"
    if do_register:
        args = args[1:]
    names = args or DEFAULT_CANDIDATES
    print(f"[probe] 정부24 코드 발굴·검증 — 대상 {len(names)}종{' (통과분 자동 등록)' if do_register else ''}")
    rows, err = probe(names)
    if err:
        print(f"[probe] ❌ {err}")
        return 2
    lines = ["# 정부24 자동발급 후보 실측 보고서", "",
             "| 서류 | CappBizCD | 페이지 제목 | 발급버튼 | 판정 | 비고 |", "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['name']} | `{r['code'] or '-'}` | {r['title'] or '-'} | {'O' if r['issue_btn'] else 'X'} | {r['verdict']} | {r['note']} |")
        print(f"  {r['verdict']}  {r['name']}  code={r['code'] or '-'}  title={r['title'] or '-'}  {r['note']}")
    lines += ["", "## 등재 절차(✅ 후보만, 사람이 검토 후)",
              "1. `rpa/gov24_rpa.py DOC_CAPP`에 한 줄 추가", "2. `rpa/manager.py _SUPPORTED_DOCS`에 추가",
              "3. `frontend/src/lib/officialLinks.ts LOCAL_RPA_DOCS`에 추가",
              "4. 데스크탑앱에서 **실발급 1회 완주 확인**(카카오 인증 포함) 후 커밋 — 미완주 등재 금지"]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[probe] 보고서: {REPORT}")
    if do_register:
        register_rows(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
