import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 하이브리드 감지: AI 베이스(클라우드)와 RPA 베이스(로컬 에이전트)를 분리한다.
 * 핵심 회귀 방지 — 배포(VITE_API_BASE=클라우드) 사이트에서도 localhost:8000 을 병렬 탐지해
 * 로컬 에이전트(rpa=true)를 잡아야 자동발급 버튼이 살아난다.
 */

const LOCAL = 'http://localhost:8000'
const CLOUD = 'https://modoo-bom.onrender.com'

/** URL별 응답을 흉내 내는 fetch 목. map[base] = capabilities | null(연결거부). */
function mockFetch(map: Record<string, { ai: boolean; rpa: boolean } | null>) {
  return vi.fn(async (url: string) => {
    const base = String(url).replace('/api/health', '')
    const caps = map[base]
    if (caps == null) throw new Error('connection refused')
    return { ok: true, json: async () => ({ mode: 'production', capabilities: caps }) } as Response
  })
}

/** env(VITE_API_BASE)를 지정해 backend.ts 를 신선하게 로드한다(API_BASE 는 로드시 확정되므로). */
async function loadBackend(apiBase?: string, baseUrl = '/modoo-bom/') {
  vi.resetModules()
  if (apiBase === undefined) vi.stubEnv('VITE_API_BASE', '')
  else vi.stubEnv('VITE_API_BASE', apiBase)
  // 기본은 정적 프로젝트 페이지(base='/modoo-bom/')로 동일출처 프로브 스킵. '/'면 코호스팅(로컬 앱).
  vi.stubEnv('BASE_URL', baseUrl)
  return await import('./backend')
}

