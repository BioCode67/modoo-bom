# 작업 현황 인수인계

> 이 파일은 **다른 Claude 세션(터미널/폰 원격)** 이 작업을 이어받기 위한 메모다.
> 먼저 이 파일 → `CLAUDE.md` 순으로 읽고 이어서 진행하면 된다.

## 🌙 야간 자율세션 성과 (2026-07-04) — 이 세션(백엔드/에이전트/문서 담당)

동시에 다른 세션이 프론트(i18n·perf·a11y·golden테스트)를 작업 중이었음 → 커밋 전 항상 `git pull`.

- **매칭 정확도(핵심)**: ①소득 상한 게이트(연령만 맞으면 저소득정책 오탐 제거 — 프론트+백엔드 mock+/estimate) ②상황 관련도 개인화 정렬(`situationRelevance`: 장애인엔 장애·영아부모엔 육아 먼저) ③괄호변형 중복제거(`nameKey`) ④백엔드 LangGraph 자격판별 노드 정렬·디듑(기초연금이 문화누리카드 아래 묻히던 것 수정) ⑤/estimate 상위10 정렬누락 버그. 10페르소나 감사 0오탐.
- **CDP 로컬 에이전트(핵심)**: `selftest_agent.py`(로그인~자동입력 9/9 재검증), 연결 재시도, 서류 8종(가족관계·국민연금가입자 AA040 없어 정직 제외), 다중서류 1회 로그인. CDP 경계 실측: 정부24=완전 자동입력✅, nhis=webplay.jsp(DOM 없어 불가), bokjiro=eForm 복잡.
- **헤드라인 실증**: `frontend/scripts/verify-semantic.mjs` — 다국어 AI 검색이 실제로 됨(베트남어 실직→긴급복지, 중국어 장애→장애인의료비 등). LangGraph 10노드 Mock 실행도 검증.
- **데이터**: 민간재단 20곳(놓치기 쉬운 장학·자립·위기, 전 도메인 실측). 시드 2026 금액 정확성 재확인(기초연금 349,700·선정 247만 = 공식 일치).
- **문서**: 상세기획서 전면 심화(문제정의 실데이터 137만·몰라서70.9%, AI Agent 4대능력, CDP 3방식비교, 다국어 실측표), 발표대본 오프닝 강화.
- **품질**: 프론트 256 + 백엔드 14 통과, lint/tsc 0, 라이브 배포 반영.

---

## ⭐⭐ RPA 근본 해법 (2026-07-03 오후) — 진짜 크롬 + CDP 로컬 에이전트

사용자가 "확장 말고 다른 방식(로컬/서버/원격제어) 다 좋으니 자동발급·신청만 되게 하라"고 해서 전환.
- **핵심**: 사용자 진짜 크롬을 `--remote-debugging-port=9222`로 띄우고 Playwright `connect_over_cdp`로 연결.
  → **navigator.webdriver=false라 정부24 Mbuster 통과(실측)** + Playwright 신뢰클릭·프레임 API(확장 debugger보다 안정).
- **실측 성공**: 로그인→Mbuster통과→간편인증→`simpleCert.html` iframe→이름·생년월일·휴대폰뒤8자리·전체동의
  자동입력까지 진짜 크롬으로 검증. 셀렉터 실측 확정(`#oacx_name/#oacx_birth/#oacx_phone2/#totalAgree`,
  `button.login-type`+텍스트, `li:has-text('카카오톡')`, 요청버튼 `#oacx-request-btn-pc`).
- **실행**: 루트 `run-agent-cdp.bat` 더블클릭 → 크롬 열림 + `backend/local_agent.py` 실행.
  최초 1회 이름·생년월일·휴대폰 입력(→`backend/agent_profile.json`, 로컬 전용/gitignore).
- 본인인증(카카오 폰 승인)만 사람 → 이후 발급폼·신청·문서출력(popup)·PDF저장(바탕화면\모두봄서류) 자동.
- **남은 검증(사용자 실인증 필요)**: 카카오 승인 후 발급폼→신청→문서출력→PDF e2e 1회 완주.
- Node CDP 탐색도구: scratchpad `pwtest/cdp-mbuster.mjs`(Mbuster통과 확인), `cdp-iframe.mjs`(위젯 셀렉터 매핑).
- 확장(0.1.27)은 폴백으로 유지. 문서: `backend/LOCAL_AGENT.md`.

