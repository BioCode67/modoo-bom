# 🔀 세션 동시작업 조율 (Session Coordination)

> **두 개의 Claude 세션이 같은 저장소에서 동시에 작업**한다(데스크탑 앱 세션 · 터미널/w2 세션).
> 서로 뭘 건드리는지 커밋으로 보이게 해 **충돌 없이 나눠 작업**하기 위한 실시간 조율 파일이다.
> (기록용 회고는 `WORK-STATUS.md`, 이 파일은 **"지금 누가 무엇을"**.)

## 📋 작업 시작 전 프로토콜 (양쪽 세션 공통)
1. **이 파일 먼저 읽기** → 아래 "현재 진행 중(claims)" 확인. 다른 세션이 잡은 파일/영역은 건드리지 않는다.
2. 새 작업은 **claims 표에 한 줄 추가(파일/영역·작업·상태·시각) → 먼저 커밋·푸시**하고 시작. (선점 = 소유)
3. `origin/main` 에 **rebase로 통합**. 공유 브랜치 강제푸시 금지 · 내 feature 브랜치만 `--force-with-lease`.
4. 두 세션이 같은 파일이 필요하면 **먼저 claim한 쪽이 소유**, 다른 쪽은 대기하거나 이 파일에 메모로 요청.
5. 끝나면 상태를 `done`으로 바꾸고, 오래된 claim은 정리.

## 🛣️ 기본 레인(lane) — 특별한 claim 없으면 이 경계를 따른다
| 영역 | 담당 세션 | 포함 |
|---|---|---|
| **프론트 UX·컴포넌트·접근성** | 데스크탑 | `src/components/*`(대부분)·`src/sections/*`·a11y·index.css·three |
| **추천 엔진·정직성 감사·데이터** | 데스크탑 | `lib/welfare-engine.ts`·`lib/format.ts`·`data/*`·honesty/게이트·감사 |
| **문서 자료실·README·기획서** | 데스크탑 | `README.md`·`docs/기획서*`·제출 자료 |
| **배포(gh-pages)** | 데스크탑(주) | `npm run deploy` — 배포 경합 방지 위해 한쪽만 |
| **백엔드·로컬 에이전트·패키징** | **터미널/w2** | `backend/local_server.py`·`agent_entry`·`*.spec`·`installer.iss`·`build-installer.bat`·`setup-local.bat`·`run-local-app.bat` |
| **RPA 인프라·브라우저 실행** | **터미널/w2** | `backend/rpa/base.py`(launch)·RPA 견고성 |
| **하이브리드 감지·테스트·E2E·CI** | **터미널/w2** | `lib/backend.ts`·`lib/useBackend.ts`·`backend/tests/*`·`e2e/local-app.py`·`e2e/installed-app.py`·`check-all.bat` |
| **크로스 경계(협의 필요)** | — | `backend/api/routes.py`(RPA 라우트 ↔ local_server 미러)·`ChatWidget`·`DocumentCenter`·`RpaInfoForm`·`main.py` |

> 크로스 경계 파일은 claim으로 잠깐 소유권을 명시하고, 끝나면 즉시 반납한다.

## 🔵 현재 상황 스냅샷 (최종 갱신: 터미널/w2, 2026-07-07)
- 라이브: https://biocode67.github.io/modoo-bom/ — ⚠️ **현재 main보다 뒤처짐**(감사 수정 미반영). 재배포는 데스크탑 세션 판단.
- 통합 상태: 합쳐진 main 상시 green — 프론트 495·백엔드 78 테스트·E2E 스모크 10여정·lint·tsc.
- 터미널/w2 최근: 로컬앱 동일출처 자동발급 완성(경량 에이전트 1초 기동)·단일 실행파일+Inno 인스톨러·
  브라우저 폴백(Chrome→Edge)·배포본 22MB 경량화·자기코드 적대적 리뷰 4건 수정·**실제 gov24 RPA 라이브 검증**(자동입력+인증요청까지, 사용자는 폰 '인증 허용'만).
- 데스크탑 최근: 프론트 감사 2~4차·런칭 보안 하드닝·a11y·정직성/오게이트 수정.

## 🟢 현재 진행 중 (claims)
| 세션 | 파일/영역 | 작업 | 상태 | 갱신 |
|---|---|---|---|---|
| 터미널/w2 | `SESSION-COORDINATION.md` | 조율 프로토콜 신설 | done | 07-07 |
| 터미널/w2 | `components/DocumentCenter.tsx`·`RpaInfoForm.tsx` | 자동발급 인증정보(생년월일·휴대폰) 프리필/가이드 개선 — 미입력 시 자동입력 안내·폼 유도 | in_progress | 07-07 |

## 🟡 협의 대기 / 제안 (다른 세션이 판단)
- **추천 정직성**: "월 예상 혜택 상위 5" 차트가 조건부 고액 서비스(장기요양·자활)를 상단에 올려 과대약속 소지 →
  데스크탑 세션(정직성 감사)이 검토 권장. (w2는 미터치)
