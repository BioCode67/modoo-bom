# CLAUDE.md — 모두봄 (ModooBom)

> 개인 복지 자산 관리 AI Agent · 2026 AI·SW 중심대학 디지털 경진대회 SW부문
> 3주차 프로토타입 (version 0.3.2)

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 프로젝트 컨텍스트입니다.

---

## 무엇을 하는 프로젝트인가

사용자 프로필(나이·소득·가구유형·장애·자녀·생애이벤트 등)을 입력하면,
LangGraph 10노드 에이전트가 복지 정책 DB에서 적합한 혜택을 선별하고,
신청 가이드·예상 금액·필요 서류를 안내한 뒤, **실제 정부 사이트 RPA**로
서류 발급·복지 신청까지 자동화하는 풀스택 데모.

OpenAI 키가 없어도 **Mock 모드**로 전체 파이프라인이 동작한다(데모 핵심 장치).

---

## 기술 스택

### Backend (`backend/`) — Python 3.11+
- **FastAPI 0.115** + uvicorn — REST + WebSocket 서버
- **LangGraph 0.2.56** + LangChain 0.3 — 10노드 StateGraph 에이전트
- **LLM** — 지식형 챗은 **Gemini 2.5 Flash**(실패 시 Groq→Claude 자동 폴백, `agents/llm.py FallbackChatLLM`). langchain-google-genai/groq/anthropic 모두 설치, 키 없으면 규칙 모드.
- **ChromaDB 0.5.23** — 복지 정책 RAG. 검색은 **하이브리드(BM25 주도 1.0 + 임베딩 0.6 가중 RRF,
  `rag/search.py`)** — 기본 임베딩(영어 최적)이 한국어 질의에서 약한 것 실측 보완(2026-07-19).
  시딩은 카탈로그 5,143건+시드, **건수 기반 멱등 스킵**으로 재부팅 2초(강제 재시딩 RAG_RESEED=1)
- **Playwright** — 정부24·건강보험공단·고용24 실제 브라우저 RPA
- **pydantic 2.10** — AgentState / UserProfile 스키마
- **pytest / pytest-asyncio** — Mock 모드 유닛+통합 테스트

### Frontend (`frontend/`) — Node 20+  ⚠️ 2026-06 전면 리디자인
- **React 18** + **Vite 6** + **TypeScript 5.7** + **TailwindCSS 3.4**
- **React Three Fiber / three / drei** — 3D 새싹 마스코트 히어로(코드 분할 lazy)
- **framer-motion** — 진입/스크롤/페이지 전환 애니메이션
- **@huggingface/transformers (transformers.js)** — **온디바이스 다국어 AI 의미 검색**용
  임베딩 모델(`multilingual-e5-small`)을 브라우저에서 직접 실행(지연 동적 import, 서버 전송 없음)
- **zustand (persist)** — 뷰 라우팅·관심목록·신청상태·프로필/결과 캐시 (localStorage)
- **lucide-react** — 아이콘 · Pretendard 폰트 · 봄/새싹 카툰 라이트 테마
- **클라이언트 복지 엔진**(`src/lib/welfare-engine.ts`) + 정책 120건(`src/data/policies.ts`)으로
  **백엔드 없이도 전 기능 동작**. 백엔드가 있으면(`src/lib/backend.ts` 감지) RPA 자동발급 등 활성화.
- 구 컴포넌트/WebSocket 훅/shadcn ui는 리디자인하며 제거됨. (백엔드 WS 엔드포인트는 유지)

#### 프론트 구조(신규)
```
src/
├── App.tsx                 # 셸: Navbar + 상태기반 뷰(home/analyze/explore/my) + ChatWidget
├── store/useAppStore.ts    # zustand persist 전역 상태
├── data/policies.ts        # 복지 정책 120건 (sample_data.py 포팅)
├── lib/
│   ├── welfare-engine.ts   # 자격판정·키워드·가이드·혜택계산 (mock_responses.py 포팅)
│   ├── format.ts · officialLinks.ts · backend.ts · utils.ts
├── three/                  # SproutMascot, HeroScene, MascotCanvas(lazy+폴백)
├── sections/               # Home(Hero/HowItWorks/Features/Faq/Footer), Analyze, Explore, My
├── components/             # ProfileWizard, ResultsView, PolicyCard, PolicyDetailDrawer,
│                           #   TrackedCard, CompareModal, DocumentCenter, ChatWidget, Navbar
└── ui/                     # SproutLogo, SectionHeading
```

### 복지정책 카탈로그 (확장 가능)
- 프론트는 **동적 카탈로그**(`src/data/catalog.ts`): 내장 시드 190건(POL 124·SUP 33·PRV 21·HOU 7·FIN 5) + 런타임에 `public/policies.json` 병합
  (`useCatalog` 훅으로 자동 리렌더). 엔진/탐색기/챗봇/대시보드/모니터링 모두 `getCatalog()`/`getPolicyMap()` 사용.
