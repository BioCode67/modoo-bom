# webagent — 스마트 AI 웹 에이전트

자연어 목표 한 문장(예: `"주민등록등본 발급"`)을 받아 정부·공공 사이트 자동화를 수행하고,
**구조화 결과(JSON)** 하나를 돌려주는 오케스트레이션 계층입니다.

기존의 사이트별 하드코딩 매크로를, **결정층(browser-use 등 에이전트) + 실행층(검증된 빠른 경로)**
하이브리드로 감쌌습니다. 핵심 비즈니스 로직(자격 판정·혜택 계산 등)은 그대로 두고, **웹 조작·데이터
추출 영역만 에이전트에 위임**합니다.

## 왜 하이브리드인가

| 상황 | 처리 | 이유 |
|------|------|------|
| 아는 서류·검증된 흐름 (`등본`, `초본`, `소득금액증명`…) | **결정적 빠른 경로**로 라우팅 | 화면을 헤매지 않아 빠르고 안정적 |
| 처음 보는 서류·동적/복잡/예외 상황 | **LLM 에이전트 루프**(browser-use)가 화면을 읽고 스스로 진행 | 셀렉터가 바뀌거나 처음 보는 사이트여도 일반화 |
| 자동 실행 불가(키 없음·미설치·환경 제약) | **공식 링크 폴백** | 거짓 성공을 만들지 않고 정직하게 안내 |

## 사용법

```python
from webagent import run_web_agent

result = await run_web_agent("주민등록등본 발급")
print(result.to_json())
# {"goal": "주민등록등본 발급", "success": false, "status": "route",
#  "engine": "deterministic", "extracted": {"resolved_doc": "주민등록등본", ...}, ...}
```

### 결과 계약 (`WebAgentResult`)

| 필드 | 의미 |
|------|------|
| `success` | **실제 완료를 확인**했을 때만 `true` (오직 `status="done"`) |
| `status` | `done` · `needs_human_auth` · `needs_human_submit` · `route` · `fallback` · `error` |
| `engine` | 처리 엔진: `deterministic` · `browser_use` · `builtin` · `none` |
| `steps` | 에이전트 반복 수(가드레일 관측용) |
| `extracted` | 구조화 추출 데이터(발급 서류·저장 경로·조회값 등) |
| `message` | 사람이 읽을 한 줄 안내(개인정보 미포함) |
| `fallback_url` | 자동 실패 시 안내할 공식 경로(항상 채움) |
| `needs_human` | `auth` · `submit` · `null` — 사람이 이어받아야 하는 지점 |

> **정직성 규칙:** 발급/신청을 실제로 완료하지 않았으면 `success=false`. 본인인증·최종 제출은
> 언제나 사람이 직접 합니다(비가역·법적 안전장치). 개인정보는 서버에 저장·로깅하지 않습니다.

## 안전 가드레일

- **max_steps**(기본 15) — 에이전트가 같은 화면을 맴돌아도 여기서 끊깁니다.
- **timeout**(기본 180초) — 사이트가 멈춰도 무한 대기하지 않습니다(`asyncio.wait_for`).
- **try/except 롤백** — 한 엔진이 실패하면 다음 엔진으로, 그래도 안 되면 공식 링크 폴백.
- **파괴적/최종제출 차단** — 실행층(browser-use 프롬프트·기존 `smart_agent.guard_action`)이
  취소·탈퇴·삭제·최종제출·결제를 대신 누르지 않습니다.

## 환경변수 (`backend/.env`)

```dotenv
WEBAGENT_ENGINE=auto     # auto|deterministic|browser_use|builtin
WEBAGENT_MAX_STEPS=15    # 반복 상한(무한 루프 방지)
WEBAGENT_TIMEOUT=180     # 전체 타임아웃(초)
WEBAGENT_VISION=1        # 1=스크린샷 판단(비전 모델), 0=텍스트만
# WEBAGENT_MODEL=        # 판단 모델 강제(미지정 시 provider 기본값)
```

