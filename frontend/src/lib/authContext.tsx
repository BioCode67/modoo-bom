import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from './useAuth'

/**
 * 인증/동기화 상태를 앱 전역에 한 번만 구독해 공유한다.
 * (useAuth를 여러 컴포넌트에서 호출하면 동기화 구독이 중복되므로 Context로 단일화)
 */
type AuthCtxValue = ReturnType<typeof useAuth>
const AuthCtx = createContext<AuthCtxValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>
}

export function useAuthCtx(): AuthCtxValue {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuthCtx must be used within <AuthProvider>')
  return v
}
