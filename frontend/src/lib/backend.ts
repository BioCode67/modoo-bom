/** 백엔드(FastAPI) 감지 + capabilities 게이팅 + 콜드스타트 웨이크업.
 *
 * 하이브리드 구조:
 *  - 클라우드(Render 상시배포): AI 분석·추천·챗봇·검색. VITE_API_BASE 로 주소 지정.
 *    Render 무료 티어는 유휴 시 슬립 → 첫 요청이 30~60초(콜드스타트)라, 짧은 타임아웃으론
 *    감지 실패한다. 그래서 configured base 는 여러 번 재시도(웨이크업)한다.
 *  - 로컬 에이전트(사용자 PC uvicorn:8000): 실제 RPA 서류발급/자동신청.
 *
 * capabilities.rpa 가 true 일 때만 프론트가 RPA 버튼을 노출한다(클라우드에서 '자동발급 가능'
 * 오표시 방지). ai 는 AI 기능 활성 여부.
 *
 * API_BASE 는 `export let` 라이브 바인딩 — 로컬 에이전트 승격 시 재할당하면 소비처도 갱신됨.
 */

export interface Capabilities {
  ai: boolean
  rpa: boolean
  ai_provider?: string
  rag?: string
}

export let API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || ''
const LOCAL_AGENT = 'http://localhost:8000'

let cached: boolean | null = null
let caps: Capabilities | null = null

export function getCapabilities(): Capabilities | null {
  return caps
}

// /api/health 1회 호출 → capabilities 반환(실패 시 null). 짧은 타임아웃.
async function fetchHealth(base: string, ms: number): Promise<Capabilities | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = await res.json().catch(() => ({}))
    return (j.capabilities as Capabilities) ?? { ai: j.mode === 'production', rpa: false }
  } catch {
    return null
  }
}

/** 콜드스타트를 견디며 configured base 를 깨운다. onWake 로 진행상황 통지. */
async function wake(base: string, onWake?: (attempt: number, max: number) => void): Promise<Capabilities | null> {
  const MAX = 12 // 약 최대 ~60초
  for (let i = 0; i < MAX; i++) {
    onWake?.(i + 1, MAX)
    const c = await fetchHealth(base, 4500)
    if (c) return c
    await new Promise((r) => setTimeout(r, 700))
  }
  return null
}

/**
 * 백엔드 가용성 확인. onWake 콜백으로 "서버 깨우는 중" UI 를 그릴 수 있다.
 * 성공 시 capabilities 를 캐시(getCapabilities).
 */
export async function checkBackend(onWake?: (attempt: number, max: number) => void): Promise<boolean> {
  if (cached !== null) return cached

  if (API_BASE) {
    // 명시된 클라우드 백엔드 — 콜드스타트 대비 웨이크업 재시도
    const c = await wake(API_BASE, onWake)
    if (c) { caps = c; cached = true; return true }
  } else {
    // 동일 출처(대개 백엔드 없음) — 빠르게 1회만
    const c = await fetchHealth('', 1500)
    if (c) { caps = c; cached = true; return true }
  }

  // 사용자 PC 로컬 에이전트 감지 → RPA 활성
  if (API_BASE !== LOCAL_AGENT) {
    const c = await fetchHealth(LOCAL_AGENT, 1500)
    if (c) { API_BASE = LOCAL_AGENT; caps = c; cached = true; return true }
  }

  cached = false
  return false
}

export function resetBackendCache() {
  cached = null
  caps = null
}