판단용 LLM 키는 프로젝트 공통 키를 그대로 씁니다(우선순위 **Gemini → Groq → Anthropic**).
화면을 읽는 **비전 지원 모델**(Gemini 2.5 Flash · Claude Sonnet)을 권장합니다. 키가 없으면
에이전트 경로는 비활성화되고 빠른 경로 + 공식 링크로 축소됩니다.

## browser-use 엔진 켜기 (선택)

```bash
pip install -r requirements-webagent.txt
playwright install chromium   # 이미 있으면 생략
```

설치하지 않아도 모듈은 그대로 동작합니다(지연 임포트). browser-use 는 `DefaultExecutor` 의
`browser_use_runner` 지점에서 구동되며, **다른 프레임워크(OpenClaw 등)로 교체**하려면 그 러너만
바꾸면 됩니다 — 오케스트레이션과 실행을 분리해 두었습니다.

```python
from webagent import DefaultExecutor, run_web_agent

async def my_runner(goal, cfg):      # 커스텀/대체 엔진(OpenClaw 등)
    ...
    return outcome                   # EngineOutcome

result = await run_web_agent(goal, executor=DefaultExecutor(browser_use_runner=my_runner))
```

## 여정 — 여러 목표를 이어서 (`run_web_journey`)

'전부 자동발급'처럼 여러 서류·신청을 순서대로 이어서 처리하고 집계합니다. 본인인증 같은
'사람 인계' 지점을 만나면(기본) 거기서 멈춰, 사람이 인증을 마친 뒤 남은 목표로 다시 호출합니다
(정부 인증은 비가역·법적 안전장치라 대리 불가).

```python
from webagent import run_web_journey

j = await run_web_journey(["주민등록등본 발급", "가족관계증명서 발급"])
print(j.summary)      # "목표 2개 · 경로 확정 2"
print(j.stopped_at)   # 사람 인계로 멈춘 단계(없으면 None)
```

결과 `WebJourneyResult`: `done_count`(완료) · `routed_count`(경로 확정) · `human_count`(본인확인 필요) ·
`error_count`(자동 불가) · `stopped_at` · `steps`(각 단계 결과) · `summary`. 실제 완료만 done으로 셉니다.

## REST 엔드포인트

`main.py` 가 `app.include_router(webagent_router)` 로 연결합니다.

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/webagent/run` | `{ goal, engine?, max_steps?, timeout_s? }` → `WebAgentResult` |
| POST | `/api/webagent/journey` | `{ goals[], engine?, stop_on_human? }` → `WebJourneyResult` |
| GET | `/api/webagent/config` | 현재 가드레일 기본값 + 엔진 가용성(browser_use·builtin_cdp·llm_provider) |
| GET | `/api/webagent/classify?goal=…` | 브라우저 없이 목표 성격 미리보기(발급/신청/미상·빠른경로 여부) |

오버라이드는 가드레일 범위로 클램프됩니다(max_steps ≤ 50, timeout ≤ 600s, engine는 유효값만).
핸들러 로직은 `_handle_run`/`_handle_journey`/`_config_info` 순수 함수로 분리해 HTTP 없이 테스트합니다.

## 구성

```
webagent/
├── __init__.py       # 공개 API: run_web_agent · run_web_journey · WebAgentConfig · WebAgentResult
├── config.py         # 가드레일 설정(env → WebAgentConfig)
├── types.py          # 구조화 결과(WebAgentResult) · 상태 상수
├── llm_factory.py    # 판단 계층 LLM 구성(비전 우선, provider 키 재사용)
├── web_agent.py      # 하이브리드 오케스트레이터 + browser-use 어댑터 + DefaultExecutor
├── journey.py        # 다목표 연쇄(여정) — 사람 인계 지점에서 멈춤·정직한 집계
└── router.py         # REST 라우터(POST /run·/journey · GET /config) + 순수 핸들러
```

테스트: `pytest tests/test_webagent.py tests/test_webagent_journey.py tests/test_webagent_router.py`
(브라우저·키 없이 도는 계약 테스트 — 라우팅·롤백·가드레일·여정 집계·엔드포인트 핸들러·정직성).