## (이전) 2026-07-03 — 크롬 확장 RPA 경로

- **RPA 메인 경로는 이제 크롬 확장(`extension/`, v0.1.21)**: 배포 사이트에서 서버·Python 없이
  등본 등 서류 13종 자동발급 + 복지로/장학재단 신청. 실사용자(김주형) 크롬에서 단계별 검증 중.
- **핵심 기술 돌파**: 정부24 버튼들은 isTrusted(진짜 클릭)만 받음 → `chrome.debugger`
  `Input.dispatchMouseEvent`로 진짜 클릭 구현(TRUSTED_PREP→좌표 재계산→TRUSTED_CLICK 2단계 —
  attach 시 안내바가 페이지를 밀어 좌표가 어긋나는 문제 해결). 오버레이 가림은 elementFromPoint 검사로 회피.
- **간편인증(카카오) 자동입력 동작 확인됨**(0.1.18에서 위젯 오픈+이름·생년월일·휴대폰·전체동의까지).
  이름은 프로필(데모 페르소나)이 아니라 **서류 도우미의 '실명' 칸(rpaInfo.name)** 사용(0.1.19).
- **진단 추적기**(0.1.20): 확장이 매 단계 기록 → 팝업 '🔍 진단 복사' 버튼으로 클립보드 복사
  → 사용자가 붙여넣으면 원인 정조준 가능. **막히면 이걸 먼저 요청할 것.**
- **자동 회귀**: `node extension/selftest.mjs`(playwright-core+번들 chromium 필요, 브랜드 크롬은
  --load-extension 제거됨) 7/7 통과. 로그인 이후는 Mbuster가 자동화 브라우저 차단 → 실사용 크롬만 검증 가능.
- **두 컴퓨터 운영**: 작업 PC(IT)는 루트의 **`update.bat` 더블클릭**으로 최신화(머지 꼬임 자동 정리).
  git 계정 팝업은 BioCode67 선택 + `git config --global credential.https://github.com.username BioCode67`.
- **남은 검증**: applyMinwonForm '신청하기' 자동 클릭이 실브라우저에서 실제로 눌리는지(0.1.19~21 수정 적용
  후 미확인) → 안 되면 진단 복사 결과로 조준. 이후 전자서명→문서출력→PDF 저장까지 e2e 1회 완주가 목표.
- **기획서**: `docs/기획서자료/상세기획서-초안.md`(제출용 전문 초안, 마감 7/7) + 자료모음·발표대본 최신화.

---

## (이전) 2026-07-01 인수인계 — 로컬 에이전트(백엔드 RPA) 경로

## 실행 방법 (윈도우, 무관리자 설치본)
- **한 번에 실행:** 프로젝트 루트의 **`run-windows.bat` 더블클릭** → 백엔드(:8000) + 프론트(:5173) 새 창 기동.
- 런타임(이미 설치됨): Node(포터블) `%LOCALAPPDATA%\Programs\nodejs`, Python(NuGet) `%LOCALAPPDATA%\Programs\py311nuget`, 백엔드 venv `backend\venv`.
- 백엔드 실행 시 **`PYTHONUTF8=1`**(한글 콘솔 크래시 방지) + **`RPA_BROWSER_CHANNEL=msedge`** 환경변수 필요(run-windows가 자동 설정).
- 포트가 이미 사용 중이면 이전 세션의 서버가 떠있는 것 → 재사용하거나 종료 후 재기동.

## 오늘 변경한 것 (아직 **미커밋**)
- `backend/rpa/base.py`
  - `get_launch_options()` — **윈도우에서는 번들 Chromium(SxS 오류) 대신 설치된 Edge(msedge)** 사용. 맥/리눅스는 기존 번들. env: `RPA_BROWSER_CHANNEL`, `RPA_HEADLESS`.
  - `save_document()` — 발급된 서류를 **PDF로 `바탕화면\모두봄서류`에 자동 저장**(CDP printToPDF, 실패 시 PNG 폴백).