- **ETL**(`backend/etl/ingest_welfare.py`): 공공데이터(한국사회보장정보원 중앙부처 복지서비스)를 Policy 스키마로
  정규화해 `frontend/public/policies.json` 생성. CSV 모드(키 불필요, 367건) / OpenAPI 모드(B554287, 1,600+건).
  실데이터만 처리(가짜 미생성). 확장 후 `npm run deploy`로 반영. → "사이트마다 흩어진 정책" 문제 해결책.
- **ETL 확장**(`backend/etl/ingest_gov24.py`, 2026-07-19): 보조금24(행안부 15113968) 수혜서비스 →
  기존 카탈로그에 이름 디듑 병합(기존 우선, 지자체는 LOC-·중앙은 GOV-B24 네임스페이스). 컨테이너에서
  실API 스키마 실측 불가(정부망 차단)라 **후보 키 관용 매핑 + `--probe` 실측 확인 절차 강제**(날조 금지).
  사용법·차순위 추천(고용24·LH 마이홈)은 `docs/데이터-API-확장-가이드.md`.

### 에이전트 자동화 / 사후관리 — 정직한 현실 (중요)
실제 동작 범위를 과장하지 말 것. 코드 검증 기준:
- **서류 발급/신청 RPA**(`backend/rpa/*.py`, Playwright): 정부24·복지로·건보·고용24 **실제 페이지 자동화**. chromium 설치됨, 스택 구동 확인. 단 **headed 모드 + 카카오 본인인증은 사용자가 직접**, **최종 제출도 사용자 확인**(비가역·법적 행위라 의도된 안전장치). `apply_rpa`는 로그인→서비스 딥링크 이동→'신청하기' 클릭→양식에 이름·생년월일·연락처 자동 입력까지 진행 후 **제출 직전 정지**. **정적 배포 사이트에선 백엔드가 없어 미동작** → 공식 링크 안내로 폴백.
- **완전 무인 자동 제출은 설계상 불가**(정부 본인인증 필수 + 비가역). human-in-the-loop가 정답.
- **사후관리/모니터링**: 과거 `result_tracker`는 `random.choice`로 가짜 상태를 날조 → **제거함**. 이제 정직한 안내만. 실제 추적은 **프론트 `나의 복지`의 모니터링 엔진**(`src/lib/monitoring.ts`)이 사용자 기록(신청일/점검일)+정책 갱신주기로 서류미비·신청권유·진행점검·갱신임박을 산출(배포에서도 동작). 정부 서버 실시간 상태조회는 사용자 세션 없이는 불가 → 공식 조회 링크로 안내.
- **무설치(확장 없이) 1급 경로 — 2026-07 강화**: ① 서류·신청 딥링크 정밀화 — 등·초본(CappBizCD 13100000015)·가족관계(97400000004) 등 정부24 민원 직행 + 복지로 신청 딥링크 27종(별칭 포함 29키, `quickApply.KNOWN_APPLY_URLS`, wlfareInfoNm 라이브 대조) — 전부 실측 검증, `npm run check:links`로 상시 재검증(정부24 13 + 복지로 27 = 40건). ② **이어서 발급**: 서류 도우미 배너 CTA가 남은 전자증명서 서류를 순서대로 안내(정부24 로그인 유지 — 확장의 연쇄발급을 무설치 재현), 발급완료는 `docDone`(persist)으로 기억. ③ **복귀 확인 반자동 기록**(`ReturnConfirm`+`returnPrompt`): 정부 탭에서 돌아오면 '완료하셨나요?' 1탭 확인 — 사용자가 '네'를 눌러야만 applied/발급완료 기록(클릭=완료 날조 금지). ④ 팝업 차단 감지(oneTapApply `opened`), 프리필은 '이름 값만' 복사+신청 키트 순차 복사(정부 폼은 필드별 input). `isCertIssuable`은 URL 정규식 → `docLink().issue`('wallet'|'online') 명시 필드로 승격(가족사진·이직확인서 거짓양성 제거). ⑤ **내 서류함**(데스크탑앱): 자동발급 불가 서류(임대차계약서·신분증)를 `POST /api/documents/register`로 발급 폴더에 발급물과 같은 이름 규칙 저장 → 신청 자동첨부(`recent_issued_docs`가 JPG 포함) 대상. **📷 서류 촬영**(`DocCameraModal`+`lib/docScan`): 카메라로 찍어 자동 대비/흑백 보정·**90° 회전**·**✂️ 자르기(크롭, 옵트인 — 모서리 드래그로 배경 제거, 기본은 원본)** 후 여러 장을 A4 PDF(의존성 없는 `jpegPagesToPdf`, JPEG를 DCTDecode로 임베드)로 만들어 등록(데스크탑) 또는 내려받기(웹) — 전부 온디바이스, xref 정합·크롭 축소까지 실브라우저 테스트. **CSP img-src에 blob: 없어 파일선택은 FileReader data:로 로드**(blob: URL 차단 우회). `_auto_attach`는 저장명 '서류명_이름'에서 신청인 이름 접미를 떼고 폼 라벨과 대조(다건 첨부 성립). ⑥ **자동신청 노출 일반화**: `application`이 표시문자열이어도 `bestApplyUrl`이 복지로 딥링크로 해석되면(청년월세지원 등) `AgentSubmitButton`이 뜬다(`isBokjiroApplyable` 단일 기준 — 홈만 나오는 방문형은 제외). 자연어 진입은 주거지원 문의 시 미언급 소득을 중위(50)로 보정해 물어본 혜택이 숨지 않게(`parseQuery`), 검색은 이름 가산을 공백무시로('청년 월세 지원'→청년월세지원 최상위). ⑦ **데스크탑앱 신뢰성 런(2026-07-16)**: 🗂 서류함 가시화 — `GET /api/documents/list`(표시명·`attach_candidate` 서버 단일판정)+`POST /api/documents/delete`(베이스네임만·realpath 이탈 차단)+`DocVault`(목록·첨부후보 배지·2탭 삭제·폴더 열기, 등록/발급/리셋 시 `notifyDocsChanged` 이벤트로 갱신). 📎 신청 전 **자동첨부 미리보기**(AgentSubmitButton, 서버 attach_candidate 기준). 🤖 **상태 스트립**(`AgentStatusStrip`: 연결·버전·발급 슬롯 — backend.ts가 health의 version/rpa_capacity를 Capabilities로 승격) + **[발급 전 점검]**(`GET /api/_preflight` — 브라우저 기동·정부24/복지로 연결(_probe_site: HTTP 응답=OK, 망오류만 실패)·발급폴더 쓰기·디스크 5항목 병렬, 실패해도 200+정직 목록) + 🩺 **[진단 복사]**(`GET /api/_diag` — PII 무포함 계약 테스트로 고정). 🔁 **세션 연속성**(`lib/liveTasks`: sessionStorage 45분 TTL, 시작 시 기억→마운트 시 폴링 재개, 종결/404 정리; 폴링은 `pollDocTask`/`pollJourney`/`pollApply`로 시작·복원 공용화; 훅은 조기 return 앞+TDZ 회피 — **변화 기반 렌더**: 세 루프 모두 직전 응답 원문(prevBody) 비교로 같으면 setState/파싱 생략, 인증 대기 중 리렌더 0회·구형 PC CPU↓). 여정 현재 단계 카드에 **진행 실화면**(journey_view current_screenshot, 토큰 인가 시) 매핑 — 단건 발급과 파리티. 🚀 **여정 진행률 헤더**(n/m·현재 단계·33%바)+**전체 중단 확인**(카드 ⏹이 여정 전체를 조용히 끊던 것 방지)+**⏭ 개별 단계 건너뛰기**(`request_journey_skip`: skip_step_task_id로 취소 사유를 식별해 이 단계만 cancelled·여정은 계속, 큐대기/협조취소/하드취소 3경로 모두 skip-aware, `/api/journey/skip/{id}` local_server·routes 양쪽) + 📱 **인증 대기 알림음**(`lib/authCue`: waiting_login '전이'에만 Web Audio 2음, 3초 디바운스, 단건·여정(단계별)·신청 3루프 연결). 📨 **여정 신청 카드 완결**: apply 단계 전용 완료 문구('신청 양식 준비 완료' — 서류용 '발급 미완료' 오문구 수정) + '제출까지 마쳤어요' 기록 CTA(직접 클릭만 applied 기록, tracked.status가 진실) → 원클릭 경로도 사후관리로 연결. 여정 **종결 요약 배너**(발급 n·건너뜀 n·신청 준비 n — 0건 생략, 무언 종료 방지). **발급 성공 자동 기억**: saved_path 확인된 발급만 docDone(persist) — 재실행 중복 발급 방지, 카드가 방금 성공(st.saved)이면 결과 UI(다운로드 링크)가 done 칩보다 우선. 탭 제목 **완료 배지**(`lib/titleBadge` — 백그라운드일 때만). 신청 **종결 CTA**(done: '제출까지 마쳤어요' 직접 클릭 기록+나의복지 이동 / error: '처음부터 다시'+공식 폴백 — 막다른 UI 제거). ✅ **검증형 리셋**('파일 N건 지움' alert, 실패 은폐 금지). 원격 RPA 옵트인 시 '서버 미전송' 문구 **사실대로 분기**(정직성). 🔒 **공유(터널) 배포 가드**: 서류함 계열·세션 리셋·셀프테스트/프리플라이트는 '본인 PC 전용' 무토큰 설계라 `RPA_SHARED=1`이면 403, journey/run already_running은 남의 token/ID 대신 503(유출 차단, routes 파리티) — 프론트도 rpaRemote면 DocVault·파일등록·첨부 미리보기·점검 버튼 비노출. **dist-app 캐시 정책**: index 등 비해시 no-cache(재빌드 즉시 반영)·/assets/ immutable — 재빌드 후 stale index가 삭제된 해시 자산을 참조하던 흰 화면 방지. 가이드형 챗봇도 에이전트 연결 시 자동화 경로 안내(`chatAgent` agentOn — 웹은 전자증명서 경로 유지). 전부 `e2e/desktop-smoke.py`(local_server+dist-app 실셋업 16종 검증)로 회귀 고정.
- **데스크탑 심화(2026-07-19)**: 🔑 **진짜 한 번 인증 연쇄** — 정부24 2종+ 여정은 `rpa/session.py GovSession` 공유 브라우저(로그인 인증 1회, 후속 서류 '같은 로그인으로 이어서' 폼 직행, 만료·창닫힘은 재로그인/ensure 재생성 자연복구, 안전밸브 `RPA_ONE_LOGIN=0`, 요약에 one_login 사실 표기) + 🔁 문서 단계 **오류 1회 자동 재시도**(취소·스킵·타임아웃 제외). 🗂 서류함: 종류별 그룹핑(최신본 대표+이전 버전 접기, `lib/vaultGroups`)·🧹 이전 버전 일괄 정리·👁 파일 열람(`GET /api/documents/file`, delete 동급 가드)·📦 묶음 ZIP. 🚀 **자유 선택 일괄발급**(지원 15종 체크→한 번 인증 연쇄, 부족분 기본 선택·카드 밖 서류 상태줄+진행 실화면) + **빈 상태 슬림 모드**(담은 복지 0+에이전트면 발급 도우미·서류함 동작 — My 빈 화면에서도 마운트). 📷 촬영: **문서영역 자동 감지**(Otsu 밝기, ✂️ 초기 박스 제안 — 원근보정 아님 명시)+**🖍 민감정보 가리기**(픽셀 덮어쓰기). 🌱 **새싹이 가이드**(`SproutGuide`+`GuideScene`: 분석/탐색/나의복지 구석 3D 미니 마스코트, 화면·상태별 다음 행동 한 문장, 홈 제외·2D 폴백·영구 숨김). 📎 자동첨부 **별칭 매칭**(`_ATTACH_ALIASES` — 라벨이 짧거나 동의어여도 첨부). 큰글씨 체크박스 정렬 수정(min-height 예외). 검증: vitest 750·pytest 231(전체 의존성 시 — chromadb 미설치 환경은 208 — 페르소나 5종은 전체 의존성 필요)·desktop-smoke **23종**·E2E 12스위트·axe 0, v0.3.2.
- 프론트 자동화 게이팅: `src/lib/useBackend.ts`(백엔드 감지) → 있으면 RPA(`AgentSubmitButton`/`DocumentCenter`), 없으면 가이드.

