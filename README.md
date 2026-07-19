# 모두봄 (ModooBom)

> 개인 복지 자산 관리 AI 에이전트
> 2026 AI·SW 중심대학 디지털 경진대회 SW부문

- 라이브 데모: https://biocode67.github.io/modoo-bom/
- 설치·체험(웹 QR / 안드로이드 앱): https://biocode67.github.io/app.html
- 심사위원용 실행 가이드: [docs/제출/심사위원-실행-가이드.md](docs/제출/심사위원-실행-가이드.md) (웹 즉시 · 데스크탑 앱 약 2분 · 인증 없이 확인 가능한 코스 포함)

![frontend tests](https://img.shields.io/badge/frontend_tests-775_passed-brightgreen) ![backend tests](https://img.shields.io/badge/backend_pytest-254_passed-brightgreen) ![e2e](https://img.shields.io/badge/E2E_실브라우저-12스위트-brightgreen) ![data](https://img.shields.io/badge/실데이터-약_5,300건-blue) ![lighthouse](https://img.shields.io/badge/Lighthouse-A11y_96·BP_100·SEO_100-blue)

모두봄은 자격이 있어도 몰라서 신청하지 못하는 복지를 찾아 주고, 신청과 사후관리까지 이어 주는 AI 에이전트입니다.
회원가입이나 별도 서버 없이 브라우저만으로 동작합니다. 프론트엔드에 전국 약 5,300건의 복지 데이터와 자격 판정 엔진,
그리고 브라우저에서 직접 실행되는 의미 검색 모델을 내장했습니다. FastAPI 백엔드를 연결하면 LangGraph 기반 에이전트와
정부24·복지로 자동화가 추가로 활성화되며, 클라우드에 배포된 백엔드(LangGraph 10노드 + 챗)도 함께 운영 중입니다.
LLM은 Gemini 2.5 Flash를 사용하고 실패 시 Groq·Claude로 자동 폴백하며, 키가 없으면 규칙 기반으로 동작합니다.

## 문제 정의

한국의 복지는 신청주의입니다. 자격이 있어도 본인이 신청해야 받을 수 있습니다. 그런데,

- 제도가 중앙부처, 226개 지자체, 민간재단에 흩어져 있고 민간재단 지원사업은 정부 포털 어디에도 모이지 않습니다.
- '기준 중위소득', '소득인정액', '차상위' 같은 용어는 정작 가장 필요한 사람(어르신, 저소득층, 외국인 주민)이 이해하기 어렵습니다.
- 자격 확인에서 서류 발급, 신청서 작성으로 이어지는 각 단계마다 이용자가 이탈합니다.

기존 공공 앱에 대한 사용자 불만(입력 중 상태 손실, 작은 글씨, 복잡한 인증 등)과 민간 서비스의 공백
(토스 '숨은 정부지원금 찾기'는 2024년 8월 종료)이 이 문제를 뒷받침합니다. 필요한 것은 더 나은 검색이 아니라,
이용자를 대신해 실행까지 이어 주는 에이전트라고 판단했습니다.

## 접근 방식: 에이전트 루프

모두봄은 단순 챗봇이 아니라 인지 → 판단 → 이해 → 행동 → 관찰의 순환으로 동작합니다.

| 단계 | 내용 |
|---|---|
| 인지 | 대화형 온보딩(탭 입력), 자연어 한 문장, 음성 입력 |
| 판단 | 약 5,300건에서 2026년 공식 선정기준으로 자격 판정, 신뢰도 분리, 모집종료·소득초과 등 하드 게이트 |
| 이해 | 쉬운 말 설명, 용어 사전, 7개 언어 AI 답변, TTS 읽어주기 |
| 행동 | 관심목록 저장, 서류 자동발급(최대 15종), 복지로 자동신청 |
| 관찰 | 마감·갱신·서류 미비 감시, 앱 실행 시 우선 안내 |

본인인증과 최종 제출은 법적으로 본인이 수행해야 하는 절차이므로 자동화하지 않습니다. 나머지 과정
(로그인 화면 이동, 양식 자동작성, 제출 직전까지)은 에이전트가 수행합니다.

## 주요 기능

**찾기·이해**

- 온디바이스 다국어 의미 검색: 브라우저에서 직접 실행되는 신경망 임베딩(multilingual-e5-small)으로 정책을 의미 기준으로 매칭합니다. 한국어·영어·베트남어·중국어·일본어 교차 검색을 지원하며, 질의와 정책 원문 모두 서버로 전송하지 않습니다.
- 대화형 상담: 프로필을 반영해 답하고 맥락을 기억하는 규칙 기반 챗봇으로, 서버나 LLM 없이 동작하며 환각이 없습니다. 전화처럼 말로 묻고 음성으로 듣는 통화형 상담도 제공합니다.
- 대화형 온보딩: 마스코트가 한 번에 하나씩 묻고 탭으로 답하는 프로필 입력. 65세 이상을 선택하면 큰 글씨와 음성 안내를 제공합니다.
- 외국인 지원: 검색 언어에 맞춰 UI와 신청 키트의 골격을 자국어로 표시하고, 검색 결과는 브라우저 내장 번역기로 기기 안에서 번역합니다(자격·신청 기준 본문은 한국어 원문 유지).
- 본문 인라인 쉬운말: 어려운 행정 용어를 점선 밑줄로 표시하고, 누르면 그 자리에서 쉬운 설명을 보여 줍니다.

**신청·실행**

- 서류 자동발급·자동신청: 정부24, 복지로, 건강보험공단, 고용24를 자동으로 조작해 서류를 발급하고 신청서를 작성합니다(데스크탑 앱 15종, 크롬 확장 13종).
- 원클릭 연쇄(데스크탑 앱): 필요한 서류를 로그인 1회로 연쇄 발급하고, 방금 발급한 파일을 신청 양식에 자동 첨부한 뒤 제출 직전에 멈춥니다.
- 주민센터 방문 키트: 정책 한 건을 큰 글씨 A4로 인쇄(창구 안내 문구, 담당 전화, 서류 목록)해 오프라인 신청을 지원합니다.
- 가족 도움 링크: 이름을 제외한 프로필과 담은 정책을 링크로 공유해, 가족이 대신 확인하고 신청하도록 돕습니다(서버 전송 없음).

**분석·관리**

- 프로필 위저드와 자격 판정(2026년 정밀 선정기준), 약 5,300종 정책의 탐색·검색·필터.
- 관심목록과 신청 상태 관리, 혜택 계산기, 정책 비교, 복지 수혜 점수.
- 사후관리 알림과 복지 캘린더(.ics 내보내기), 생애주기 시뮬레이터, 긴급복지 진단, 가구 단위 분석.
- 민간재단 지원 21건(장학·의료비·위기지원)을 공식 사이트로 실측 검증해 별도 수록.

**접근성·기반**

- 음성 입력과 TTS, 큰 글씨, 고대비, 인쇄/PDF, reduced-motion.
- 3D 마스코트(React Three Fiber, 지연 로딩), 반응형 레이아웃, 설치형·오프라인 PWA.

## 실행 방법

### 웹 (설치 없음)

https://biocode67.github.io/modoo-bom/ 에서 바로 실행됩니다.

### 데스크탑 앱 (자동발급 포함, Windows)

```bat
setup-local.bat      :: 최초 1회 (저장소 루트 — 경량 venv + 프론트 빌드)
run-local-app.bat    :: 이후 실행 — 최신이면 자동 재빌드 후 localhost:8000
```

동일 출처 서빙과 실제 Chrome 자동화로 동작합니다. '나의 복지 → 서류 준비 도우미'의 [전부 자동발급 + 자동신청]
버튼이 발급, 자동 첨부, 제출 직전 정지를 한 흐름으로 진행합니다. 개인정보는 이 PC 안에서만 사용됩니다.

### 크롬 확장 (배포 사이트에서 바로)

`chrome://extensions` → 개발자 모드 → '압축해제된 확장 프로그램 로드' → 저장소의 `extension/` 폴더를 선택합니다.
배포 웹이 확장을 감지해 자동발급·자동신청 버튼을 활성화합니다. 자동화가 사용자 브라우저 안에서 실행되므로
개인정보가 서버로 전송되지 않습니다.

### 풀스택 로컬 개발

```bash
# 백엔드
cd backend
python3 -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # LLM 키 입력(선택) — 없으면 Mock 모드로 동작
uvicorn main:app --reload --port 8000                 # 헬스체크 /api/health · API 문서 /docs

# 프론트엔드 (새 터미널)
cd frontend
npm install && npm run dev                            # http://localhost:5173
```

LLM 키가 없으면 Mock 모드로 전체 파이프라인이 동작합니다(각 노드가 규칙 기반으로 결과 생성). Docker로 한 번에
실행하려면 `docker compose up --build`을 사용합니다(키가 없으면 Mock 모드).

카카오·구글 로그인을 켜면 기기 간 신청 현황이 동기화됩니다(Supabase 무료 티어, 선택). 미설정 시 관련 코드는
빌드에서 제외됩니다. 설정 절차는 [supabase/SETUP.md](supabase/SETUP.md)를 참고하십시오.

## 데모 시나리오

웹 UI의 빠른 프로필 버튼으로 확인할 수 있습니다.

| 프로필 | 기대 결과 |
|---|---|
| 독거 노인 (72세) | 기초연금, 노인 일자리, 맞춤돌봄서비스 |
| 청년 취준생 (26세) | 실업급여, 국민취업지원, 청년 월세지원 |
| 신혼 출산 가정 (32세) | 부모급여, 아동수당, 국민행복카드 |
| 중증장애인 (45세) | 장애인연금, 활동지원서비스 |

각 프로필은 클라이언트 엔진이 즉시 분석하며, 백엔드를 연결하면 LangGraph 스트리밍과 RPA 자동화가 추가됩니다.

## 아키텍처

프론트엔드는 백엔드 없이 완전히 동작하고, 백엔드를 연결하면 LLM과 RPA 기능이 추가됩니다.

```
[프론트엔드 — 항상 동작 / GitHub Pages]
  React 18 + Vite + TypeScript + TailwindCSS + PWA
  클라이언트 복지 엔진(welfare-engine.ts) + 정책 카탈로그(catalog.ts) + 온디바이스 의미 검색
        ↕  (백엔드 감지 시)
[백엔드 — 선택 / 로컬·클라우드]
  FastAPI + LangGraph 10노드 + LLM(Gemini 2.5 Flash, Groq·Claude 폴백) + 하이브리드 RAG(BM25 + 임베딩)
  + Playwright RPA(정부24·복지로·건보·고용24)
        ↕
[공공데이터 ETL] 한국사회보장정보원 복지서비스 → public/policies.json
```

클라이언트 엔진은 백엔드의 자격 판정·혜택 계산 로직을 TypeScript로 포팅해 브라우저에서 즉시 실행합니다.
백엔드는 아래 LangGraph 10노드 파이프라인과 실제 RPA를 담당하며, 프론트엔드가 연결 여부를 감지해 자동으로 활성화합니다.

### LangGraph 10노드 파이프라인 (선택 백엔드)

```
① profile_analyzer   프로필 분석 + 키워드 추출
② policy_search      RAG 검색 (Mock: 키워드 매칭)
③ eligibility_check  LLM 자격 판별 (Mock: 규칙 기반)
④ reflection_check   ③으로 재판별 (검증 실패 시 최대 2회)
⑤ guide_generator   신청 가이드 생성
⑥ doc_retrieval      정부24 서류 취득
⑦ portfolio_manager  복지 포트폴리오 요약
⑧ notification_agent 생애이벤트 알림
⑨ result_tracker     신청 결과 추적
⑩ orchestrator       최종 안내 메시지 생성
```

WebSocket(`/ws/analyze`)은 각 노드의 진행 상태를 스트리밍합니다.

```json
{ "type": "node_event", "node": "profile_analyzer", "status": "done", "data": { } }
{ "type": "complete", "result": { "eligible_policies": [] } }
```

## 데이터

약 5,300건은 모두 실제 데이터이며, 가짜 데이터는 생성하지 않는 것을 원칙으로 삼았습니다.

| 출처 | 건수 | 검증 |
|---|---|---|
| 지자체 복지 | 4,683 | 한국사회보장정보원 OpenAPI |
| 중앙부처 복지 | 463 | 동일 OpenAPI + 온라인 신청 URL 보강 |
| 정부 큐레이션 | 124 | 보건복지부 등 2026년 공식 고시 대조(기초연금 349,700원, 생계급여 32% 등) |
| 정부 지원사업 | 33 | 국토부·복지부 공식 페이지 실측 |
| 민간재단 | 21 | 재단 공식 사이트 전수 확인 |
| 청년주택 공고 | 7 | LH·SH·GH 공고 게시판 연결 |
| 정책서민금융 | 5 | 서민금융진흥원 실측(대출 상품은 현금 합산에서 제외) |

신청·발급 URL 70건을 전수 점검했고(69건 정상, 1건 즉시 정정), 정책 벡터 약 5,200건을 사전 계산해
온디바이스 의미 검색에 사용합니다. `backend/etl/ingest_welfare.py`로 재수집한 뒤 `public/policies.json`만
교체하면 재빌드 없이 반영됩니다. 확장 방법은 [backend/etl/README.md](backend/etl/README.md)를 참고하십시오.

## 품질·검증

- 자동 테스트: 프론트엔드 vitest 775건, 백엔드 pytest 254건.
- E2E: 실브라우저 회귀 12스위트(웹 여정, 데스크탑 30종, 모바일, 촬영, 흐름, 접근성).
- 정적 검사: ESLint 0, TypeScript 0.
- 접근성: Lighthouse 접근성 96, Best Practices 100, SEO 100. 큰 글씨, 고대비, TTS, 음성 입력, 키보드 완주, 포커스 트랩, reduced-motion.
- 보안·프라이버시: 의존성 취약점 0, CSP unsafe-inline 제거, postMessage 발신자 검증, 개인정보처리방침 고지, 기기 데이터 전체 삭제 경로 제공.
- 데이터·판정의 보수적 설계: 현금성 합산에서 바우처와 대출을 제외하고, 심사·선발형 지원은 낮은 신뢰도로만 표시하며, 모집종료 정책은 추천에서 제외합니다.
- 주요 복지 금액은 2026년 보건복지부 등 공식 출처로 재검증했습니다.

## 성과 지표 (라이브 기준)

| 항목 | 값 |
|---|---|
| 독거 어르신(72세, 중위 25%) 발견액 | 월 최대 639,700원 |
| 출산 가정(0세) 발견액 | 월 최대 1,193,000원 + 소급 알림 |
| 중증장애인 발견액 | 월 최대 349,700원 + 민간 의료·재활 연계 |
| 서류 발급 과정 | 9단계 중 본인 조작 1회(휴대폰 인증 승인) |
| 운영비 | 0원 (정적 호스팅 + 온디바이스) |

발견액은 월 최대이며 중복 수급을 반영하지 않은 값으로, 강력 추천 항목 중 현금성만 보수적으로 합산했습니다(결과 화면과 동일).

## 파일 구조

```
modoo-bom/
├── backend/                      # 선택 — FastAPI + LangGraph + RPA
│   ├── main.py                   # FastAPI 진입점 (REST + WebSocket)
│   ├── agents/                   # state.py, graph.py, mock_responses.py, nodes/ (10노드)
│   ├── rag/                      # 정책 샘플 데이터 + 임베딩/검색
│   ├── api/                      # routes.py, websocket.py, chat.py
│   ├── rpa/                      # Playwright 자동화: gov24 / nhis / work24 / apply + orchestrator(연쇄)
│   ├── local_server.py           # 데스크탑 앱 경량 서버 (동일 출처 서빙 + RPA)
│   ├── etl/ingest_welfare.py     # 공공데이터 → policies.json
│   └── tests/                    # pytest 254
└── frontend/                     # 메인 — 백엔드 없이 동작 (정적 배포)
    ├── src/
    │   ├── App.tsx               # 셸 + 상태 기반 뷰 (home / analyze / explore / my)
    │   ├── data/                 # policies.ts(시드), catalog.ts(런타임 병합)
    │   ├── lib/                  # welfare-engine, monitoring, calendar, semanticSearch, useBackend …
    │   ├── store/useAppStore.ts  # zustand persist
    │   ├── three/                # 마스코트 3D (지연 로딩)
    │   └── sections/ components/ # 화면·컴포넌트
    └── public/                   # 정적 자산 (policies.json은 ETL 생성)
```

## 팀 모두봄

| 이름 | 역할 |
|---|---|
| 김주형 | PM · 백엔드 (LangGraph, FastAPI) |
| 류다영 | AI·ML (RAG, Reflection Loop) |
| 신주현 | 데이터 (ChromaDB, ETL) |
| 이준영 | 프론트엔드 (React, WebSocket) |
| 장지웅 | 기획·UX |

---

저장소: https://github.com/BioCode67/modoo-bom · 웹 데모: https://biocode67.github.io/modoo-bom/
