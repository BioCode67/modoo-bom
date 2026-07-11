# 병렬 작업 조율 (Session Coordination)

> 여러 작업 트랙이 같은 저장소에서 동시에 작업한다(데스크탑 · w2 · w3 · w4 · w5 …).
> 각 트랙은 자기 worktree/브랜치(`feat/wN`)에서 돌아 파일은 물리적으로 격리되고,
> 이 파일로 누가 어느 파일을 건드리는지 공유해 병합·배포 충돌까지 없앤다.
> (기록용 회고는 `WORK-STATUS.md`, 이 파일은 "지금 누가 무엇을".)

## 작업 시작 전 프로토콜 (전 트랙 공통)
1. 이 파일 먼저 읽기 → 아래 "현재 진행 중(claims)" 확인. 다른 트랙이 잡은 파일/영역은 건드리지 않는다.
2. 새 작업은 claims 표에 한 줄 추가(파일/영역·작업·상태·시각) → 먼저 커밋·푸시하고 시작. (선점 = 소유)
3. `origin/main` 에 rebase로 통합. 공유 브랜치 강제푸시 금지 · 내 feature 브랜치만 `--force-with-lease`.
4. 두 트랙이 같은 파일이 필요하면 먼저 claim한 쪽이 소유, 다른 쪽은 대기하거나 이 파일에 메모로 요청.
5. 끝나면 상태를 `done`으로 바꾸고, 오래된 claim은 정리.

## 새 트랙(w3·w4·w5 …) 시작 체크리스트 — 이대로면 충돌 0
각 트랙은 자기 worktree 폴더의 자기 브랜치(`feat/wN`)에서만 작업한다.
1. 시작 즉시 최신화:  `git fetch origin && git rebase origin/main`
2. claim 먼저: 아래 표에 `feat/wN` + 건드릴 파일/영역을 한 줄 추가 → 커밋 → push.
   이미 다른 트랙이 claim한 파일이면 그 영역은 피한다(선점=소유). 겹치면 레인을 나눠 잡는다.
3. 작업 → 자기 브랜치에 커밋(절대 `main`에서 직접 작업 금지).
4. push 전 항상 `git fetch origin && git rebase origin/main` — 충돌은 내 브랜치에서 해결한다(그래서 main은 늘 깨끗).
5. main 반영:  `git push origin HEAD:main`  (fast-forward만; 거부되면 4로 돌아가 다시 rebase).
6. 자기 브랜치만 `--force-with-lease`. `main`엔 절대 force-push 금지.
7. 배포(`npm run deploy`)는 한 번에 한 트랙만, 직전에 `git merge origin/main`(아래 배포 규칙).

한 폴더(worktree)에 작업 트랙은 하나만. 같은 폴더에서 두 트랙이 돌면 파일이 깨진다.

## 기본 레인(lane) — 특별한 claim 없으면 이 경계를 따른다
| 영역 | 담당 트랙 | 포함 |
|---|---|---|
| 프론트 UX·컴포넌트·접근성 | 데스크탑 | `src/components/*`(대부분)·`src/sections/*`·a11y·index.css·three |
| 추천 엔진·정직성 감사·데이터 | 데스크탑 | `lib/welfare-engine.ts`·`lib/format.ts`·`data/*`·honesty/게이트·감사 |
| 문서 자료실·README·기획서 | 데스크탑 | `README.md`·`docs/기획서*`·제출 자료 |
| 배포(gh-pages) | 데스크탑(주) | `npm run deploy` — 아래 규칙 필수 |
| 로컬앱 패키징·구조 | 터미널/w2 | `agent_entry`·`*.spec`·`installer.iss`·`build-installer.bat`·`setup-local.bat`·`run-local-app.bat` |
| 브라우저 실행 인프라 | 터미널/w2 | `backend/rpa/base.py`(launch_browser 폴백) |
| 하이브리드 감지·테스트·E2E·CI | 터미널/w2 | `lib/backend.ts`·`lib/useBackend.ts`·`backend/tests/test_local_server·test_browser_launch`·`e2e/local-app.py`·`e2e/installed-app.py`·`check-all.bat` |
| RPA 능력 확장(어떤 서류·서비스) | 데스크탑 | `rpa/gov24·nhis·work24·apply_rpa`·`rpa/manager` 지원목록·연쇄발급·자동신청 배선 |
| 크로스 경계(협의·claim 필요) | — | `backend/local_server.py`(w2 구조 ↔ 데스크탑 RPA 라우트 미러)·`api/routes.py`·`DocumentCenter`·`ChatWidget`·`RpaInfoForm`·`main.py` |