### 배포 — GitHub Pages (정적)
- **라이브: https://biocode67.github.io/modoo-bom/** · `gh-pages` 브랜치 서빙
- **자동 배포(2026-07-15 도입)**: main 푸시 시 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드 후
  `gh-pages`로 배포(peaceiris/actions-gh-pages) — 실행 이력 전부 성공. 수동 배포도 가능: `cd frontend && npm run deploy`
- Vite `base`는 빌드 시 `/modoo-bom/`, 개발 시 `/` (vite.config.ts)

### 기능·품질 현황 (전문화 완료)
- **데이터**: 시드 190건(정밀 규칙·검증 금액; 정부 124 + 지원사업 SUP 33 + 주택공고 HOU 7 + 서민금융 FIN 5) + **민간재단 큐레이션 21건**(`src/data/privatePolicies.ts`, PRV-###:
  현대차 정몽구 스칼러십·관정·삼성꿈장학·미래에셋(장학) + 심장재단·백혈병어린이·아산SOS·초록우산·밀알(의료·위기·장애) —
  전 항목 공식 사이트 실측 검증·URL 생존 확인, 심사·선발형 명시, 엔진에선 저신뢰 '관련 복지'로만 노출(과장 방지))
  + 한국사회보장정보원 공공데이터 OpenAPI(B554287)로
  **중앙부처 460 + 지자체 4,683 = 약 5,143건 실데이터**(`public/policies.json`, 약 3.3MB·gh-pages gzip 전송)를
  런타임 병합 → 총 **약 5,300건**(이름 디듑 후). 이름 기준 디듑(시드 우선). 가짜 데이터 미생성 원칙.
  키는 `backend/.env`의 `DATA_GO_KR_SERVICE_KEY`, 수집은 `python etl/ingest_welfare.py --csv <중앙CSV> --local`
  (ETL은 https+페이지 재시도로 견고). 더 받으려면 중앙부처(15090532)도 활용신청 후 `--api`.
  + **정책서민금융 큐레이션 5건**(`src/data/financialPolicies.ts`, FIN-###: 소액생계비대출·햇살론유스·햇살론 일반/특례·미소금융 —
  서민금융진흥원 kinfa.or.kr 2026 실측·URL 생존). **대출**이라 benefit에 '대출·상환' 명시(현금성 합산 제외), PRV처럼 저신뢰
  '관련 복지'로만 노출. ⚠️신용 '하위 N%'는 benefit에만(eligibility/target에 두면 incomeCeiling이 소득상한으로 오게이트).
  → 정부24·복지로·보건복지부는 이미 B554287 아그리게이터로 커버. 서민금융진흥원은 그 밖의 저소득·청년 금융 안전망 출처.