describe('backend 하이브리드 감지', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('배포(클라우드 AI) + 로컬 에이전트(rpa) 동시 → RPA 는 로컬, AI 는 클라우드', async () => {
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: { ai: true, rpa: false }, [LOCAL]: { ai: true, rpa: true } }))
    const b = await loadBackend(CLOUD)
    const ok = await b.checkBackend()
    expect(ok).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(true)   // 로컬 에이전트에서 rpa 승격
    expect(b.getCapabilities()?.ai).toBe(true)
    expect(b.getRpaBase()).toBe(LOCAL)            // RPA 호출은 로컬로
    expect(b.API_BASE).toBe(CLOUD)                // AI/WS 는 클라우드 유지
  })

  it('배포(클라우드 AI) 단독, 로컬 에이전트 없음 → rpa=false, RPA 베이스 비어있음', async () => {
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: { ai: true, rpa: false }, [LOCAL]: null }))
    const b = await loadBackend(CLOUD)
    expect(await b.checkBackend()).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(false)
    expect(b.getRpaBase()).toBe('')
    expect(b.API_BASE).toBe(CLOUD)
  })

  it('완전 로컬 구동(클라우드 미설정) → 로컬을 AI·RPA 베이스로 승격', async () => {
    vi.stubGlobal('fetch', mockFetch({ [LOCAL]: { ai: true, rpa: true } }))
    const b = await loadBackend('')
    expect(await b.checkBackend()).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(true)
    expect(b.getRpaBase()).toBe(LOCAL)
    expect(b.API_BASE).toBe(LOCAL)
  })

  it('데스크탑 앱(동일출처 localhost, base=/) → rpa 가용·RPA_BASE는 상대경로(빈문자열)', async () => {
    // 로컬 앱은 백엔드가 프론트를 localhost 에서 직접 서빙(동일출처, base='/'). 이때 RPA_BASE 는 정상적으로
    // ''(상대경로)다 — 과거 caps.rpa=!!RPA_BASE 로 ''를 false 로 오판해 8000 이외 포트에서 자동발급이 사라졌다.
    vi.stubGlobal('window', { location: { hostname: 'localhost' } }) // 동일출처 로컬 판정용
    vi.stubGlobal('fetch', mockFetch({ '': { ai: false, rpa: true } })) // 동일출처(base='') 백엔드가 rpa:true
    const b = await loadBackend('', '/') // 클라우드 미설정 + 코호스팅(base=/)
    expect(await b.checkBackend()).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(true) // 동일출처 로컬도 rpa 가용으로 노출돼야 함
    expect(b.getRpaBase()).toBe('') // RPA 호출은 상대경로(동일출처)
  })

  it('배포 사이트(동일출처지만 비-localhost) → rpa 노출 안 함(클라우드 PII 전송 차단)', async () => {
    vi.stubGlobal('window', { location: { hostname: 'biocode67.github.io' } })
    vi.stubGlobal('fetch', mockFetch({ '': { ai: true, rpa: true } })) // 설령 동일출처가 rpa:true 라 보고해도
    const b = await loadBackend('', '/')
    // 비-localhost 동일출처는 로컬이 아니므로 RPA 비노출(강식별 PII 를 클라우드로 보내지 않음)
    await b.checkBackend()
    expect(b.getCapabilities()?.rpa).toBe(false)
    expect(b.getRpaBase()).toBe('')
  })

  it('클라우드 콜드(무응답)여도 로컬 에이전트(rpa)는 즉시 감지 — 60초 웨이크 뒤에서 안 기다림', async () => {
    // CLOUD 는 항상 실패(콜드/다운), LOCAL 만 응답 → 로컬이 응답하면 웨이크 루프를 돌지 않아야 함.
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: null, [LOCAL]: { ai: false, rpa: true } }))
    const b = await loadBackend(CLOUD)
    // 웨이크 루프(~8초)를 탔다면 이 테스트는 기본 타임아웃(5초)에 걸린다 → 빠른 통과 자체가 개선 증거.
    expect(await b.checkBackend()).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(true)
    expect(b.getRpaBase()).toBe(LOCAL)
  })

  it('resetBackendCache 는 로컬 승격된 API_BASE 를 env 기본값으로 원복', async () => {
    vi.stubGlobal('fetch', mockFetch({ [LOCAL]: { ai: false, rpa: true } }))
    const b = await loadBackend('') // 클라우드 미설정
    await b.checkBackend()
    expect(b.API_BASE).toBe(LOCAL) // 로컬 에이전트로 승격됨
    b.resetBackendCache()
    expect(b.API_BASE).toBe('') // env('')로 원복 → 에이전트 끈 뒤 재탐지 오탐 방지
  })

  it('동시 checkBackend 호출은 프로브를 한 번만(웨이크 중복 방지)', async () => {
    const f = mockFetch({ [CLOUD]: { ai: true, rpa: false }, [LOCAL]: { ai: false, rpa: true } })
    vi.stubGlobal('fetch', f)
    const b = await loadBackend(CLOUD)
    const [a, c] = await Promise.all([b.checkBackend(), b.checkBackend()])
    expect(a).toBe(true)
    expect(c).toBe(true)
    expect(f).toHaveBeenCalledTimes(2) // 단일 실행(CLOUD+LOCAL). 중복이면 4회가 됐을 것
  })

  it('보안: 클라우드가 rpa:true를 보고해도(RPA_ENABLED 오설정) RPA_BASE는 클라우드로 안 감 → PII 미전송', async () => {
    // 로컬 에이전트 없음 + 원격이 rpa:true → 예전엔 RPA_BASE=클라우드가 되어 이름·생년월일·휴대폰이
    //   공유 서버로 전송될 수 있었다. 이제 로컬이 아니면 RPA_BASE 빈 값 유지(버튼 숨김·공식링크 폴백).
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: { ai: true, rpa: true }, [LOCAL]: null }))
    const b = await loadBackend(CLOUD)
    expect(await b.checkBackend()).toBe(true)
    expect(b.getRpaBase()).toBe('')            // ⚠️ 클라우드로 PII 안 감
    expect(b.getCapabilities()?.rpa).toBe(false) // RPA 버튼 숨김
    expect(b.getCapabilities()?.ai).toBe(true)   // AI(분석·챗)는 정상
  })

  it('아무 백엔드도 없음 → false, 베이스 그대로 (클라우드 웨이크업 재시도 소진)', async () => {
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: null, [LOCAL]: null }))
    const b = await loadBackend(CLOUD)
    expect(await b.checkBackend()).toBe(false)
    expect(b.getRpaBase()).toBe('')
    expect(b.getCapabilities()).toBe(null)
  }, 15000)
})