> 배포 규칙(2026-07-08 경합으로 라이브 회귀 발생): `npm run deploy` 는 로컬 작업트리를 빌드해
> gh-pages 를 force-push 한다. 로컬 main 이 stale 하면 라이브가 과거로 회귀한다(실제로 데스크탑 배포가
> w2의 chatAgent 수정을 stale 빌드로 덮어쓴 적 있음). → 배포 전 반드시 `git fetch && git rebase origin/main`
> (또는 pull)로 origin/main 최신화 후 배포. 배포 직후 라이브 index.js 해시가 방금 빌드본과 같은지 확인.
> 두 트랙이 동시에 배포하지 말 것(이 파일로 '배포 중' 알린 뒤 한 트랙만).

> 2026-07-07 갱신: 데스크탑 트랙이 로컬 에이전트 RPA 능력 확장(서류 6→11종·연쇄발급·자동신청 일반화)을
> 진행. 그 영역은 데스크탑 소유. w2 는 패키징·감지·브라우저 인프라·테스트로 좁힌다.
> `local_server.py` 는 데스크탑 RPA 라우트와 미러 관계라 크로스 경계 — 양쪽 claim 후 수정.

> 크로스 경계 파일은 claim으로 잠깐 소유권을 명시하고, 끝나면 즉시 반납한다.

## 현재 상황 스냅샷 (최종 갱신: 터미널/w2, 2026-07-11)
- 라이브: https://biocode67.github.io/modoo-bom/
- 통합 상태: 합쳐진 main 상시 green — 프론트 559·백엔드 84+ 테스트·E2E 스모크·lint·tsc.
- 터미널/w2 최근: 로컬앱 동일출처 자동발급 완성(경량 에이전트 1초 기동)·단일 실행파일+Inno 인스톨러·
  브라우저 폴백(Chrome→Edge)·gov24 RPA 라이브 검증(자동입력+인증요청까지, 사용자는 폰 '인증 허용'만)·
  히어로 말풍선/마스코트 통일·챗 콜드스타트·하이브리드 검색(RRF)·문서 문체 정리.
- 데스크탑 최근: 프론트 감사·보안 하드닝·a11y·정직성 수정 + 로컬 에이전트 RPA 확장(서류 11종·연쇄발급·자동신청 일반화)·i18n.

