# -*- coding: utf-8 -*-
"""복지로 서비스 ID(wlfareInfoId) 실측 발굴 도구 — 자동신청 커버리지 확장의 1단계.

한계를 먼저(정직성): 복지로는 비로그인 상태에서 방문형 서비스에도 '신청하기' 요소를
렌더한다(2026-07-12 조사 — docs/온라인신청-정리.md). 따라서 이 도구는
  ① 서비스명 → wlfareInfoId 매핑을 실측으로 발굴하고
  ② 상세 페이지 제목이 서비스명과 일치하는지 확인
까지만 자동화한다. **온라인 신청 가능 여부는 로그인 후 사람이 육안으로 1회 확인**해야
등재할 수 있다(미확인 등재 금지 — 신청 버튼이 없는 서비스로 딥링크하면 데모가 끊긴다).

사용법 (인터넷 되는 PC에서):
    cd backend && python tools/probe_bokjiro_apply.py 청년도약계좌 "긴급복지 생계지원"
결과: 화면 출력 + tools/probe-bokjiro-report.md
등재 위치(육안 확인 후): frontend/src/lib/quickApply.ts KNOWN_APPLY_URLS
    (등재하면 `npm run check:links`가 상시 재검증 목록에 자동 포함)
"""
import re
import sys
import glob
import pathlib

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
REPORT = HERE / "probe-bokjiro-report.md"
SEARCH_INPUTS = ["input[type='search']", "input[name*='search' i]", "input[placeholder*='검색']"]


def probe(names):
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as p:
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        browser = p.chromium.launch(executable_path=(exe[0] if exe else None), headless=True)
        pg = browser.new_page()
        try:
            pg.goto("https://www.bokjiro.go.kr/", wait_until="domcontentloaded", timeout=20000)
        except Exception as e:
            browser.close()
            return None, f"복지로 접속 실패: {str(e)[:120]} — 인터넷 되는 PC에서 실행하세요."
        for name in names:
            row = {"name": name, "id": "", "title": "", "verdict": "❌ 미발견", "note": ""}
            try:
                box = None
                for sel in SEARCH_INPUTS:
                    loc = pg.locator(sel).first
                    if loc.count() and loc.is_visible():
                        box = loc
                        break
                if box is None:
                    row["note"] = "검색창을 못 찾음(사이트 개편?) — SEARCH_INPUTS 보강 필요"
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
                detail = f"https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId={wid}"
                pg.goto(detail, wait_until="domcontentloaded", timeout=20000)
                pg.wait_for_timeout(1500)
                row["title"] = (pg.title() or "").strip()[:60]
                hit = nn in pg.inner_text("body").replace(" ", "")[:3000]
                row["verdict"] = ("🟡 ID 확인 — 온라인신청 여부는 로그인 후 육안 1회 확인 필요" if hit
                                  else "⚠️ 상세 페이지 불일치(다른 서비스일 수 있음)")
                pg.goto("https://www.bokjiro.go.kr/", wait_until="domcontentloaded", timeout=20000)
            except Exception as e:
                row["note"] = f"오류: {str(e)[:100]}"
                rows.append(row)
                continue
            rows.append(row)
        browser.close()
    return rows, None


def main():
    names = sys.argv[1:]
    if not names:
        print("사용법: python tools/probe_bokjiro_apply.py <서비스명> [서비스명…]")
        return 2
    print(f"[probe] 복지로 서비스 ID 발굴 — 대상 {len(names)}종")
    rows, err = probe(names)
    if err:
        print(f"[probe] ❌ {err}")
        return 2
    lines = ["# 복지로 자동신청 후보 실측 보고서", "",
             "| 서비스 | wlfareInfoId | 상세 제목 | 판정 | 비고 |", "|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['name']} | `{r['id'] or '-'}` | {r['title'] or '-'} | {r['verdict']} | {r['note']} |")
        print(f"  {r['verdict']}  {r['name']}  id={r['id'] or '-'}")
    lines += ["", "## 등재 절차(🟡 후보만)",
              "1. 복지로 **로그인 후** 해당 서비스에 실제 '온라인 신청' 버튼이 있는지 육안 1회 확인",
              "2. `frontend/src/lib/quickApply.ts KNOWN_APPLY_URLS`에 추가 → `npm run check:links` 통과 확인",
              "3. 데스크탑앱에서 **자동신청 1회 완주 확인**(양식 도달) 후 커밋 — 미확인 등재 금지"]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[probe] 보고서: {REPORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
