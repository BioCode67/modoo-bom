# 🧳 모두봄 — 새 노트북 인수인계 가이드 (손실 없이 그대로 이어가기)

> 학교 노트북 반납 등으로 작업 환경을 옮길 때, **코드·비밀키·클로드 작업기록**을 하나도 잃지 않고
> 다른 노트북에서 똑같이 이어가기 위한 안내입니다.

---

## 📦 지금 무엇이 어디에 있나

| 항목 | 위치 | 새 노트북에서 |
|---|---|---|
| **소스 코드 전체** | GitHub `BioCode67/modoo-bom` (모두 푸시됨) | `git clone` |
| **비밀키 `.env` 2개** | 로컬만 (gitignore, GitHub에 없음) | 백업본에서 **복원** |
| **클로드 대화기록/메모리** | 로컬 `~/.claude/...` (GitHub에 없음) | 백업본을 **복사** |
| **프로젝트 컨텍스트·작업흐름** | `CLAUDE.md`·`LAUNCH.md`·git log (GitHub) | 자동 따라옴 |
| node_modules / venv / 빌드물 | 로컬 (재생성 가능) | `npm install` / `pip install`로 재생성 |

> 라이브 사이트: https://biocode67.github.io/modoo-bom/ (GitHub Pages, `gh-pages` 브랜치)

---

## 1️⃣ 옮기기 전 — 현재 노트북에서 백업 만들기

프로젝트 루트에서 아래 스크립트를 실행하면 **비밀키 + 클로드 메모리 + (선택)대화기록**을
Desktop에 하나의 압축파일로 묶어줍니다. 이 파일을 **USB나 클라우드 드라이브(구글드라이브 등)** 로 옮기세요.

```bash
cd ~/Desktop/modoo-bom && bash scripts/backup-handoff.sh
```

- 만들어지는 파일: `~/Desktop/modoo-bom-handoff-YYYYMMDD.tar.gz`
- 포함: `frontend/.env`, `backend/.env`(비밀키), 클로드 메모리, (원하면) 대화기록 전체
- ⚠️ 이 압축파일은 **비밀키가 들어있으니 GitHub·공개된 곳에 올리지 마세요.** USB/개인 클라우드로만.

> 대화기록(≈115MB)이 너무 크면 스크립트가 물어봅니다(메모리만 담기 / 전체 담기 선택).

---

## 2️⃣ 새 노트북에서 — 명령어 **한 줄**로 전부 자동 (clone→복원→설치→실행)

**준비:** 구글드라이브의 백업(`modoo-bom-handoff-*.tar.gz`)을 새 노트북 **Downloads 폴더로 다운로드**만 해두세요.

그다음 터미널에 **이 한 줄**을 붙여넣으면 끝:
```bash
curl -fsSL https://raw.githubusercontent.com/BioCode67/modoo-bom/main/scripts/setup-new-laptop.sh | bash
```

이 한 줄이 알아서 다 합니다:
1. 코드 `git clone` → `~/Desktop/modoo-bom`
2. 백업 자동 복원 — `frontend/.env`·`backend/.env` **비밀키** + 클로드 **메모리·대화기록**(사용자명 달라도 경로 자동 계산)
3. `npm install` (의존성 설치)
4. `npm run dev` → 브라우저에서 **http://localhost:5173** (종료: Ctrl+C)

> 백업 파일이 없어도 앱은 **전 기능 동작**(로그인·백엔드 RPA만 비활성). 나중에 `bash scripts/restore-handoff.sh` 로 복원 가능.
> git/node가 없다는 메시지가 뜨면 안내대로 `xcode-select --install`(git), [nodejs.org](https://nodejs.org)(node LTS) 설치 후 다시 실행.
>
> **백엔드(RPA)까지** 쓰려면: `cd ~/Desktop/modoo-bom/backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`

---

## 3️⃣ 클로드 코드 작업기록 (자동 복원됨)

위 `restore-handoff.sh` 가 클로드 메모리·대화기록까지 복원하므로 **수동 작업이 없습니다.**
(수동으로 하려면: 백업의 `claude-memory/`→`~/.claude/projects/-Users-<사용자명>/memory/`,
`claude-history/`→`~/.claude/projects/-Users-<사용자명>-Desktop/`. `-Users-it`은 경로 인코딩이라 사용자명이 다르면 그 부분만 교체.)

> **핵심 컨텍스트는 이미 `CLAUDE.md`(레포)와 `memory/`에 정리돼 있어**, 대화기록이 없어도 새 노트북에서
> 프로젝트 폴더에서 클로드 코드를 열면 흐름을 이어갑니다. 대화기록까지 복원하면 지난 대화도 열람돼요.

---

## 4️⃣ 작업 흐름·의사결정은 어디에 남아있나 (읽을거리)

- **`CLAUDE.md`** — 프로젝트 전체 구조·기능·데이터·품질·자동화 현실·주의점 (항상 최신 유지)
- **`LAUNCH.md`** — 앱스토어/Play 출시 단계
- **`~/.claude/.../memory/`** — 배포 방식·토큰 제약·최근 작업 요약 등 핵심 메모
- **git log** — 커밋 하나하나가 작업 단위(한국어 설명). `git log --oneline` 로 전체 흐름 확인

---

## 5️⃣ 배포(재확인)

- 재배포: `cd frontend && npm run deploy` (gh-pages 갱신) + `git push origin main`(소스) — **둘은 별개**
- 로그인 끄고 배포(OAuth 등록 전): `mv frontend/.env .env.hold && npm run deploy && mv .env.hold .env`
- ⚠️ 이 계정 PAT에 `workflow` 스코프가 없어 `.github/workflows`는 푸시 불가 → gh-pages 방식 유지

---

## ✅ 체크리스트

- [ ] 현재 노트북: `bash scripts/backup-handoff.sh` 실행 → 압축파일 USB/클라우드로 이동
- [ ] (혹시 로컬에 안 밀어둔 변경 있나) `git status` 깨끗한지 확인 → 있으면 커밋·푸시
- [ ] 새 노트북: `git clone` → `.env` 복원 → `npm install`
- [ ] 새 노트북: 클로드 메모리/대화기록 폴더 복사(사용자명 다르면 폴더명 변경)
- [ ] 새 노트북: 프로젝트 폴더에서 클로드 코드 열기 → `CLAUDE.md`·메모리로 흐름 이어짐