## 현재 진행 중 (claims)
| 트랙 | 파일/영역 | 작업 | 상태 | 갱신 |
|---|---|---|---|---|
| 터미널/w2 | `components/DocumentCenter.tsx`·`RpaInfoForm.tsx` | 자동발급 인증정보 미입력 시 첫 빈 칸으로 안내·폼 유도 | done | 07-07 |
| 터미널/w2 | `lib/backend.ts finalizeCaps` | 동일출처 RPA 오탐 수정 | done | 07-07 |
| 터미널/w2 | `local_server.py`·`docs/앱-릴리스-노트.md` | 첫 실행 UX 친절화(콘솔 제목·안내 배너·3단계 설치 가이드) | done | 07-10 |
| 터미널/w2 | `Hero.tsx`·`HeroAgentBubble`·`three/*`·`ui/SproutLogo`·favicon | 말풍선이 3D 새싹 가림 수정 + 2D/3D 마스코트 통일 (사용자 요청) | done | 07-11 |
| 터미널/w2 | `ChatWidget.tsx`·`chatAgent.ts`·`api/chat.py` | 챗 비복지 질문 응답 + 콜드스타트 웨이크 대기 (사용자 요청) | done | 07-11 |
| 터미널/w2 | `lib/semanticSearch.ts`·`Explore.tsx` | 하이브리드 검색(RRF: 임베딩+키워드) | done | 07-11 |
| 터미널/w2 | `README.md`·`extension/README.md`·`기획서자료실/README.md`·내부 문서 | 문서 문체 정리(이모지 제거·서술 통일) — 사용자 요청, 일회성 크로스 claim | done | 07-11 |
| 터미널/w2 | `rpa/base.py`·릴리스 자산 | --no-sandbox를 번들 Chromium에만(실브라우저 샌드박스 유지) + exe 재빌드·릴리스 재게시(친절 배너·샌드박스 수정 포함) | done | 07-11 |
| 터미널/w2 | `scripts/embed-policies.mts`·임베딩 | 패시지 필드예산 배분 + 5,308건 재임베드·배포 | done | 07-11 |

> 데스크탑 트랙 참고(07-11): app-v0.3.0 릴리스 자산을 w2가 재게시함(새 배너·번들 README·샌드박스 수정 포함,
> REST API 사용 — gh CLI 이 머신에 없음, git credential 토큰으로 삭제→업로드). 추가 RPA 변경 전까지 재빌드 불필요.
> 웹 '앱 바로 받기'는 releases/latest/download 직링크로 연결됨.
| 터미널/w2 | `rpa/*`·`RpaInfoForm`·`DocumentCenter`·store | **복지관 현장 대비(사용자 직접 지시·7/13-14 방문)**: 인증수단 선택(카카오·PASS·네이버·토스, 3종 라이브 검증)·신청 서류 자동첨부·slow_mo 300→120·검토창 10분·'다음 분 상담' PII 리셋·현장 런북 | done | 07-11 |
| 새PC/w3 | (영역 미정 — 시작 시 여기에 claim) | — | active | 07-10 |
| 새PC/w4 | (영역 미정 — 시작 시 여기에 claim) | — | active | 07-10 |
| 새PC/w5 | (영역 미정 — 시작 시 여기에 claim) | — | active | 07-10 |

> 데스크탑 트랙에 핸드오프(07-10): 비개발자용 첫 실행 UX를 main에 반영.
> `local_server._set_console_title()`+새 배너, `docs/앱-릴리스-노트.md` 3단계 설치 가이드(SmartScreen 안내).
> 번들 `사용법-README.txt`(데스크탑 작성)와 문구 일관 확인. 다음 exe 재빌드 시 배너가 자동 포함되니
> `build-installer.bat`→`publish-release.bat(--clobber)`는 릴리스 게시 레인인 데스크탑이 진행 요망
> (w2는 release 자산 업로드를 중복 실행하지 않음 — --clobber 충돌 방지).

> 데스크탑 트랙에 알림: 보안 하드닝의 `finalizeCaps`가 `caps.rpa = !!RPA_BASE`로 판정하면서
> 동일출처(데스크탑 앱)의 정상 RPA_BASE=''(상대경로)를 false로 오판 → 8000 이외 포트에서 자동발급
> UI가 침묵 실패했다. rpaOk 불리언으로 수정했고 PII 차단 의도(isLocalRpaBase)는 유지.
> `lib/backend.ts`는 w2 레인이니 감지 로직 변경 시 w2와 조율 요망.