- `backend/rpa/{gov24,apply,nhis,work24}_rpa.py` — 모두 `get_launch_options()` 사용. gov24·nhis는 발급 성공 시 `save_document()` 호출.
- `backend/rpa/orchestrator.py` + `backend/api/routes.py` — **무인 여정 엔진**: `POST /api/journey/plan`(계획), `POST /api/journey/run`(순차 발급→저장→신청), `GET /api/journey/status/{id}`(추적).
- `backend/main.py` — **로컬 에이전트 브릿지(백엔드)**: CORS에 `https://biocode67.github.io` 허용 + Private Network Access 헤더. (배포 웹이 사용자 PC의 이 에이전트를 호출 가능하게)
- 루트: `run-windows.bat`, `run-windows.ps1`, `scripts/restore-handoff.windows.sh` (윈도우 실행/복원 스크립트).

### 이번 세션 추가 변경 (2026-07-01 오후, 아직 미커밋)
- `frontend/src/lib/backend.ts` — 로컬 에이전트(localhost:8000) 감지(`export let API_BASE` 라이브바인딩). → **gh-pages 재배포 완료**(Supabase/onrender 제외).
- `frontend/src/components/ChatWidget.tsx`, `QuickAsk.tsx` — 폴리시(모바일 홈 FAB 겹침 해소, 비활성 버튼 대비).
- `backend/rpa/gov24_rpa.py` — plus.gov.kr/login + simpleCert iframe 대응.
- `backend/rpa/apply_rpa.py` — 복지로 loginView.do + eForm + fincert 대응.
- `backend/rpa/base.py` — `click_eform_button`(eForm 좌표 신뢰클릭), `get_frame_by_url`, 카카오톡 셀렉터 보강.
- ※ 위 항목들은 커밋 완료(main). 배포는 gh-pages 반영.

### ⭐ 헤드라인 기능 추가 — 온디바이스 다국어 AI 의미 검색 (2026-07-01, 커밋·배포 완료)
- 브라우저에서 직접 도는 신경망 임베딩(`multilingual-e5-small`)으로 복지를 **의미**로 검색. 한국어/영어/베트남어 등 **다국어 교차검색**(외국인·다문화 사각지대). **서버 전송 없음**(기기 내 실행).
- `src/lib/semanticSearch.ts` + 탐색 'AI 의미 검색' 토글(옵트인 지연로드) + `scripts/embed-policies.mts`(`npm run embed`) + `public/policy-embeddings.json`.
- 운영: 첫 로드 ~128MB(CDN), 이후 캐시로 즉시. **데모 전 토글 1회 프리워밍 권장.** 미사용 WASM은 `scripts/clean-wasm.mjs`가 배포 시 제거.

## 동작 확인됨 ✅ / 미동작 ⚠️
- ✅ **건강보험 자격득실확인서(nhis) 자동발급** — 실제 사이트 접속→간편인증 위젯→카카오톡 선택→정보입력→인증요청→**카카오 승인 대기 지점**까지 실동작. + PDF 자동저장(153KB) 검증.
- ✅ Mock 발급(`/api/documents/issue`), 여정 API, CORS/PNA 프리플라이트 검증.
- ✅ **정부24 로그인+발급 흐름 갱신·보강(2026-07-02)** — `plus.gov.kr/login` + `button.login-type` 간편인증 + **simpleCert iframe**(oacx) 내 카카오톡/폼. **간편인증 폼 자동 도달은 여러 번 검증됨**(정보입력 폼까지). 발급 흐름 보강: 로그인 후 **발급 폼(AA040)로 직행**(안내 AA020 저장 방지), 회원/비회원 모달 자동 처리, 본인인증 폼 **자동입력**(이름·생년월일·휴대폰), 결과 미도달 시 완료 오판 방지 가드, 대기 480초.
  - ⚠️ **정직한 상태**: 과거 저장된 "등본 PDF"는 실제 등본이 아니라 **안내 페이지(AA020)** 였음(발급 미완). **승인 이후 실제 발급→PDF는 아직 미검증** — 카카오 폰 승인이 물리적으로 필요(간편인증 강제, 비회원도 인증 필요). 현재까지 실런 3회 모두 폼에서 폰 승인 미완료로 타임아웃. **승인 1회만 완료하면 그 이후 흐름을 관찰·보정해 완성 가능.**