- **⭐ 온디바이스 다국어 AI 의미 검색(헤드라인)**: 브라우저에서 직접 도는 신경망 임베딩
  (`multilingual-e5-small`, `src/lib/semanticSearch.ts`)으로 복지를 **의미**로 매칭.
  한국어·English·Tiếng Việt 등 **다국어 교차검색**(외국인·다문화 사각지대). 정책 벡터는 빌드 시
  사전계산(`npm run embed`→`public/policy-embeddings.json`), 런타임은 질의만 임베딩. 탐색의 'AI 의미 검색'
  토글(옵트인 지연로드)+입력 언어 자동감지(`detectLang.ts`)+홈 카드 CTA. **서버 전송 없음**(프라이버시).
  **AI 답변 카드**(`aiAnswer.ts`: 검색결과 기반 요약, 환각 없음)+**음성 대화**(자국어로 말하면 음성으로 답)+
  **다국어 음성 입력**+정책 상세 **"AI로 비슷한 복지"**(`relatedPolicies`: 임베딩만, 모델 불필요)+모델 로딩 중 키워드 폴백+
  **결과 온디바이스 번역**(`onDeviceTranslate.ts`: 브라우저 내장 Translator API(Chrome/Edge 138+)로 AI 검색 결과 카드를 질의 언어로 기기 내 번역 — '자동 번역' 배지 명시, 미지원·실패 시 한국어 원문 폴백, 신청·자격 기준은 한국어 원문).
  운영: 첫 로드 ~128MB(CDN), 이후 캐시로 즉시 → 데모 전 프리워밍 권장. 미사용 WASM은 배포 시 제거(`scripts/clean-wasm.mjs`).
