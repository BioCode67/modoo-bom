# 로그인 · 클라우드 동기화 설정 (선택)

모두봄은 **로그인 없이도** 모든 기능이 동작합니다(데이터는 브라우저에 저장).
아래를 설정하면 **카카오·구글 로그인**과 **기기 간 '나의 복지' 신청 현황 동기화**가 켜집니다.

> 정적 사이트(GitHub Pages)에서 서버 없이 동작하도록 **Supabase**(무료 티어)를 사용합니다.
> `anon key`는 공개되어도 안전한 키이며, 데이터는 Postgres RLS로 사용자별로 분리·보호됩니다.

## 1. Supabase 프로젝트 생성
1. https://supabase.com 가입 → **New project** (무료).
2. **SQL Editor** 에서 [`schema.sql`](./schema.sql) 내용을 붙여넣고 실행 → `tracked_policies` 테이블 + RLS 생성.

## 2. 소셜 로그인 제공자 등록
Supabase 대시보드 → **Authentication → Providers** 에서 활성화.
공통 Redirect(콜백) URI: `https://<프로젝트>.supabase.co/auth/v1/callback`

### 카카오
1. https://developers.kakao.com → 애플리케이션 추가.
2. **카카오 로그인** 활성화 → **Redirect URI** 에 위 콜백 URI 등록.
3. **REST API 키**(+ 보안 → Client Secret)를 Supabase Kakao provider 에 입력.
4. 동의항목에서 닉네임/프로필 이미지(선택) 허용.

### 구글
1. https://console.cloud.google.com → **OAuth 동의 화면** 구성 → **사용자 인증 정보 → OAuth 클라이언트 ID(웹)**.
2. **승인된 리디렉션 URI** 에 위 콜백 URI 등록.
3. 발급된 **클라이언트 ID/Secret** 을 Supabase Google provider 에 입력.

> 네이버는 Supabase 기본 제공자가 아니라 현재 미포함입니다(추후 커스텀 OAuth로 확장 가능).

## 3. 복귀 URL 허용
Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://biocode67.github.io/modoo-bom/`
- **Redirect URLs** 에 추가: `https://biocode67.github.io/modoo-bom/`, `http://localhost:5173/`(로컬 개발용)

## 4. 프론트엔드에 키 입력 후 배포
`frontend/.env` 파일을 만들고(=`.env.example` 복사) 값 채우기:
```
VITE_SUPABASE_URL=https://<프로젝트>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
```bash
cd frontend && npm run deploy
```
배포 후 우측 상단에 **로그인** 버튼이 나타납니다. 로그인하면 '나의 복지'가 클라우드에 동기화되어
다른 기기·브라우저에서도 신청 현황을 이어서 볼 수 있습니다.

## 동작 방식 (요약)
- **로컬 우선**: 추적목록은 항상 브라우저에 저장되고, 로그인 시 클라우드와 **병합**(정책별 최신 우선)됩니다.
- **미설정/로그아웃**: `.env`가 비어 있으면 `@supabase/supabase-js`는 빌드에서 제외되어 **콜드스타트에 영향이 없습니다**.
- **프라이버시**: 본인 데이터만 접근(RLS). 키가 없으면 로그인 UI 자체가 숨겨집니다.
