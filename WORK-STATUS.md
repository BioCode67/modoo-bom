# 작업 현황 인수인계

> 이 파일은 다른 작업 환경(터미널/원격 머신)에서 작업을 이어받기 위한 인수인계 메모다.
> 먼저 이 파일 → `CLAUDE.md` 순으로 읽고 이어서 진행하면 된다.

## 야간 작업 배치 (2026-07-05 밤)

야간 배치 작업. 안전 우선(라이브 무파손·전 변경 테스트/E2E 검증 후 배포).
- **적대적 스윕으로 실버그 3건 발견·수정**: ①장제급여(사망 시)가 target의 '기초생활수급자' 키워드로 생존
  저소득가구에 강력추천되던 잔여 leak(eligibility에 이어 target도 정정→탐색전용) ②중장년 새출발(만40~64세)이
  29세 실직자에게 강추→연령 게이트(40~64만).
- **엔진 견고성 검증(클린)**: 소득상한 65개 정책 +40%p 초과서 high 노출 0건 · 중립 페르소나(무특성) high 0건·leak 0건
  · 성별/농어촌/미취업/재학/다자녀/출산 게이트 정상. 남성+임신은 트랜스 포용상 의도적 유지(정상).
- 남은 관찰(미조치, 판단 필요): 시드 중복쌍(의료급여 1종/(1종·2종)·노인 틀니 x2·장기요양 x2·청소년특별 x2) —
  다른 담당 작업분에서 의도적으로 구분했을 수 있어 리스크상 미변경(표시 중복이나 오류 아님).
- 품질: 프론트 320 · 백엔드 34 · E2E 11여정 0에러 · lint/tsc 0 · 전 변경 배포 완료.

---

## 무설치 신청 경로 + 백엔드 출시하드닝 4차 (2026-07-05)

사용자 요구("확장·크롬 종속 없이, 웹/앱에서 바로 말하고→추천→인증만 하면 자동"):
- **무설치 원터치 신청**(`quickApply.oneTapApply`): [신청] 한 번 → 내 정보 클립보드 복사 + 공식 신청 페이지 새 탭.
  드로어·복지비서 알림 공통 적용. 모바일 팝업차단 버그 수정(await 뒤 open→차단, open을 동기 우선으로).
  인증·제출은 정부 공식 사이트에서 본인(안전). → 대부분 사용자가 확장 없이 쓰는 기본 경로.
- **쇼케이스 재구성**: '말하면→추천→[신청]한번→인증만'을 전면화, 확장/로컬 완전자동은 선택, 마이데이터는 준비 중.
- **전략 문서**(`docs/무설치-자동화-전략.md`): 1안 원터치(구현)·2안 공공 마이데이터/전자증명서 API(진짜 자동, 이용기관 등록 필요)·
  3안 서버RPA(위험·비권장)·4안 앱. "확장 없이 진짜 자동"의 정답=마이데이터.
- **백엔드 출시하드닝**: 구조적 로깅(print→logging, PII 미기록)·전역 예외처리기(스택트레이스 유출 차단).
- **데이터 leak 수정**: 장제급여(사망 시)가 '의료급여' 키워드로 생존 저소득자에게 강력추천되던 것→탐색전용.
- 병행 작업분(전면 교차검증 감사)과 머지 정합 확인: 프론트 320 + 백엔드 34 + E2E 11여정 0에러, lint/tsc 0.

---

## 접근성(WCAG) 전면 강화 3차 (2026-07-05) — 어르신·스크린리더 사용자 정면 지원

접근성 정밀 감사 → P0/P1/P2 결함 실측 수정(우리 사용자 상당수가 어르신·저소득·저리터러시):
- **P0 키보드**: PolicyCard가 clickable div라 키보드로 5천 정책 상세를 못 열던 것 → role/tabIndex/Enter·Space.
- **P0 대비**: 주버튼 흰글씨 on sprout-500(2.3:1, AA 미달) → sprout-700(≈5:1)·peach-600, 프로필 선택칩도.
- **P0 모달 포커스**: 공용 `useModalFocus` 훅으로 5개 모달(비교·온보딩·긴급·로그인·용어사전) 포커스 이동·Tab 트랩·ESC·복원.
- **P1**: 큰글씨 모드가 배지·안내문(9~13px 임의크기)까지 확대·선택칩 aria-pressed·프로필 입력 aria-label·아이콘버튼 이름.
- **P2**: reduced-motion 존중(MotionConfig)·뷰 전환 시 본문 포커스(SR 인지)·RPA 발급상태 aria-live·챗봇 aria-expanded.
- 검증: E2E 11여정 0에러(모달 ESC 유지 확인), 프론트 315 테스트, lint/tsc 0. 배포 완료.
- 추가 데이터: 취약계층 안전망 8건(SUP-026~033) + 농어촌 지원의 대도시 오추천 차단. 시드 190.