- **분석 엔진**: 시드는 키워드/규칙 기반 정밀 자격판정, 공공데이터(요약형)는 자연어 신호 추론으로
  '관련 복지'를 낮은 신뢰도로 제시(`inferFromText`). 결과는 핵심(POL-)·관련(GOV/LOC-)으로 분리 표시.
- **기능**: 3D 카툰 히어로(지연 마운트), 프로필 위저드+분석, **자연어 한 문장 즉시 분석**(`QuickAsk`/`parseQuery`, 음성 포함),
  **기초생활보장 급여 계산기**(2026 공식값, 가구원수→소득% + 생계·의료·주거·교육급여 **가구별 월 소득상한·게이지**, 탐색 상단 노출),
  **도메인 검색**(`lib/search.ts`: 생활어→행정용어 동의어 17군 + 개념단위 관련도 랭킹 — '노인 일자리' 다단어·'전세→주거' 생활어 매칭),
  정책 탐색(검색·정렬·금액필터·**지역(시도+시군구 2차)필터**·증분렌더, **지자체 지역배지**, **신청기한 ⏰배지**(`deadline.ts`)),
  나의 복지(관심·상태관리·**현금성** 혜택계산·비교·**사후관리 모니터링**), **'맨 위로' 버튼**(`ScrollTop`),
  서류 준비 도우미, **신청 키트**(공식 신청 딥링크 + **신청 자동화 흐름 스테퍼**(`ApplyFlow`: 추천·정보작성·서류=자동, 인증·제출=본인) + 내 정보 미리채움, `ApplyKit`/`prefill.ts`),
  에이전트 신청(백엔드 시), 가이드형 복지 챗봇, **음성 입력**(Web Speech)·**TTS 읽어주기**,
  **📞 통화형 상담**(`VoiceCall`, 2026-07-19 — 전화 걸듯 말로 묻고 소리로 듣는 어르신 우선 상담. 챗과 동일
  규칙 엔진(agentReply)·TTS 낭독 정제(`speakable.ts`)·음성 미지원 브라우저는 큰 입력창 이중 경로·axe 0,
  진입은 챗 헤더 📞 + 분석 모드화면 CTA, 스모크 3.7 고정). **말→즉시 진단**: 상황 문장(프로필 신호≥2, `profileSignalCount`)이면 통화 안에서 분석 실행·결과 음성 브리핑(현금 합계는 중복수급 한정어 포함)·결과 화면 CTA. **말→담기**: "담아줘"도 통화에서 실동작(matchSaveIntent 재사용, 나의복지 연결),
  **결과 인쇄/PDF**·**이미지 카드 공유**(Web Share), **복지 캘린더 .ics**, 생애주기 시뮬레이터, 가구분석,
  긴급복지 진단, 복지 점수·TOP3, **대표문의 전화 tel: 연결**, **포트폴리오 차트**(SVG), 온보딩,
  **로그인·동기화**(카카오·구글, Supabase 무료 티어, 선택 — 미설정 시 인증 UI 숨김 + supabase-js 트리셰이킹 제외, 설정은 `supabase/SETUP.md`),
  **PWA**(설치형·오프라인·autoUpdate·beforeinstallprompt), 큰글씨·고대비·ESC·ARIA·focus-visible 접근성, ErrorBoundary.