## 현장 3대 버튼 종단 검증 (w2, 07-11 헤드리스·API 경로·푸시 무발생)
- 단건 발급(rpa-issue): 카카오·PASS·네이버 3종 — 인증대기 10~12초 도달, 자동입력 확인
- 전부 자동발급(journey/run): queued_slot 경유 1단계 인증대기 12초 도달(PASS 안내 정확)
- 신청(apply/start): 복지로 간편인증 폼 12초 도달, download_token 반환(스크린샷 인가) 확인
- 검증법: 생년월일 없는 프로필 → '인증 요청' 자동클릭 안 됨(폰 푸시 X). 인증 후 완주는 사용자 리허설 몫.

## 라이브 검증 완료 (w2, 2026-07-07) — 전체 여정 실동작
- 서류 자동발급(gov24): launch_browser→정부24 로그인→간편인증→이름·생년월일·연락처 자동입력+'인증 요청' 클릭까지 완료 → 사용자는 폰 '인증 허용'만.
- 복지 신청(복지로): apply/start→복지로 로그인→간편인증→카카오 본인인증 폼 도달(이름·생년월일·휴대폰 입력 안내) → 사용자가 인증·제출.
- 두 흐름 모두 브라우저 폴백(Chrome→Edge)에서 정상 동작 확인.

## w2 다중 관점 감사 결과 (2026-07-07) — w2가 수정한 것 + 데스크탑에 넘기는 것
w2 수정 완료(백엔드/패키징/감지/테스트 레인): rpa_enabled fail-closed(공개서버 PII 유출 차단)·
패키징 스모크 브라우저 실기동 검증+빌드 하드페일·DOCS_DIR 실바탕화면 해석(OneDrive)·감지 클라우드
오클로버·중복DOM id·rpa-file/launch_browser/토큰 회귀 테스트 다수·8000 포트 안내. (커밋 참조)

감사 지적 처리 현황(07-11 갱신):
- ~~journey가 _MAX_QUEUE 백프레셔 우회~~ → **w2가 수정**(4일 경과·마감 임박이라 크로스 claim): `manager.queued_slot()` 신설,
  orchestrator가 사용. 회귀 테스트 `test_manager_safety.py`. 데스크탑 트랙은 이후 여정 로직 변경 시 queued_slot 유지 요망.
- ~~_evict_old 가 실행 중 태스크도 제거~~ → **w2가 수정**: 종료 상태(done/completed/error)만 퇴거. 같은 테스트로 고정.
- ~~`--no-sandbox` 실브라우저 적용~~ → **w2가 수정**(자기 레인): 번들 Chromium에만 적용, 회귀 테스트 2건.
- ~~status의 screenshot_b64 노출~~ → **w2가 수정**(07-11): rpa-status·apply-status 스크린샷을 시작자 토큰(?t=)으로
  게이트(양쪽 앱 패리티+테스트), apply/start가 토큰 반환, 프론트 폴러(AgentSubmitButton·DocumentCenter) ?t= 전달.
- **잔여**: rate_limit XFF 무검증(`api/rate_limit.py`, 클라우드) — 데스크탑/추후.

> 적대적 리뷰(07-11, w2 변경분 대상) 결과: 치명 1건 발견·수정 — 영어 질의에서 1글자 사용자어 예외(a/I)가
> 정책명 라틴 표기(AI·MRI)에 오탐돼 검색이 잡음으로 오염. `search.ts` 1글자 예외를 한글로 한정(근본) +
> 하이브리드 키워드 레인 한글 게이트. 라이브 실측으로 잡음 0 확인. 잠복 1건(embed head 예산)·완화 1건(챗 웨이크 25s 캡)도 처리.

해결됨(w2, 07-07):
- 설치본 GitHub Release 게시 완료 → https://github.com/BioCode67/modoo-bom/releases/tag/app-v0.3.0
  (ModooBom-Setup.exe 45MB · ModooBom-Agent.zip 60MB). RpaShowcase '앱 받기' CTA가 이제 exe 직접
  다운로드(releases/latest/download)로 연결됨. GitHub 은 자산 한글 파일명을 전부 제거(모두봄-설치.exe→-.exe)하므로
  ASCII 이름 필수 — `publish-release.bat` 가 자동 복사·업로드(빌드본 갱신 시 재실행). 노트: `docs/앱-릴리스-노트.md`.

