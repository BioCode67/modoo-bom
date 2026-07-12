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
  /** RPA 베이스가 '원격 서버 사이드'인지(로컬 에이전트가 아니라 사용자가 명시 지정+동의한 클라우드 RPA 서버).
   *  UI 는 이 값이 true 면 '내 정보가 서버를 거친다'는 동의 안내를 유지해야 한다(정직성·개인정보). */
  rpaRemote?: boolean
  ai_provider?: string
  rag?: string
}

const ENV_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || ''
export let API_BASE = ENV_API_BASE
// 체험(데모) 모드 전용 서버 — 개인정보를 요구/전송하지 않는 '실제 정부24 자동화 보여주기'용.
// PII가 없어 안전하므로 팀이 빌드 시 지정한 신뢰 서버(VITE_RPA_BASE)를 동의 없이도 쓸 수 있다.
const ENV_RPA_BASE = (import.meta.env.VITE_RPA_BASE as string | undefined)?.trim().replace(/\/+$/, '') || ''
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

/** 체험(데모) 모드에 쓸 서버 베이스 — 개인정보 없는 '실제 정부24 자동화 보여주기'용.
 *  우선순위: 이미 감지된 RPA 베이스(로컬/옵트인) → 빌드 시 지정 신뢰 서버(VITE_RPA_BASE). 둘 다 없으면 ''. */
export function getDemoRpaBase(): string {
  return RPA_BASE || ENV_RPA_BASE
}

// 서버 사이드 RPA(옵트인 전용) — 사용자가 '자신의 RPA 서버 주소'를 명시 지정하고 PII 전송에 '명시 동의'했을
//   때만 원격 RPA를 켠다. 기본(공개 배포)은 로컬 전용 유지 → 아무 설정 없는 방문자는 기존 안전 동작 그대로.
//   ⚠️ 개인정보: 이 경로가 켜지면 이름·생년월일·연락처가 지정 서버로 전송된다(서버는 저장 안 함이 원칙).
//      그래서 (1) https 서버만, (2) 명시 동의 플래그(modoo_rpa_consent==='1')가 둘 다 있어야 활성.
export const RPA_SERVER_KEY = 'modoo_rpa_server'
export const RPA_CONSENT_KEY = 'modoo_rpa_consent'
export function getConfiguredRemoteRpa(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const url = (localStorage.getItem(RPA_SERVER_KEY) || '').trim()
    const consent = localStorage.getItem(RPA_CONSENT_KEY) === '1'
    if (!url || !consent) return ''
    if (!/^https:\/\//i.test(url)) return '' // https 서버만(배포 폰은 https라 mixed-content·평문 PII 방지)
    return url.replace(/\/+$/, '')
  } catch {
    return ''
  }
}
/** 서버 사이드 RPA 옵트인 설정/해제 — UI(동의 화면)에서 호출. */
export function setRemoteRpaServer(url: string, consent: boolean) {
  try {
    if (typeof localStorage === 'undefined') return
    const clean = (url || '').trim().replace(/\/+$/, '')
    if (clean && consent && /^https:\/\//i.test(clean)) {
      localStorage.setItem(RPA_SERVER_KEY, clean)
      localStorage.setItem(RPA_CONSENT_KEY, '1')
    } else {
      localStorage.removeItem(RPA_SERVER_KEY)
      localStorage.removeItem(RPA_CONSENT_KEY)
    }
    resetBackendCache() // 재탐지 강제(다음 checkBackend 에서 원격 반영)
  } catch {
    /* noop */
  }
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

  // 서버 사이드 RPA(옵트인) — 사용자가 명시 지정+동의한 원격 RPA 서버가 있으면 별도 프로브(로컬 없을 때의 폰 경로).
  const remoteRpaBase = getConfiguredRemoteRpa()
  const remoteRpaCaps = remoteRpaBase ? await fetchHealth(remoteRpaBase, 5000) : null

  if (!aiCaps && !local && !remoteRpaCaps) { cached = false; return false }
  finalizeCaps(aiCaps, aiBase, local, remoteRpaBase, remoteRpaCaps)
  cached = true
  return true
}

/** RPA 호출엔 강식별 PII(이름·생년월일·휴대폰)가 실린다 → '로컬'에만 보낸다(공유 클라우드로 새지 않게).
 *  로컬 = localhost/127.0.0.1 로 향하는 베이스, 또는 페이지 자체가 localhost에서 서빙되는 동일출처(데스크탑 앱). */
function isLocalRpaBase(base: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) return true
  if (base === '') {
    const h = typeof window !== 'undefined' ? window.location.hostname : ''
    return h === 'localhost' || h === '127.0.0.1'
  }
  return false
}

/** 감지 결과를 API_BASE/RPA_BASE/caps 로 확정. AI 는 클라우드/동일출처, RPA 는 '로컬 우선 + 옵트인 원격 서버'. */
function finalizeCaps(
  aiCaps: Capabilities | null,
  aiBase: string,
  local: Capabilities | null,
  remoteRpaBase = '',
  remoteRpaCaps: Capabilities | null = null,
) {
  // ⚠️ 보안: RPA_BASE 는 (1)로컬 에이전트, (2)사용자가 명시 지정+동의한 원격 RPA 서버, (3)동일출처(로컬 앱)에만 둔다.
  //    '자동 감지된' 클라우드(aiBase)가 rpa:true 를 보고해도(RPA_ENABLED 오설정 등) 로컬이 아니면 PII 를 보내지
  //    않는다 → 빈 값 유지 → 버튼 숨김 + 공식 링크 폴백. 원격 서버는 오직 '명시 옵트인'(getConfiguredRemoteRpa)만 허용.
  let rpaOk = false
  let rpaRemote = false
  if (local?.rpa) { RPA_BASE = LOCAL_AGENT; rpaOk = true } // 로컬 에이전트 우선(PII 가 기기 밖으로 안 나감)
  else if (remoteRpaBase && remoteRpaCaps?.rpa) { RPA_BASE = remoteRpaBase; rpaOk = true; rpaRemote = true } // 옵트인 원격 서버
  else if (aiCaps?.rpa && isLocalRpaBase(aiBase)) { RPA_BASE = aiBase; rpaOk = true } // aiBase='' = 동일출처(로컬)
  else RPA_BASE = ''
  // AI 베이스를 못 잡았고 로컬만 있으면 로컬을 AI 베이스로도 승격(완전 로컬 구동).
  // ⚠️ 단, 클라우드 AI(VITE_API_BASE)가 '설정돼 있으면' 승격하지 않는다 — 설정된 클라우드가 콜드스타트라
  //    잠깐 무응답이어도 로컬(경량 서버, WS/LLM 없음)으로 덮어써 실제 클라우드 AI를 영영 못 깨우는 것을 방지.
  //    (클라우드는 이후 실제 분석/챗 연결에서 깨어나거나 클라이언트 엔진으로 폴백)
  if (!aiCaps && local && !ENV_API_BASE) API_BASE = LOCAL_AGENT
  caps = {
    ai: aiCaps?.ai ?? local?.ai ?? false,
    rpa: rpaOk, // 로컬 RPA 베이스가 확정됐는지(''=동일출처도 유효). 클라우드는 isLocalRpaBase=false 로 차단됨.
    rpaRemote, // true=옵트인 원격 서버 RPA(PII 가 서버를 거침 → UI 는 동의 안내 유지)
    ai_provider: aiCaps?.ai_provider ?? (remoteRpaCaps?.ai_provider ?? local?.ai_provider),
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