- **품질 게이트(모두 통과)**: `npm run lint`(eslint9 flat, react-hooks, 0건) · `npm test`(vitest **728**) ·
  `tsc --noEmit` · `npm run build` · E2E 스모크(`frontend/e2e/smoke.py`, 실브라우저 10여정 + e2e:chat/save/fin/ext + **e2e:a11y** — axe-core 전 화면(기본 4+고대비) 위반 0, 마운트 게이트로 무효 측정 방지) / 백엔드 `pytest`(**231** — 전체 의존성 설치 기준, chromadb 미설치 환경은 208 — 페르소나 5종은 전체 의존성 필요). 변경마다 브라우저 회귀 검증.
- **견고성 감사(2026-07)**: 다중에이전트 감사로 백엔드 확정결함 8건(extract_json dict 보장·RPA 태스크
  강한참조·chat 세션유지·카탈로그 파싱·검색캐시 사본·ETL _pick 섀도잉) + 프론트 5건(sidoOf 도우선·
  household_type/children_ages 무가드 접근·빈 카테고리 오매칭·parseMonthly 범위) 수정, 회귀 테스트로 고정.
- **데이터 정확성(2026 검증)**: 기초연금·장애인연금·아동수당(9세 확대)·생계급여(32%)·한부모(23만/65%)·
  청년도약(33,000)·교육급여·보육료·긴급복지·노인일자리·국가장학금을 보건복지부 등 공식 출처로 검증·정정.
  엔진 소득 자격판정은 2026 정밀 선정기준(생계32·의료40·주거48·교육/차상위50)으로 동작.
  `parseMonthly`는 '월 N만원' 표기까지 환산(원-우선)해 합계·정렬·현금성 필터가 정확.
- **scripts**(frontend): `dev` `build` `preview` `lint` `test` `deploy`.
- 데이터 확장은 `backend/etl/ingest_welfare.py`(CSV/--api/--local) → `public/policies.json`(런타임 병합).
  지자체 데이터는 data.go.kr 세션 게이트로 자동 다운로드 불가 → 사용자 다운로드 또는 무료 OpenAPI 키 필요.

---

## 실행 방법

### 로컬 개발 (권장)
```bash
# 1) 백엔드
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # ANTHROPIC_API_KEY 입력 (없으면 Mock 모드 자동)
uvicorn main:app --reload --port 8000
# 헬스체크: http://localhost:8000/api/health · API 문서: /docs

# 2) 프론트엔드 (새 터미널)
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

### 시연용 일괄 실행 (macOS, screen 기반)
```bash
./start.sh   # 백엔드+프론트+caffeinate를 screen 세션으로 백그라운드 기동, 브라우저 자동 오픈
./stop.sh    # 모든 screen 세션 + uvicorn/vite 프로세스 종료
# 로그: tail -f /tmp/modoo-backend.log  /  /tmp/modoo-frontend.log
```

### Docker Compose
```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build   # 또는 키 없이 Mock 모드
```

### 테스트
```bash
cd backend && source venv/bin/activate
pytest tests/ -v
```

---

## Mock 모드 (중요)

`ANTHROPIC_API_KEY`가 비어있거나 `"mock"`이면 자동으로 Mock 모드 동작
(`backend/agents/mock_responses.py:is_mock_mode()`).

- LLM 호출 대신 **키워드·규칙 기반 로직**으로 모든 노드가 결과 생성
- ChromaDB 시딩은 스킵, 검색은 `rag/sample_data.py`의 정책 목록에서 키워드 매칭
- Production 모드에서 LLM 호출이 실패하면 챗봇 등은 Mock 응답으로 폴백
- 데모는 기본적으로 이 모드를 전제로 설계됨

---

## 아키텍처

```
[React 18 + Vite + shadcn/ui]
        ↕ WebSocket (/ws/analyze, /ws/chat)
[FastAPI + LangGraph 10노드 StateGraph]
        ↕
