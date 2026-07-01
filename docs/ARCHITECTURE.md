# 모두봄 아키텍처 — 기술 심화

> 심사·개발자용 기술 문서. 사용자용 개요는 `README.md`, 발표·기획서용은 `docs/기획서자료/`.

## 설계 원칙
1. **서버 없이도 전 기능** — 정적 배포(GitHub Pages)에서 즉시 체험. 서버 비용 0, 항상 켜짐.
2. **프라이버시 우선** — 개인정보·AI 추론 전부 브라우저 안에서. 서버 전송 0, 회원가입 불필요.
3. **정직성** — 가짜 데이터·자동화 과장 없음. 실제 검증된 범위만 "된다"고 표기.

---

## 1. 온디바이스 다국어 AI 의미검색 (헤드라인)

```
빌드 시:  정책 카탈로그(5,185) ──embed-policies.mts──▶ public/policy-embeddings.json
                                (multilingual-e5-small, int16·base64, ~5MB)
런타임:  질의 ──(브라우저 내 임베딩)──▶ 코사인 유사도 vs 사전계산 벡터 ──▶ 랭킹
```

- **모델**: `Xenova/multilingual-e5-small`(384dim)를 **transformers.js**로 브라우저에서 실행(WASM/WebGPU). HuggingFace CDN에서 최초 1회 다운로드 후 캐시.
- **사전계산**: 정책 벡터는 빌드 시 계산해 JSON으로 배포(int16 양자화). 런타임엔 **질의만** 임베딩(짧아 빠름) → 코사인.
- **다국어 교차검색**: e5의 다국어 임베딩 공간에서 **번역 없이** 의미로 매칭(환각·오역 없음). 한/영/베트남/중/일 검증.
- **대표제도 가점**: 전국 5천건 중 지역 소규모 사업에 대표 국가제도(POL-)가 묻히지 않도록 +0.04 가점(유사도 격차보다 작아 override 아님).
- **성능 격리**: transformers.js는 **동적 import(별도 청크 555KB)** → 메인 번들(184KB)·초기 로드 영향 0. AI 토글을 켤 때만 로드.
- **끊김 없는 UX**: 모델 로딩 중엔 즉시 키워드 결과 표시 → 준비되면 AI 결과로 자동 업그레이드. 실패 시 키워드 폴백.
- **관련 파일**: `src/lib/semanticSearch.ts`, `src/lib/aiAnswer.ts`, `src/lib/detectLang.ts`, `scripts/embed-policies.mts`, `scripts/clean-wasm.mjs`.

## 2. 정적 배포 + 로컬 에이전트 브릿지

- 프론트는 클라이언트 복지 엔진(`welfare-engine.ts`)+동적 카탈로그(`catalog.ts`)로 **백엔드 없이 전 기능** 동작.
- 백엔드(로컬 에이전트)가 있으면 RPA 자동발급 등 활성화. `backend.ts`가 `VITE_API_BASE`(설정 시) → `localhost:8000` 순으로 감지(`export let API_BASE` 라이브 바인딩).
- **주의(브라우저 정책)**: 배포된 https 사이트 → `http://localhost` 요청은 Private/Local Network Access로 **간헐 차단**. → **RPA 데모는 로컬 앱(`localhost:5173`, run-windows.bat)에서** 하면 vite 프록시로 안정 감지.

## 3. RPA 자동화 — 휴먼인더루프 설계

```
서류 요청 → 정부24 로그인 자동 → 간편인증 폼 자동 도달(정보 자동입력)
          → [📱 카카오 폰 승인: 본인만] → 발급 양식 자동 → PDF 자동 저장
```

- Playwright로 정부24(plus.gov.kr)·복지로·건보·고용24를 **실제 브라우저**로 조작. Windows는 설치된 Edge(msedge) 사용.
- 2026 개편 대응: 정부24 `plus.gov.kr/login`+simpleCert iframe, 복지로 `loginView.do`+eForm(Clipsoft) **좌표 신뢰클릭**+yeskey fincert.
- **본인인증(카카오 폰 승인)은 반드시 사용자** — 정부가 강제하는 비가역 절차. 완전 무인 대리인증은 명의도용이라 **의도적으로 배제**(안전·정직).
- 안내 페이지 오저장 방지: 로그인 후 발급 폼(AA040) 직행 + 결과 미도달 시 완료 오판 방지 가드.
- **관련 파일**: `backend/rpa/{base,gov24_rpa,apply_rpa,nhis_rpa,work24_rpa,manager}.py`.

## 4. 백엔드 AI Agent (선택)

- **FastAPI + LangGraph 10노드 StateGraph**: profile_analyzer→policy_search→eligibility_check⇄reflection_check→guide_generator→doc_retrieval→portfolio_manager→notification_agent→result_tracker→orchestrator.
- **ChromaDB** RAG(sentence-transformers 내장 임베딩). LLM은 **Anthropic Claude**. 키 없으면 **Mock 모드**(키워드·규칙)로 전 노드 동작 → 데모 무중단.

## 5. 데이터 파이프라인

- ETL(`backend/etl/ingest_welfare.py`)이 공공데이터(한국사회보장정보원)를 Policy 스키마로 정규화 → `public/policies.json`.
- 런타임에 시드(검증 124) + 외부(5,061) 병합(이름 디듑, 시드 우선) = **5,185건**. 가짜 미생성.

## 6. 품질 게이트
- 프론트: ESLint(0) · vitest(168) · tsc · vite build · PWA. 백엔드: pytest(13, Mock).
- 변경마다 headed Edge로 브라우저 회귀 검증. 2026 복지 금액 공식 출처 검증(`docs/기획서자료/데이터정확성-2026검증.md`).
