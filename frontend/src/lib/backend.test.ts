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
async function loadBackend(apiBase?: string) {
  vi.resetModules()
  if (apiBase === undefined) vi.stubEnv('VITE_API_BASE', '')
  else vi.stubEnv('VITE_API_BASE', apiBase)
  // 정적 프로젝트 페이지가 아니라고 두어 동일출처 프로브 스킵(base='/modoo-bom/')
  vi.stubEnv('BASE_URL', '/modoo-bom/')
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

  it('클라우드 콜드(무응답)여도 로컬 에이전트(rpa)는 즉시 감지 — 60초 웨이크 뒤에서 안 기다림', async () => {
    // CLOUD 는 항상 실패(콜드/다운), LOCAL 만 응답 → 로컬이 응답하면 웨이크 루프를 돌지 않아야 함.
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: null, [LOCAL]: { ai: false, rpa: true } }))
    const b = await loadBackend(CLOUD)
    // 웨이크 루프(~8초)를 탔다면 이 테스트는 기본 타임아웃(5초)에 걸린다 → 빠른 통과 자체가 개선 증거.
    expect(await b.checkBackend()).toBe(true)
    expect(b.getCapabilities()?.rpa).toBe(true)
    expect(b.getRpaBase()).toBe(LOCAL)
  })

  it('아무 백엔드도 없음 → false, 베이스 그대로 (클라우드 웨이크업 재시도 소진)', async () => {
    vi.stubGlobal('fetch', mockFetch({ [CLOUD]: null, [LOCAL]: null }))
    const b = await loadBackend(CLOUD)
    expect(await b.checkBackend()).toBe(false)
    expect(b.getRpaBase()).toBe('')
    expect(b.getCapabilities()).toBe(null)
  }, 15000)
})