[ChromaDB RAG] + [Claude / Mock] + [Playwright RPA(정부24·건보·고용24)]
```

### LangGraph 10노드 (`backend/agents/graph.py`)
```
① profile_analyzer   프로필 분석 + 검색 키워드 추출
② policy_search      ChromaDB RAG 검색 (Mock: 키워드 매칭)
③ eligibility_check  Claude 자격 판별 (Mock: 규칙 기반)
④ reflection_check   ⇆ ③ 재판별 루프 (MAX_RETRIES=2, 통과 시 다음 단계)
⑤ guide_generator   신청 가이드 생성
⑥ doc_retrieval      정부24 API Mock 서류 취득
⑦ portfolio_manager  복지 포트폴리오 요약
⑧ notification_agent 생애이벤트 Push 알림
⑨ result_tracker     신청 결과 추적
⑩ orchestrator       최종 안내 메시지
```
- 공유 상태는 `agents/state.py`의 `AgentState`(pydantic). `events` 필드는
  `operator.add` 리듀서 → 각 노드는 **새 이벤트만** 반환하면 자동 누적.
- WebSocket은 `astream(stream_mode="values")`로 매 노드 누적 상태를 받아
  새 이벤트만 클라이언트로 흘려보냄 (`api/websocket.py`).

### WebSocket 메시지 포맷
```jsonc
// client → server
{ "type": "start_analysis", "profile": { ... } }
// server → client
{ "type": "node_event", "node": "...", "status": "running|done|error", "message": "...", "data": {...} }
{ "type": "complete", "result": { "eligible_policies": [...], ... } }
```

---

## 디렉터리 구조

```
modoo-bom/
├── docker-compose.yml          # backend(8000) + frontend(5173)
├── start.sh / stop.sh          # macOS screen 기반 시연 스크립트
├── backend/
│   ├── main.py                 # FastAPI 엔트리 (lifespan에서 ChromaDB 시딩)
│   ├── requirements.txt
│   ├── .env.example            # ANTHROPIC_API_KEY / CLAUDE_MODEL / CHROMA_PERSIST_DIR / CORS_ORIGINS
│   ├── agents/
│   │   ├── state.py            # AgentState, UserProfile, NodeEvent
│   │   ├── graph.py            # 10노드 StateGraph 조립 + reflection 라우팅
│   │   ├── mock_responses.py   # 키/없이 동작하는 Mock 로직
│   │   ├── utils.py
│   │   └── nodes/              # 10개 노드 각 파일
│   ├── rag/
│   │   ├── sample_data.py      # 복지 정책 샘플 데이터
│   │   ├── embedder.py         # 시딩/검색 (seed_chromadb, search_policies, warmup)
│   │   └── chromadb_client.py
│   ├── api/
│   │   ├── routes.py           # REST API
│   │   ├── websocket.py        # /ws/analyze 스트리밍
│   │   └── chat.py             # /ws/chat 복지 Q&A 챗봇 (RAG + Mock 폴백)
│   ├── mocks/
│   │   ├── gov24_api.py        # 정부24 API Mock + 발급문서 HTML 스토어
│   │   └── document_generator.py
│   ├── rpa/                    # Playwright 실제 브라우저 자동화
│   │   ├── base.py             # 브라우저 컨텍스트/스크린샷 유틸
│   │   ├── manager.py          # RPATask 생명주기 + 지원 문서/서비스 목록
│   │   ├── gov24_rpa.py        # 정부24 (등본·초본·가족관계·장애인증명)
│   │   ├── nhis_rpa.py         # 건강보험 자격득실확인서 (카카오 간편인증)
│   │   ├── work24_rpa.py       # 고용보험 피보험자격 이력
│   │   └── apply_rpa.py        # 복지 서비스 신청 자동화
│   └── tests/                  # conftest.py, test_mock_mode.py
└── frontend/
    ├── src/
    │   ├── App.tsx             # idle→running→complete 3단계 화면
    │   ├── hooks/
    │   │   ├── useAgentWebSocket.ts   # 노드 스트리밍 수신
    │   │   └── useSpeechInput.ts      # Web Speech API 음성 입력
    │   ├── lib/benefit-calc.ts        # 혜택 금액 계산기
    │   ├── components/         # ProfileForm, NodeStatusPanel, Dashboard, ChatBot,
    │   │                       #   PolicyList, DocumentList, ApplyPanel, RpaDocumentPanel,
    │   │                       #   WelfareCalculator, LocalOfficeInfo, ui/*
    │   └── types/index.ts
    ├── package.json
    └── vite.config.ts
