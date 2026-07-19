# -*- coding: utf-8 -*-
"""정부24 서류 자동발급 '후보 코드(CappBizCD)' 실측 발굴·검증 CLI.

코어 로직은 rpa/probe.py (데스크탑앱의 [🔎 실측 확인] API와 공용 — 단일 소스).
이 파일은 보고서 작성·일괄 후보 조사용 CLI 래퍼다.

왜 이 도구인가(정직성 원칙)
---------------------------
자동발급 서류를 늘리려면 정부24 민원 코드(CappBizCD)가 필요한데, 코드를 추측으로
등재하면 데모/실사용에서 빈 페이지·엉뚱한 민원으로 끊긴다(과장 금지 원칙 위반).
이 도구는 **정부24 검색에서 코드를 실측으로 발굴**하고 안내 페이지(AA020)의
제목·'발급하기' 버튼 존재까지 확인해 보고서로 만든다.

사용법 (인터넷 되는 PC에서 — 개발 컨테이너는 정부망 차단):
    cd backend && python tools/probe_gov24_docs.py                       # 기본 후보 일괄 조사(보고서만)
    python tools/probe_gov24_docs.py 혼인관계증명서 기본증명서              # 지정 서류만 조사
    python tools/probe_gov24_docs.py --register 혼인관계증명서 기본증명서   # ✅ 통과분을 바로 등록(β)
    python tools/probe_gov24_docs.py --list                              # 등록된 동적 서류 확인
    python tools/probe_gov24_docs.py --remove 혼인관계증명서               # 등록 해제(첫 발급 실패 시)

--register 는 실측 통과(✅) 항목만 rpa/docs_extra.json 에 기록한다 → 앱을 재시작하거나,
앱이 켜져 있으면 [🔎 실측 확인]과 같은 리로드로 발급 패널·여정·자동첨부에 β 배지로 나타난다.
β의 의미(정직성): 코드·발급버튼은 실측 확인됐고, '첫 실발급 완주'가 최종 검증이다 —
실패하면 앱이 정직한 오류를 보여주니 --remove 로 내리면 된다. 완주 확인 후 영구 등재(내장)를
원하면 기존 절차(DOC_CAPP·_SUPPORTED_DOCS·LOCAL_RPA_DOCS 3곳)로 승격한다.
"""
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:  # `python tools/…` 직접 실행 시에도 rpa 패키지 임포트 보장
    sys.path.insert(0, str(HERE.parent))

from rpa.probe import probe_names, register_rows, read_extra, remove_names  # noqa: E402
from rpa import gov24_rpa  # noqa: E402

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
    # 주거급여·이사 관련 카탈로그 빈출(전입 확인) + 학생·청년 장학 서류 — 실측 통과분만 등록된다
    "전입세대확인서",
    "졸업증명서",
]


def cmd_list():
    entries = read_extra()
    path = gov24_rpa._EXTRA_DOCS_PATH
    if not entries:
        print(f"[probe] 등록된 동적 서류 없음 ({path})")
        return 0
    print(f"[probe] 등록된 동적 서류 {len(entries)}건 ({path}):")
    for e in entries:
        print(f"  {'β' if e.get('enabled') else '(꺼짐)'}  {e.get('name')}  code={e.get('code')}  {e.get('title', '')[:40]}")
    return 0


def cmd_remove(names):
    removed = remove_names(names)
    print(f"[probe] {removed}건 등록 해제 → 앱을 재시작하면 목록에서 사라져요.")
    return 0


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
    rows, err = probe_names(names)
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
        registered = register_rows(rows)
        if registered:
            print(f"[probe] ✅ {len(registered)}건 등록 → {gov24_rpa._EXTRA_DOCS_PATH}")
            print("[probe] 앱(run-local-app.bat)을 재시작하면 발급 패널·여정에 β 배지로 나타나요.")
            print("[probe] β = 코드·발급버튼 실측 확인됨. 첫 실발급 1회가 최종 검증 — 실패하면 --remove 로 내리세요.")
        else:
            print("[probe] 등록할 ✅ 통과 항목이 없어요 — 보고서를 확인하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