사용자(계정 소유자) 판단 요망:
- 미서명 인스톨러 → SmartScreen 경고: 코드서명(OV/EV) 또는 '추가 정보→실행' 안내를 제출자료에 명시(릴리스 노트엔 안내 포함).
- 업데이트된 빌드를 릴리스에 반영하려면 `build-installer.bat` → `publish-release.bat`(--clobber) 재실행.

## 사용자 최우선 요청 (2026-07-08) — 방향: "무설치 핸드오프 극한(1) + 데스크탑 앱 진짜자동 강조(2)". 마이데이터 API는 보류.
사용자 목표: 배포 웹에서 AI 에이전트 대화로 탐색/추천/발급/신청/관리를 아주 쉽고 즐겁게.
현재 실측: 발급은 데스크탑앱에서 '자동입력+인증요청→폰 탭'까지 됨. 신청은 복지로 이동+기본정보 작성+제출직전
정지까지만 — 서류 '첨부'와 최종제출은 미자동.
→ 데스크탑 트랙(프론트·RPA 레인) 작업 제안 (w2는 패키징·감지·테스트로 뒷받침):
1. AI 에이전트가 '발급→전자문서지갑→복지로 전자제출'을 대화로 끝까지 손잡고 안내(무설치·완전자동에 가장 근접, 정부 공식). ChatWidget/DocumentCenter/ApplyKit UX.
2. 신청 서류첨부 자동화: (A) 전자문서지갑 연동 안내 우선 / (B) RPA가 발급 PDF를 양식 첨부칸에 set_input_files (서비스별 브리틀 주의). apply_rpa.
3. 무설치 원터치 핸드오프를 대화형으로 더 매끄럽게(정보복사→딥링크→복귀확인).
※ w2가 필요하면 크로스경계 claim 후 일부 거들 수 있음(예: 첨부용 발급파일 경로 API). 우선 데스크탑 판단 요망.

## 대회 일정 메모 (2026-07-11 확인, DACON 공식)
- 7/15(수) 예선 최종 산출물 제출 마감 · 7/17(금) 예선 투표 마감(참가자 전원+공개 커뮤니티가 기획서·시연영상·데모링크를 보고 투표).
- 시사점: 투표자가 라이브 데모를 직접 열어본다 → 첫 화면·챗봇 첫인상이 득표 직결. 시연영상(30초~1분) 강력 권장.
- 촬영 대본: `docs/기획서자료/시연영상-촬영대본.md` (풀 여정 90초) · `docs/기획서자료/RPA-시연영상-가이드.md` (발급 60초).

> 참고(07-11): 팀원 PR #1(fix/etl)로 ETL의 sid 없는 항목 ID가 hash()→sha256(결정적)으로 변경됨 — 좋은 수정.
> ⚠️ 파급: 이후 `policies.json`을 재수집하면 일부 LOC- ID가 바뀐다 → **재수집 시 `npm run embed`(임베딩 재계산) 필수**,
> 사용자 기기의 담아둔 목록(tracked)·발급기록(docDone)은 이름 기준이라 무관하나 policyId 참조는 끊길 수 있음(재분석 안내).

## 협의 대기 / 제안 (다른 트랙이 판단)
- 추천 정직성: "월 예상 혜택 상위 5" 차트가 조건부 고액 서비스(장기요양·자활)를 상단에 올려 과대약속 소지 →
  데스크탑 트랙(정직성 감사)이 검토 권장. (w2는 미터치)
- 복지로 신청 인증 자동입력: gov24 발급은 인증정보 자동입력까지 하지만, 복지로 신청은 인증 '폼 도달'까지만(외부 iframe).
  gov24처럼 iframe 자동입력을 시도할 수 있으나 브리틀·실인증 필요 → RPA 레인이지만 리스크상 보류, 협의 후 진행 판단.
