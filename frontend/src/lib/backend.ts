/** 백엔드(FastAPI) 가용성 감지 — 있으면 RPA 자동발급 등 고급 기능 활성화 */

// 개발 시 vite proxy('/api')로 접근. 배포(정적)에서는 보통 백엔드가 없어 빠르게 실패 → 폴백.
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || ''

let cached: boolean | null = null

export async function checkBackend(timeoutMs = 1500): Promise<boolean> {
  if (cached !== null) return cached
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal })
    clearTimeout(t)
    cached = res.ok
  } catch {
    cached = false
  }
  return cached
}

export function resetBackendCache() {
  cached = null
}