- ✅ **복지로 로그인 갱신 완료(2026-07-01)** — 새 URL `loginView.do`(tx 자동), **eForm(Clipsoft `.cl-button`) → 좌표 기반 신뢰클릭** 필수, 간편인증 위젯은 **yeskey fincert**(정부24 oacx와 다름, 메인 오버레이). `apply_rpa.py`·`base.py`(`click_eform_button`) 갱신, 카카오톡/폼 도달까지 검증. **서비스 이동·신청 폼은 실런에서 확인 필요.**
- ⚠️ 위 두 흐름의 **카카오 승인 이후 구간**(세션 유지·서비스 페이지·발급/신청)은 사용자 폰 승인이 있어야 끝까지 검증 가능 → 실제 런 예정.

## 다음 할 일 (우선순위)
1. ✅ **[완료] [프론트] 로컬 에이전트 브릿지** — `backend.ts`가 localhost:8000 감지(`export let API_BASE` 라이브바인딩). `npm run deploy` 재배포(Supabase/onrender 제외한 폴리시만). **실제 Edge(headed)에서 라이브→로컬에이전트 도달 검증 완료**(headless는 PNA로 막힘, 데모 무관).
2. ✅ **[완료] [백엔드] 정부24 plus.gov.kr 갱신** — 로그인 폼 도달 검증. (카카오 승인 이후 서비스→발급 실런 검증 남음)
3. ✅ **[완료] [백엔드] 복지로 로그인 갱신** — 간편인증 폼 도달 검증. (신청 폼 실런 검증 남음)
4. **[실런] 정부24·복지로 카카오 승인 end-to-end** — 사용자 폰 승인으로 서비스→발급/신청→PDF까지 최종 확인 + 남은 셀렉터 보정.
5. **[프론트] "담은 복지 전부 원클릭 자동발급/신청" 버튼** → `/api/journey/run` 호출.
6. (추후) 에이전트를 **Tauri/Electron 설치본**으로 패키징.

### 1번 프론트 스펙 (`frontend/src/lib/backend.ts` 교체)
```ts
export let API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || ''
const LOCAL_AGENT = 'http://localhost:8000'
let cached: boolean | null = null
async function ping(base: string, ms: number) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal }); clearTimeout(t); return res.ok
  } catch { return false }
}
export async function checkBackend(timeoutMs = 1500): Promise<boolean> {
  if (cached !== null) return cached
  if (await ping(API_BASE, timeoutMs)) { cached = true; return cached }
  if (API_BASE !== LOCAL_AGENT && await ping(LOCAL_AGENT, timeoutMs)) { API_BASE = LOCAL_AGENT; cached = true; return cached }
  cached = false; return cached
}
export function resetBackendCache() { cached = null }
```

## 원칙 (반드시 지킬 것)
- **카카오 본인인증·신청 최종 제출은 사용자 직접**(법적·비가역). 완전 무인 대리승인은 명의도용이라 만들지 않는다.
- **가짜데이터 금지 / 자동화 현실 과장 금지.** 실제 검증된 것만 "된다"고 말한다.
- 커밋: **한국어 conventional commit, AI 서명 금지.** user.name/email은 BioCode67.
- **배포 라이브:** https://biocode67.github.io/modoo-bom/ (gh-pages). 재배포 `cd frontend && npm run deploy` + 소스 `git push origin main`(별개).
  - 배포는 **기본 안전**: `frontend/.env.production`이 Supabase·onrender를 빈 값으로 override → 로그인/죽은 백엔드가 라이브에 안 샘(누가 `npm run deploy` 해도 OK). 라이브에 로그인 켜려면 `.env.production`에 실제 값 채우기.
  - **⚠️ RPA 데모는 반드시 `localhost:5173`(run-windows.bat)에서** — 로컬 프론트는 vite 프록시(`/api`→:8000)로 백엔드를 **안정적으로 감지**해 "에이전트로 신청" RPA 버튼이 켜진다(검증됨). **배포 사이트(github.io)의 로컬 감지는 브라우저 Private/Local Network Access 정책 때문에 불안정**(https→http localhost 요청이 간헐적으로 hang). 서버는 CORS/PNA를 정상 응답하지만 브라우저 정책은 클라이언트로 못 넘음. → 서류 자동발급/신청 시연은 로컬 앱에서 할 것.
  - AI 온디바이스 모델(~128MB)은 첫 사용 시 CDN 다운로드 → **시연 전 AI 토글 1회 프리워밍 권장**(캐시 후 즉시).
