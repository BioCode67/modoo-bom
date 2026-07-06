/** 백엔드(FastAPI) 감지 + capabilities 게이팅 + 콜드스타트 웨이크업.
 *
 * 하이브리드 구조 — AI 베이스와 RPA 베이스를 분리한다:
 *  - 클라우드 AI 베이스(Render 상시배포): AI 분석·추천·챗봇·검색. VITE_API_BASE 로 주소 지정.
 *    Render 무료 티어는 유휴 시 슬립 → 첫 요청이 30~60초(콜드스타트)라, 짧은 타임아웃으론
 *    감지 실패한다. 그래서 configured base 는 여러 번 재시도(웨이크업)한다. (RPA는 클라우드에서 비활성)
 *  - 로컬 에이전트(사용자 PC uvicorn:8000): 실제 RPA 서류발급/자동신청. **항상 병렬로 독립 탐지**하여,
 *    배포(HTTPS) 사이트에서도 사용자가 데스크탑 에이전트를 켜두면 자동발급이 활성화된다.
 *    (localhost 는 브라우저 mixed-content 예외라 HTTPS 페이지에서 http://localhost 호출이 허용됨)
 *
 * 그래서 베이스가 둘이다:
 *  - API_BASE : AI/WS(분석·챗봇) 호출용. 클라우드 우선, 없으면 로컬/동일출처.
 *  - RPA_BASE : RPA(서류발급·신청) 호출용. 로컬 에이전트 우선(실제 발급 가능).
 * capabilities.rpa 가 true 일 때만 프론트가 RPA 버튼을 노출한다(클라우드 단독일 때 '자동발급 가능'
 * 오표시 방지). rpa 는 로컬 에이전트(또는 동일출처 RPA 지원 백엔드) 감지 시에만 true.
 *
 * API_BASE/RPA_BASE 는 `export let` 라이브 바인딩 — 승격 시 재할당하면 소비처도 갱신된다.
 * (RPA 소비처는 getRpaBase() 사용 권장 — 게이팅 이후 값이 확정됨)
 */

export interface Capabilities {
  ai: boolean
  rpa: boolean
  ai_provider?: string
  rag?: string
}

const ENV_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || ''
export let API_BASE = ENV_API_BASE
export let RPA_BASE = '' // RPA 전용 베이스 — 로컬 에이전트 감지 시 채워짐(그 전엔 RPA 버튼도 숨김)
const LOCAL_AGENT = 'http://localhost:8000'

let cached: boolean | null = null
let caps: Capabilities | null = null
let inflight: Promise<boolean> | null = null // 동시 호출 중복 프로브(콜드스타트 웨이크 2배) 방지

export function getCapabilities(): Capabilities | null {
  return caps
}

/** RPA(서류발급·신청) 호출에 쓸 베이스. 로컬 에이전트 감지 시 그 주소, 아니면 ''(=미지원). */
export function getRpaBase(): string {
  return RPA_BASE
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
export function checkBackend(onWake?: (attempt: number, max: number) => void): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached)
  // 동시 호출(여러 컴포넌트 마운트)이 각자 웨이크(~최대 60초)를 돌리지 않도록 in-flight 프로미스 공유.
  if (!inflight) inflight = runCheck(onWake).finally(() => { inflight = null })
  return inflight
}

async function runCheck(onWake?: (attempt: number, max: number) => void): Promise<boolean> {
  // 로컬 에이전트(사용자 PC)는 RPA 전용으로 **항상 병렬 탐지** — 클라우드 AI와 독립.
  // 배포 HTTPS 사이트에서도 데스크탑 에이전트를 켜두면 자동발급이 살아나게 하는 핵심.
  // (connection refused 는 즉시 실패하므로 미설치 방문자에게도 지연 부담이 거의 없다.)
  const localProbe = fetchHealth(LOCAL_AGENT, 1500)

  // AI 베이스: 우선 '짧게' 한 번만 두드린다(따뜻하면 즉답). 콜드스타트 웨이크(최대 ~60초)는
  // 로컬 에이전트도 클라우드도 즉답하지 않을 때만 마지막에 돈다 → 로컬 에이전트 사용자가
  // 클라우드 콜드스타트 뒤에서 60초 기다리는 일이 없다.
  let aiCaps: Capabilities | null = null
  let aiBase = ''
  if (API_BASE) {
    aiCaps = await fetchHealth(API_BASE, 4500)
    if (aiCaps) aiBase = API_BASE
  } else if ((import.meta.env.BASE_URL || '/') === '/') {
    // 동일 출처 프로브는 코호스팅(도커/uvicorn, base='/')일 때만 의미가 있다.
    // 정적 프로젝트 페이지(gh-pages, base='/modoo-bom/')에선 매 방문 404 노이즈만 만들므로 스킵.
    aiCaps = await fetchHealth('', 1500)
  }

  let local = await localProbe

  // 로컬/클라우드 어느 쪽도 즉답 안 했고 클라우드가 설정돼 있으면 → 콜드스타트 웨이크업 재시도.
  if (!aiCaps && !local && API_BASE) {
    aiCaps = await wake(API_BASE, onWake)
    if (aiCaps) {
      aiBase = API_BASE
      local = await fetchHealth(LOCAL_AGENT, 1500) // 웨이크 대기 동안 에이전트가 떴을 수도
    }
  }

  if (!aiCaps && !local) { cached = false; return false }
  finalizeCaps(aiCaps, aiBase, local)
  cached = true
  return true
}

/** 감지 결과를 API_BASE/RPA_BASE/caps 로 확정. AI 는 클라우드/동일출처, RPA 는 로컬 우선. */
function finalizeCaps(aiCaps: Capabilities | null, aiBase: string, local: Capabilities | null) {
  if (local?.rpa) RPA_BASE = LOCAL_AGENT
  else if (aiCaps?.rpa) RPA_BASE = aiBase
  // AI 베이스를 못 잡았고 로컬만 있으면 로컬을 AI 베이스로도 승격(완전 로컬 구동).
  if (!aiCaps && local) API_BASE = LOCAL_AGENT
  caps = {
    ai: aiCaps?.ai ?? local?.ai ?? false,
    rpa: !!(local?.rpa || aiCaps?.rpa),
    ai_provider: aiCaps?.ai_provider ?? local?.ai_provider,
    rag: aiCaps?.rag ?? local?.rag,
  }
}

export function resetBackendCache() {
  cached = null
  caps = null
  RPA_BASE = ''
  API_BASE = ENV_API_BASE // 로컬 에이전트 승격으로 바뀐 값을 원복(에이전트를 끈 뒤 재탐지 시 오탐 방지)
  inflight = null
}
