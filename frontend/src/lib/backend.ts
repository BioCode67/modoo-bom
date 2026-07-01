/** 백엔드(FastAPI) 가용성 감지 — 로컬 에이전트 브릿지.
 *
 * 정적 배포(gh-pages)에는 백엔드가 없지만, 사용자가 자기 PC에서 로컬 에이전트
 * (`run-windows.bat` → uvicorn :8000)를 켜두면 배포된 웹이 이를 감지해 RPA
 * 자동발급·신청을 활성화한다. 감지 순서: VITE_API_BASE(설정 시) → 로컬 에이전트.
 *
 * `API_BASE`는 `export let` 라이브 바인딩이라, 감지 성공 시 여기서 재할당하면
 * 이를 `import { API_BASE }` 로 참조하는 소비자(AgentSubmitButton/DocumentCenter)도
 * 호출 시점에 갱신된 값(로컬 에이전트 주소)을 그대로 사용한다.
 */

// 빌드 시 VITE_API_BASE가 있으면 최우선, 없으면 동일 출처('').
export let API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || ''
const LOCAL_AGENT = 'http://localhost:8000'

let cached: boolean | null = null

// /api/health 로 백엔드 생존 확인(짧은 타임아웃, 네트워크/CORS 실패는 조용히 false).
async function ping(base: string, ms: number): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export async function checkBackend(timeoutMs = 1500): Promise<boolean> {
  if (cached !== null) return cached
  // 1) 설정된 base(또는 동일 출처) 먼저 시도
  if (await ping(API_BASE, timeoutMs)) {
    cached = true
    return cached
  }
  // 2) 사용자 PC의 로컬 에이전트 감지 → 있으면 이후 RPA 호출을 여기로 향하게 API_BASE 승격
  if (API_BASE !== LOCAL_AGENT && (await ping(LOCAL_AGENT, timeoutMs))) {
    API_BASE = LOCAL_AGENT
    cached = true
    return cached
  }
  cached = false
  return cached
}

export function resetBackendCache() {
  cached = null
}