```

---

## 주요 API 엔드포인트 (`/api`)

| Method | Path | 설명 |
|--------|------|------|
| WS  | `/ws/analyze` | LangGraph 실행 + 실시간 노드 스트리밍 |
| WS  | `/ws/chat` | 복지 Q&A 챗봇 (RAG + Mock 폴백) |
| GET | `/api/health` | 상태 + mock/production 모드 + ChromaDB 건수 |
| POST| `/api/search` | 복지 정책 RAG 검색 |
| POST| `/api/estimate` | 프로필 기반 혜택 금액 즉시 추정 (AI 미사용) |
| POST| `/api/documents/issue` | Mock 서류 발급 |
| GET | `/api/documents/view/{receipt}` | 발급 서류 HTML 뷰 |
| GET | `/api/documents/rpa-supported` | RPA 지원 서류 목록 |
| POST| `/api/documents/rpa-issue` | 실제 브라우저 RPA 서류 발급 시작 → task_id |
| GET | `/api/documents/rpa-status/{task_id}` | RPA 진행 상태(스크린샷 포함) |
| GET | `/api/apply/supported` | 신청 자동화 지원 서비스 목록 |
| POST| `/api/apply/start` | 복지 서비스 신청 RPA 시작 |
| GET | `/api/apply/status/{task_id}` | 신청 RPA 상태 |
| POST| `/api/admin/seed` | ChromaDB 시딩 (Mock 모드 스킵) |
| GET | `/api/admin/env` | 환경변수 상태(마스킹) |

### RPA 지원 항목 (`rpa/manager.py`) — 2026-07 확장(6→11→15종)
- **서류 15종**: 주민등록등본/초본·가족관계증명서·장애인증명서 + **소득금액증명·지방세 납세증명서·
  지방세 세목별 과세증명서·기초생활수급자 증명서·한부모가족 증명서**(정부24, `gov24_rpa.DOC_CAPP` 단일소스,
  CappBizCD는 CDP local_agent·확장과 동일 검증) + **국세 납세증명서·출입국사실증명·병적증명서·건강보험료
  납부확인서**(07-11 AA020 실측 확장 — 납부확인서는 영숫자 코드) + 건강보험 자격득실확인서(건보) +
  고용보험 피보험자격 이력내역서(고용24). 프론트 `officialLinks.LOCAL_RPA_DOCS`와 반드시 일치.
  보류: 차상위계층 확인서(폼 미확인·자격한정), 국민연금 가입증명(정부24 즉시발급 불가 — 3일 신청 민원).
  **인증수단 선택**(카카오·PASS·네이버·토스): `base.AUTH_PROVIDERS`+`click_provider_in_anyid`, 요청 `auth_provider`.
- **신청 서비스**: 하드코딩 6종(기초연금·아동수당·부모급여·청년내일저축·첫만남·생계급여) **+ 일반화** —
  `apply_rpa.resolve_apply_url`이 정책의 복지로 딥링크(`profile.apply_url`, wlfareInfoId)를 우선 사용해
  6종 밖 임의 복지로 정책도 신청(`_valid_bokjiro_url`로 복지로 https 호스트만 허용).
- **연쇄 발급('전부 자동발급')**: `orchestrator` journey 엔진(정부24 2종+ 여정은 GovSession 공유 브라우저로 **로그인 인증 1회** — rpa/session.py, 2026-07-19) → `/api/journey/run`·`/status`(local_server+routes,
  `journey_view`가 현재단계 라이브 카카오 안내 병합). 데스크탑앱·확장 양쪽에서 한 번 인증에 순차 발급.
- **데스크탑앱**: PyInstaller onedir(`agent_entry.py`→`local_server`, 시스템 크롬, dist-app 동일출처 서빙, chromium 미번들)
  빌드·기동 검증됨(78MB ZIP). **Releases app-v0.3.0 게시됨**(2026-07-11 자산 업로드: ModooBom-Setup.exe 45MB·
  ModooBom-Agent.zip 60MB, API 실측) — 홈 RpaShowcase Windows CTA가 latest/download 직결(Windows UA에서만 노출).

---

## 컨벤션

- **커밋 메시지**: Conventional Commits + 한국어 설명.
  예) `feat(frontend): 음성 입력 기능 추가`, `fix(rpa): 카카오톡 클릭 좌표 방식 교체`
  스코프: `frontend` / `backend` / `rpa` / `voice` 등.
- **AI 서명 금지**: 커밋·코드·파일 어디에도 `Co-Authored-By: Claude`나
  "Generated with" 류 흔적을 넣지 않는다.
- **주석/문서**: 한국어 위주. 함수 docstring에 흐름을 단계별로 적는 스타일.
- **노드 추가 패턴**: `agents/nodes/`에 노드 파일 작성 → `graph.py`에 등록·엣지 연결 →
  Mock 분기는 `mock_responses.py`에 대응 함수 추가 → `AgentState`에 필요한 필드 추가.
- **신규 기능은 Mock 모드에서도 동작**해야 한다(데모 전제).

---

## 알려진 상태 / 주의점

- LLM은 전 구간 **Anthropic Claude**(`langchain-anthropic`) 사용. 키는
  `ANTHROPIC_API_KEY`. (과거 README에 남아있던 OpenAI/GPT-4o 표기는 정리 완료)
- `CLAUDE_MODEL` 기본값은 모든 파일에서 **`claude-sonnet-4-6`** 으로 통일됨
  (10노드를 매 분석마다 실행하므로 비용·속도 기준 Sonnet). 노드/라우트/`.env.example`/
  docker-compose/chat 모두 일치. 모델 교체는 `.env`의 `CLAUDE_MODEL` 한 곳으로 제어.
- RPA(`nhis_rpa.py` 등)는 **실제 정부 사이트 + 카카오 간편인증**에 의존 → 사이트 DOM
  변경에 취약. 최근 커밋 다수가 카카오톡 클릭/폼 입력 안정화 작업.
- 미완성 표식 없음 — 소스 전체 TODO/FIXME/플레이스홀더 0건(2026-07-17 재확인, 옛 PolicyList는 리디자인 때 제거됨).
- `sample_data.py`에는 복지 정책 **120건**이 들어있어 UI의 "120+" 표기와 일치.
  단, 헬스체크의 `seeded` 플래그는 60건 이상이면 true인 하한 기준임.