---

## "1등 품질·실출시" 종합 개선 2차 (2026-07-05) — 경쟁 차별화 4대 기능 + QA 전수

1차 하드닝(아래) 이후, 경쟁분석 권고를 실제 기능으로 구현 + 종합 QA 감사로 결함 전수 수정.

**경쟁 차별화 신기능 4종(전부 배포·테스트):**
- **정직 신뢰 라벨**(`lib/trust.ts`): 정책 상세에 출처·검증일·"자격은 행정 심사로 확정" 투명 고지 → 웰로의 AI 환각 리스크와 대비.
- **선제 로컬 알림**(`lib/notify.ts`+SW): 옵트인 시 재방문마다 하루 1회 마감·서류·갱신 기기 알림(서버 전송 0). 웰로/복지멤버십 핵심기능을 프라이버시 유지하며.
- **외국인·다문화 진입로**(`ForeignerWelcome`): 6개 언어 자국어 예시로 온디바이스 다국어 AI 검색 바로 진입 — 경쟁사 전부 비운 시장.
- **우리 동네 복지**(`LocalWelfare`): 지자체 4,500여 건을 시·도별로 세어 노출·탐색 진입 — 보조금24(중앙 중심) 약점 공략.

**종합 QA 감사 → 확인 결함 전수 수정:**
- lint 블로커(sw-notify.js 워커 전역) · 미취업/재학 전용사업(일경험·ICL) 취업/재학 상태 게이트(재직자 강력추천 오류) ·
  FIN 신뢰라벨 · 상세 드로어 포커스 트랩·복원(모달 a11y) · 비현금(감면) '월N' 배지 오표기 · 주택드림 소득상한 명시 ·
  프로필 토글 role=switch. + 백엔드 레이트리미트·입력상한(n_results le50).
- **E2E**: 분석 진입 플로우 갱신(기본 대화 모드) + 외국인 여정 추가 → 전 11여정·페이지에러 0.

**출시 품질 게이트(전부 통과)**: 프론트 313 테스트 · 백엔드 34 · tsc 0 · eslint 0 · E2E 11여정 0에러 · 빌드/배포 OK.

---

## 실제 출시 대비 종합 하드닝 1차 (2026-07-05) — 4대 병렬 감사(보안·경쟁·성능·백엔드)

"실제 출시·보안·속도·경쟁 서비스 이상 퀄리티" 요청에 4대 전문 감사를 병렬 진행 → 확인 결함을 우선순위대로 수정·배포.

- **보안(출시 필수)**: ①저장형 XSS/문서위조 차단(발급문서 user_name 정제+뷰 CSP헤더) ②관리자 엔드포인트
  토큰 게이트(무인증 노출·키prefix 유출 제거) ③WS Origin 검증(임의 사이트의 LLM쿼터 남용 차단) ④강식별
  PII(이름·생년월일·휴대폰) localStorage 미저장(세션만) ⑤CSP 메타(외부 스크립트 주입·base/폼 하이재킹 차단)
  ⑥에러메시지 일반화·로컬에이전트 127.0.0.1 ⑦dev 의존성 audit fix(프로덕션 취약점 0). 회귀 테스트 4.
- **백엔드 실데이터+견고성**: ①RAG를 전체 카탈로그(~5,061)로 시딩(과거 sample 131건만 알던 갭 해소)
  ②LLM 노드 5개 전부 실패 시 규칙 폴백(429 하나가 전체 분석 죽이던 것 차단) ③LLM 타임아웃/재시도
  ④health seeded 실측화.
- **성능(모바일)**: 3.9MB 임베딩을 데이터절약·2G·저사양에선 자동 다운로드 안 함(규칙기반 폴백)·AiDiscovery
  자동fetch 동일 게이트·postbuild로 23.5MB WASM 항상 제거(첫 페인트 172KB gz, 엔진 12.7ms 확인).
