import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Supabase 연동 — 로그인 + 클라우드 동기화 (선택 기능).
 *
 * 성능: `@supabase/supabase-js`는 **동적 import**로 지연 로딩한다. 환경변수가 없으면(기본 배포)
 * `isAuthEnabled()`가 false라 라이브러리를 **아예 내려받지 않음** → 콜드스타트에 영향 0.
 * 설정+로그인 사용 시에만 별도 청크로 로드된다. anon key는 공개 안전, 데이터는 RLS로 보호.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 로그인/동기화가 설정되었는지 (환경변수 존재 여부) */
export function isAuthEnabled(): boolean {
  return !!(URL && ANON)
}

let _client: SupabaseClient | null = null
let _loading: Promise<SupabaseClient | null> | null = null

/** 설정된 경우에만 클라이언트 반환(지연 로딩). 미설정이면 null. */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!isAuthEnabled()) return null
  if (_client) return _client
  if (!_loading) {
    _loading = import('@supabase/supabase-js').then(({ createClient }) => {
      _client = createClient(URL as string, ANON as string, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
      return _client
    })
  }
  return _loading
}

export type AuthProvider = 'kakao' | 'google'

/** OAuth 로그인 시작(리다이렉트). 미설정이면 무동작. */
export async function signIn(provider: AuthProvider): Promise<void> {
  const sb = await getSupabase()
  if (!sb) return
  const redirectTo = window.location.origin + (import.meta.env.BASE_URL || '/')
  await sb.auth.signInWithOAuth({ provider, options: { redirectTo } })
}

export async function signOut(): Promise<void> {
  const sb = await getSupabase()
  await sb?.auth.signOut()
}

export async function getCurrentUser(): Promise<User | null> {
  const sb = await getSupabase()
  if (!sb) return null
  const { data } = await sb.auth.getUser()
  return data.user ?? null
}

/** 인증 상태 변화 구독. 해제 함수를 Promise로 반환(미설정이면 no-op 해제). */
export async function onAuthChange(cb: (user: User | null) => void): Promise<() => void> {
  const sb = await getSupabase()
  if (!sb) return () => {}
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null))
  return () => data.subscription.unsubscribe()
}

/** 제공자별로 제각각인 user_metadata에서 표시용 이름·아바타를 정규화 */
export function userDisplay(user: User | null): { name: string; avatar: string | null } {
  if (!user) return { name: '', avatar: null }
  const m = (user.user_metadata ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v ? v : '')
  const name =
    s(m.name) || s(m.full_name) || s(m.nickname) || s(m.preferred_username) ||
    (user.email ? user.email.split('@')[0] : '') || '이용자'
  const avatar = s(m.avatar_url) || s(m.picture) || null
  return { name, avatar }
}