- **경쟁 우위**: 웰로(220만·로그인·광고·AI환각)·복지로/보조금24(인증서 벽·행정언어)·토스(2024 종료) 분석 →
  우리 유일강점(무가입·온디바이스 다국어·프라이버시·실제 RPA) 확인. 정직 신뢰 라벨(출처·검증일·'자격은
  심사로 확정' 투명 고지)로 환각 리스크 대비 차별화 구현. 남은 권고: PWA 로컬알림·외국인 진입로.
- **API 가이드**(`docs/데이터확장-API-가이드.md`): 온통청년 청년정책 OpenAPI가 1순위.
- 개인정보처리방침(privacy.html) 실제 데이터 처리와 일치 확인(출시 적합). 품질: 프론트 304 + 백엔드 32 통과.

---

## 정부 지원사업 25건 대량 추가 (2026-07-05) — 병렬 리서치+검증

사용자 요청("청년행복주택 같은 정부 지원사업 반영 확인 + 데이터 추가"). 행복주택(POL-074)은 청년에게
정상 노출 확인. 이후 병렬 리서치 3트랙으로 2026 사실·공식 URL 실검증 후 `govPrograms.ts`(SUP-) 25건 추가:
- **주거·금융(8)**: 신생아 특례 디딤돌/버팀목, 청년 주택드림 청약통장, 내집마련 디딤돌, 신혼·신생아 매입임대,
  신혼희망타운(뉴홈), HUG 전세보증금반환보증, 청년 주거급여 분리지급.
- **의료 안전망(7)**: 재난적 의료비(연 최대 5천만), 본인부담상한제, 미숙아·선천성이상아, 15세 이하 입원경감,
  정신건강 위기상담, 암환자 의료비, 선천성대사이상.
- **교통·문화·교육·고용·가족(10)**: K-패스, 청년 문화예술패스(19~20세), ICL 학자금대출, 국가기술자격 응시료,
  청년 일경험, 두루누리, 노란우산공제, 자영업 고용보험료, 농식품바우처, 다자녀 통합혜택.
- 엔진: 19~20세·다자녀 분기 추가 + 미숙아/다자녀 대상 게이트 + 중위 200% 상한 인식(신생아특례·재난적의료비).
- 리서치 검증 과정에서 초기 목표수치도 정정(노란우산 최대 600만·자영업 고용보험 50~80%). 금액은 연도 라벨.
- **API 가이드**(`docs/데이터확장-API-가이드.md`): 1순위=온통청년 청년정책 OpenAPI(무료 신청) → 청년정책 수천 건.
- 품질: 프론트 290 + 백엔드 28 통과, lint/tsc/빌드 0, 라이브 배포. 시드 총 177(POL124+PRV21+HOU7+SUP25).

---

## 4대 병렬 적대적 감사 → 확인 결함 전건 수정 (2026-07-05)

전문 감사 4개 축을 병렬 진행(매칭 정확도·데이터 정직성·RPA 견고성·프론트 UX 데모리스크),
각 축에서 재현된 결함만 file:line 근거로 보고 → 트리아지·검증 후 수정. (실버그 발견 중심 감사.)

- **RPA 안전(smart_agent)**: ①파괴적 버튼(신청취소·회원탈퇴·삭제확인) 자동클릭하던 것 차단(_BLOCK)
  ②A-B 핑퐁으로 24스텝 낭비하던 것 클릭횟수 가드 ③'검색' 라벨 클릭이 검색폴백 영구비활성화하던 버그 수정
  ④최종 제출(신청/제출)은 human_submit로 사람 확인(비가역·법적) ⑤iframe URL 기반 인증감지. +테스트 6.
- **매칭 엔진(오추천 차단, 전부 회귀테스트)**: ①첫만남이용권→자녀없는 성인 ②에너지바우처→고소득 임신부
  ('수급 가구' 소득게이트 인식) ③유아학비→학령기 자녀 ④근로장려금→무직 ⑤청년전세대출→중위200% 청년.
- **데이터 정직성**: 긴급복지 4인 162만(2023)→199만(2026)·한부모 63%→65%·청년미래적금 링크 정정.
  교육활동지원비(초502·중699·고860천)는 웹검증상 2026 정확 → 유지(무근거 변경 안 함).
- **프론트 UX**: ①0건 결과 '0개예요' 축하 문구 제거→격려/관련복지 안내 ②AI검색 실패시 전체 5천건 덤프 방지
  →로딩/오류 명확 안내 ③모바일 다국어칩 onTouchStart 프리워밍.
- 품질: 프론트 282 + 백엔드 28 통과, lint/tsc/빌드 0. 감사가 '깨끗'으로 확인한 축(연령/장애/한부모/지역/
  민간과장/성별 게이트)은 회귀로 이미 고정돼 있어 재확인만.

---

## 지능형 에이전트 고도화 (2026-07-04) — "첨 보는 사이트도 화면 읽고 발급"

사용자 요청("playwright보다 더 좋은 방법·openclaw식 웹접근·처음 보는 사이트도 파악")에 따라
browser-use/Skyvern류 LLM 결정 계층을 우리만의 Mbuster 통과 실행 계층(진짜 크롬+CDP) 위에 얹은
`backend/smart_agent.py`(관찰→판단→실행)를 다음과 같이 실전형으로 고도화:
- **하이브리드 라우팅**: 실측 검증 8종은 결정적 경로(`local_agent`)로 확실하게, 처음 보는 서류만
  화면읽기 탐색 → 데모 안정성 + 일반화 동시. (`run_smart` 앞단 `resolve_doc` 게이트)
- **검색-우선**: 발급 버튼이 안 보이면 정부24 검색칸에 서류명 입력+Enter(`search` 액션)로 스스로 찾아
  발급 진입. LLM 키 없이(휴리스틱)도 처음 보는 서류를 검색으로 탐색.
- **비전**: Gemini 멀티모달로 화면 스크린샷+DOM 동시 판단, DOM에 없는 위젯은 `click_xy` 좌표클릭.
- **판단부 유닛테스트 8건**(`tests/test_smart_agent.py`) — 브라우저·LLM 없이 결정 로직 회귀 고정.
- 문서 반영: 상세기획서 §5.4·발표대본 신청 파트·심사전략 3층 스토리·LOCAL_AGENT.md.
- **매칭 골든 추가(3종)**: 고소득(중위150%)→자산심사형 배제, 복합(70세·장애2급)→노인+장애 동시 노출,
  성별 게이트 회귀. 학생(22세)→민간장학 9건 정직 노출 실측 확인.
- **실버그 발견·수정(성별 게이트)**: 남성 프로필에 '여성청소년 생리용품' 등 여성전용 급여가 뜨던 것
  (엔진에 성별 게이트 부재) → 프론트+백엔드 동일 수정(보수적: gender=='male'만 배제, other/female 포용 —
  트랜스·논바이너리·미지정 포용). 15세 남성 결과에서 생리용품 사라짐 실측 확인.
- **레포 위생**: 추적되던 vitest 캐시(node_modules/.vite/...results.json) 제거 + 루트 node_modules gitignore.
- 품질: 프론트 272 + 백엔드 23 통과, lint/tsc/빌드 0. (결정 계층 LLM은 GEMINI_API_KEY 있을 때 최상 —
  없으면 검색-우선 휴리스틱으로 축소 동작. 이 PC엔 키 없어 휴리스틱 경로로 검증함.)

---

## 냉정한 심사 평가 대응 (2026-07-04, 라이브 검증 완료)

'심사위원 시뮬레이션' 방식의 독립 냉정 평가 → 지적 5건 전부 조치(라이브 브라우저로 동작 확인):
- **#1 (최대 임팩트) 백엔드 배포 시 실제 AI 에이전트 노출**: 프론트가 /ws/analyze를 안 써서 배포해도
  노드가 안 보이던 갭 → `BackendAgentStream.tsx`가 VITE_API_BASE 있으면 10노드(reflection 루프 포함)
  실시간 스트리밍. 안전망(45초 폴백)·API_BASE 없으면 기존 온디바이스 오버레이(프로덕션 무영향).
  ⇒ Render 배포하면 심사위원이 진짜 에이전트 추론을 봄. 백엔드 부팅·WS·health 실측 검증.
- **#2 가짜 'AI 분석중' 연출 제거(정직성 최대 취약점)**: setInterval 8단계 가짜 → `AnalyzingOverlay`가
  실제 온디바이스 신경망으로 5천여 정책 의미유사도 계산(semanticDiscover), 표시 숫자도 실측. 라이브 O.
- **#3 다국어 wow 노출**: 홈 히어로에 외국어 칩(베트남어·영어·중국어)→AI 의미검색(호버 프리워밍). AiDiscovery 결과화면 자동실행.
- **#4 킬러 기능(RPA) 발견성**: `RpaShowcase.tsx` 홈 섹션(목업 아님·본인인증만 사람·8→1단계) +
  `docs/기획서자료/RPA-시연영상-가이드.md`(60초 촬영 컷).
- **#5 추론 느낌**: `nearMiss.ts` '아깝게 놓친 복지'(소득만 조금 초과한 정책을 근거와 함께, 과장 없이).
- 자연어 파서도 보강(다문화 출신국·학생/직장인·주거위기). 프론트 269 테스트 통과.
- **계정 소유자 몫(가장 중요)**: ①Render Blueprint 배포+Gemini키+VITE_API_BASE ②웹스토어 제출+RPA 영상.

## 야간 작업 배치 성과 (2026-07-04) — 백엔드/에이전트/문서 담당분

동시에 다른 작업 환경에서 프론트(i18n·perf·a11y·golden테스트)를 작업 중이었음 → 커밋 전 항상 `git pull`.

- **매칭 정확도(핵심)**: ①소득 상한 게이트(연령만 맞으면 저소득정책 오탐 제거 — 프론트+백엔드 mock+/estimate) ②상황 관련도 개인화 정렬(`situationRelevance`: 장애인엔 장애·영아부모엔 육아 먼저) ③괄호변형 중복제거(`nameKey`) ④백엔드 LangGraph 자격판별 노드 정렬·디듑(기초연금이 문화누리카드 아래 묻히던 것 수정) ⑤/estimate 상위10 정렬누락 버그. 10페르소나 감사 0오탐.
- **CDP 로컬 에이전트(핵심)**: `selftest_agent.py`(로그인~자동입력 9/9 재검증), 연결 재시도, 서류 8종(가족관계·국민연금가입자 AA040 없어 정직 제외), 다중서류 1회 로그인. CDP 경계 실측: 정부24=완전 자동입력 가능, nhis=webplay.jsp(DOM 없어 불가), bokjiro=eForm 복잡.
- **헤드라인 실증**: `frontend/scripts/verify-semantic.mjs` — 다국어 AI 검색이 실제로 됨(베트남어 실직→긴급복지, 중국어 장애→장애인의료비 등). LangGraph 10노드 Mock 실행도 검증.
- **데이터**: 민간재단 20곳(놓치기 쉬운 장학·자립·위기, 전 도메인 실측). 시드 2026 금액 정확성 재확인(기초연금 349,700·선정 247만 = 공식 일치).
- **문서**: 상세기획서 전면 심화(문제정의 실데이터 137만·몰라서70.9%, AI Agent 4대능력, CDP 3방식비교, 다국어 실측표), 발표대본 오프닝 강화.
- **품질**: 프론트 258 + 백엔드 14 통과, lint/tsc 0, 라이브 배포 반영.
- **리뷰가 잡은 심각 버그 수정**: 지자체(LOC) 지역 누수 — LOC target의 '[시도]' 접두사 때문에
  isSummaryPolicy가 false→정밀 분기(지역 무필터)로 빠져, 서울 사용자에게 하동군·제주 정책이
  0.95 강력추천으로 노출되던 것(감사: LOC 233 중 타지역 180→수정후 35/0/0). LOC를 정밀 분기에서
  제외해 항상 지역필터 있는 inferred로 라우팅. `region-gate.test.ts` 회귀 고정. + 리뷰 지적 4건 추가 수정
  (LOC 시드명 스킵 예외, 다중서류 예외격리, 비010 휴대폰, 자격판별 dedup eligible 우선).

---

## RPA 근본 해법 (2026-07-03 오후) — 진짜 크롬 + CDP 로컬 에이전트

사용자가 "확장 말고 다른 방식(로컬/서버/원격제어) 다 좋으니 자동발급·신청만 되게 하라"고 해서 전환.
- **핵심**: 사용자 진짜 크롬을 `--remote-debugging-port=9222`로 띄우고 Playwright `connect_over_cdp`로 연결.
  → navigator.webdriver=false라 정부24 Mbuster 통과(실측) + Playwright 신뢰클릭·프레임 API(확장 debugger보다 안정).
- **실측 성공**: 로그인→Mbuster통과→간편인증→`simpleCert.html` iframe→이름·생년월일·휴대폰뒤8자리·전체동의
  자동입력까지 진짜 크롬으로 검증. 셀렉터 실측 확정(`#oacx_name/#oacx_birth/#oacx_phone2/#totalAgree`,
  `button.login-type`+텍스트, `li:has-text('카카오톡')`, 요청버튼 `#oacx-request-btn-pc`).
- **실행**: 루트 `run-agent-cdp.bat` 더블클릭 → 크롬 열림 + `backend/local_agent.py` 실행.
  최초 1회 이름·생년월일·휴대폰 입력(→`backend/agent_profile.json`, 로컬 전용/gitignore).
- 본인인증(카카오 폰 승인)만 사람 → 이후 발급폼·신청·문서출력(popup)·PDF저장(바탕화면\모두봄서류) 자동.
- **남은 검증(실계정 인증 필요)**: 카카오 승인 후 발급폼→신청→문서출력→PDF e2e 1회 완주.
- Node CDP 탐색도구: scratchpad `pwtest/cdp-mbuster.mjs`(Mbuster통과 확인), `cdp-iframe.mjs`(위젯 셀렉터 매핑).
- 확장(0.1.27)은 폴백으로 유지. 문서: `backend/LOCAL_AGENT.md`.

## (이전) 2026-07-03 — 크롬 확장 RPA 경로

- **RPA 메인 경로는 이제 크롬 확장(`extension/`, v0.1.21)**: 배포 사이트에서 서버·Python 없이
  등본 등 서류 13종 자동발급 + 복지로/장학재단 신청. 실사용자(김주형) 크롬에서 단계별 검증 중.
- **핵심 기술 돌파**: 정부24 버튼들은 isTrusted(진짜 클릭)만 받음 → `chrome.debugger`
  `Input.dispatchMouseEvent`로 진짜 클릭 구현(TRUSTED_PREP→좌표 재계산→TRUSTED_CLICK 2단계 —
  attach 시 안내바가 페이지를 밀어 좌표가 어긋나는 문제 해결). 오버레이 가림은 elementFromPoint 검사로 회피.
- 간편인증(카카오) 자동입력 동작 확인됨(0.1.18에서 위젯 오픈+이름·생년월일·휴대폰·전체동의까지).
  이름은 프로필(데모 페르소나)이 아니라 서류 도우미의 '실명' 칸(rpaInfo.name) 사용(0.1.19).
- **진단 추적기**(0.1.20): 확장이 매 단계 기록 → 팝업 '진단 복사' 버튼으로 클립보드 복사
  → 사용자가 붙여넣어 주면 원인 정조준 가능. 막히면 이 진단 결과부터 확보할 것.
- **자동 회귀**: `node extension/selftest.mjs`(playwright-core+번들 chromium 필요, 브랜드 크롬은
  --load-extension 제거됨) 7/7 통과. 로그인 이후는 Mbuster가 자동화 브라우저 차단 → 실사용 크롬만 검증 가능.
- **두 컴퓨터 운영**: 작업 PC(IT)는 루트의 `update.bat` 더블클릭으로 최신화(머지 꼬임 자동 정리).
  git 계정 팝업은 BioCode67 선택 + `git config --global credential.https://github.com.username BioCode67`.
- **남은 검증**: applyMinwonForm '신청하기' 자동 클릭이 실브라우저에서 실제로 눌리는지(0.1.19~21 수정 적용
  후 미확인) → 안 되면 진단 복사 결과로 조준. 이후 전자서명→문서출력→PDF 저장까지 e2e 1회 완주가 목표.
- **기획서**: `docs/기획서자료/상세기획서-초안.md`(제출용 전문 초안, 마감 7/7) + 자료모음·발표대본 최신화.

---

## (이전) 2026-07-01 인수인계 — 로컬 에이전트(백엔드 RPA) 경로

## 실행 방법 (윈도우, 무관리자 설치본)
- **한 번에 실행:** 프로젝트 루트의 `run-windows.bat` 더블클릭 → 백엔드(:8000) + 프론트(:5173) 새 창 기동.
- 런타임(이미 설치됨): Node(포터블) `%LOCALAPPDATA%\Programs\nodejs`, Python(NuGet) `%LOCALAPPDATA%\Programs\py311nuget`, 백엔드 venv `backend\venv`.
- 백엔드 실행 시 `PYTHONUTF8=1`(한글 콘솔 크래시 방지) + `RPA_BROWSER_CHANNEL=msedge` 환경변수 필요(run-windows가 자동 설정).
- 포트가 이미 사용 중이면 이전에 띄운 서버가 살아있는 것 → 재사용하거나 종료 후 재기동.

## 오늘 변경한 것 (아직 미커밋)
- `backend/rpa/base.py`
  - `get_launch_options()` — 윈도우에서는 번들 Chromium(SxS 오류) 대신 설치된 Edge(msedge) 사용. 맥/리눅스는 기존 번들. env: `RPA_BROWSER_CHANNEL`, `RPA_HEADLESS`.
  - `save_document()` — 발급된 서류를 PDF로 `바탕화면\모두봄서류`에 자동 저장(CDP printToPDF, 실패 시 PNG 폴백).
- `backend/rpa/{gov24,apply,nhis,work24}_rpa.py` — 모두 `get_launch_options()` 사용. gov24·nhis는 발급 성공 시 `save_document()` 호출.
- `backend/rpa/orchestrator.py` + `backend/api/routes.py` — 무인 여정 엔진: `POST /api/journey/plan`(계획), `POST /api/journey/run`(순차 발급→저장→신청), `GET /api/journey/status/{id}`(추적).
- `backend/main.py` — 로컬 에이전트 브릿지(백엔드): CORS에 `https://biocode67.github.io` 허용 + Private Network Access 헤더. (배포 웹이 사용자 PC의 이 에이전트를 호출 가능하게)
- 루트: `run-windows.bat`, `run-windows.ps1`, `scripts/restore-handoff.windows.sh` (윈도우 실행/복원 스크립트).

### 이번 작업 구간 추가 변경 (2026-07-01 오후, 아직 미커밋)
- `frontend/src/lib/backend.ts` — 로컬 에이전트(localhost:8000) 감지(`export let API_BASE` 라이브바인딩). → gh-pages 재배포 완료(Supabase/onrender 제외).
- `frontend/src/components/ChatWidget.tsx`, `QuickAsk.tsx` — 폴리시(모바일 홈 FAB 겹침 해소, 비활성 버튼 대비).
- `backend/rpa/gov24_rpa.py` — plus.gov.kr/login + simpleCert iframe 대응.
- `backend/rpa/apply_rpa.py` — 복지로 loginView.do + eForm + fincert 대응.
- `backend/rpa/base.py` — `click_eform_button`(eForm 좌표 신뢰클릭), `get_frame_by_url`, 카카오톡 셀렉터 보강.
- ※ 위 항목들은 커밋 완료(main). 배포는 gh-pages 반영.

### 헤드라인 기능 추가 — 온디바이스 다국어 AI 의미 검색 (2026-07-01, 커밋·배포 완료)
- 브라우저에서 직접 도는 신경망 임베딩(`multilingual-e5-small`)으로 복지를 의미로 검색. 한국어/영어/베트남어 등 다국어 교차검색(외국인·다문화 사각지대). 서버 전송 없음(기기 내 실행).
- `src/lib/semanticSearch.ts` + 탐색 'AI 의미 검색' 토글(옵트인 지연로드) + `scripts/embed-policies.mts`(`npm run embed`) + `public/policy-embeddings.json`.
- 운영: 첫 로드 ~128MB(CDN), 이후 캐시로 즉시. 데모 전 토글 1회 프리워밍 권장. 미사용 WASM은 `scripts/clean-wasm.mjs`가 배포 시 제거.

## 동작 확인 현황 (확인됨 / 미검증)
- 확인됨: 건강보험 자격득실확인서(nhis) 자동발급 — 실제 사이트 접속→간편인증 위젯→카카오톡 선택→정보입력→인증요청→카카오 승인 대기 지점까지 실동작. + PDF 자동저장(153KB) 검증.
- 확인됨: Mock 발급(`/api/documents/issue`), 여정 API, CORS/PNA 프리플라이트 검증.
- 확인됨: 정부24 로그인+발급 흐름 갱신·보강(2026-07-02) — `plus.gov.kr/login` + `button.login-type` 간편인증 + simpleCert iframe(oacx) 내 카카오톡/폼. 간편인증 폼 자동 도달은 여러 번 검증됨(정보입력 폼까지). 발급 흐름 보강: 로그인 후 발급 폼(AA040)로 직행(안내 AA020 저장 방지), 회원/비회원 모달 자동 처리, 본인인증 폼 자동입력(이름·생년월일·휴대폰), 결과 미도달 시 완료 오판 방지 가드, 대기 480초.
  - 정직한 상태: 과거 저장된 "등본 PDF"는 실제 등본이 아니라 안내 페이지(AA020)였음(발급 미완). 승인 이후 실제 발급→PDF는 아직 미검증 — 카카오 폰 승인이 물리적으로 필요(간편인증 강제, 비회원도 인증 필요). 현재까지 실런 3회 모두 폼에서 폰 승인 미완료로 타임아웃. 승인 1회만 완료하면 그 이후 흐름을 관찰·보정해 완성 가능.
- 확인됨: 복지로 로그인 갱신 완료(2026-07-01) — 새 URL `loginView.do`(tx 자동), eForm(Clipsoft `.cl-button`) → 좌표 기반 신뢰클릭 필수, 간편인증 위젯은 yeskey fincert(정부24 oacx와 다름, 메인 오버레이). `apply_rpa.py`·`base.py`(`click_eform_button`) 갱신, 카카오톡/폼 도달까지 검증. 서비스 이동·신청 폼은 실런에서 확인 필요.
- 미검증: 위 두 흐름의 카카오 승인 이후 구간(세션 유지·서비스 페이지·발급/신청)은 사용자 폰 승인이 있어야 끝까지 검증 가능 → 실제 런 예정.

## 다음 할 일 (우선순위)
1. **[완료] [프론트] 로컬 에이전트 브릿지** — `backend.ts`가 localhost:8000 감지(`export let API_BASE` 라이브바인딩). `npm run deploy` 재배포(Supabase/onrender 제외한 폴리시만). 실제 Edge(headed)에서 라이브→로컬에이전트 도달 검증 완료(headless는 PNA로 막힘, 데모 무관).
2. **[완료] [백엔드] 정부24 plus.gov.kr 갱신** — 로그인 폼 도달 검증. (카카오 승인 이후 서비스→발급 실런 검증 남음)
3. **[완료] [백엔드] 복지로 로그인 갱신** — 간편인증 폼 도달 검증. (신청 폼 실런 검증 남음)
4. **[실런] 정부24·복지로 카카오 승인 end-to-end** — 사용자 폰 승인으로 서비스→발급/신청→PDF까지 최종 확인 + 남은 셀렉터 보정.
5. **[프론트] "담은 복지 전부 원클릭 자동발급/신청" 버튼** → `/api/journey/run` 호출.
6. (추후) 에이전트를 Tauri/Electron 설치본으로 패키징.

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
- 카카오 본인인증·신청 최종 제출은 사용자 직접(법적·비가역). 완전 무인 대리승인은 명의도용이라 만들지 않는다.
- 가짜데이터 금지 / 자동화 현실 과장 금지. 실제 검증된 것만 "된다"고 말한다.
- 커밋: 한국어 conventional commit, 자동 생성 서명 금지. user.name/email은 BioCode67.
- 배포 라이브: https://biocode67.github.io/modoo-bom/ (gh-pages). 재배포 `cd frontend && npm run deploy` + 소스 `git push origin main`(별개).
  - 배포는 기본 안전: `frontend/.env.production`이 Supabase·onrender를 빈 값으로 override → 로그인/죽은 백엔드가 라이브에 안 샘(누가 `npm run deploy` 해도 OK). 라이브에 로그인 켜려면 `.env.production`에 실제 값 채우기.
  - ⚠️ RPA 데모는 반드시 `localhost:5173`(run-windows.bat)에서 — 로컬 프론트는 vite 프록시(`/api`→:8000)로 백엔드를 안정적으로 감지해 "에이전트로 신청" RPA 버튼이 켜진다(검증됨). 배포 사이트(github.io)의 로컬 감지는 브라우저 Private/Local Network Access 정책 때문에 불안정(https→http localhost 요청이 간헐적으로 hang). 서버는 CORS/PNA를 정상 응답하지만 브라우저 정책은 클라이언트로 못 넘음. → 서류 자동발급/신청 시연은 로컬 앱에서 할 것.
  - AI 온디바이스 모델(~128MB)은 첫 사용 시 CDN 다운로드 → 시연 전 AI 토글 1회 프리워밍 권장(캐시 후 즉시).
