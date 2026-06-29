import { describe, it, expect, vi, afterEach } from 'vitest'
import { WELFARE_POLICIES } from './policies'

const SEED = WELFARE_POLICIES.length

/** ok/throw 가능한 fetch 목 */
function mockFetch(payload: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => payload })) as unknown as typeof fetch
}

/** vitest는 테스트파일별 모듈 격리 → resetModules로 catalog 싱글톤 상태를 매번 초기화 */
async function loadFresh(fetchImpl: typeof fetch) {
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  const mod = await import('./catalog')
  const count = await mod.loadExternalCatalog()
  return { mod, count }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('loadExternalCatalog — 병합', () => {
  it('신규 정책을 시드에 병합(이름 중복 없을 때)', async () => {
    const { mod, count } = await loadFresh(mockFetch([
      { id: 'GOV-1', name: '테스트복지A', category: '노인', application: 'https://x', contact: '02-111-2222' },
      { id: 'GOV-2', name: '테스트복지B' },
    ]))
    expect(count).toBe(SEED + 2)
    expect(mod.getCatalog().length).toBe(SEED + 2)
    expect(mod.getPolicyMap()['GOV-1'].name).toBe('테스트복지A')
    expect(mod.getPolicyMap()['GOV-1'].contact).toBe('02-111-2222')
  })

  it('{ policies: [...] } 래핑 형태도 처리', async () => {
    const { count } = await loadFresh(mockFetch({ policies: [{ id: 'GOV-P', name: '래핑복지' }] }))
    expect(count).toBe(SEED + 1)
  })

  it('재호출은 멱등(loaded 가드)', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', mockFetch([{ id: 'GOV-I', name: '한번만' }]))
    const mod = await import('./catalog')
    const c1 = await mod.loadExternalCatalog()
    const c2 = await mod.loadExternalCatalog()
    expect(c1).toBe(SEED + 1)
    expect(c2).toBe(SEED + 1)
  })
})

describe('loadExternalCatalog — 디듑(시드 우선)', () => {
  it('시드와 이름 중복인 외부 정책은 스킵, 시드 데이터 보존', async () => {
    const seed = WELFARE_POLICIES[0]
    const { mod, count } = await loadFresh(mockFetch([
      { id: 'GOV-DUP', name: seed.name, benefit: '덮어쓰면안되는가짜값' },
    ]))
    expect(count).toBe(SEED) // 병합 없음
    expect(mod.getPolicyMap()['GOV-DUP']).toBeUndefined()
    expect(mod.getPolicyMap()[seed.id].benefit).toBe(seed.benefit) // 시드 그대로
  })

  it('공백만 다른 이름도 동일 취급(정규화 비교)', async () => {
    const seed = WELFARE_POLICIES[0]
    const spaced = seed.name.split('').join(' ') // 글자 사이 공백 삽입
    const { count } = await loadFresh(mockFetch([{ id: 'GOV-SP', name: spaced }]))
    expect(count).toBe(SEED)
  })
})

describe('loadExternalCatalog — 정규화 & 견고성', () => {
  it('잘못된 항목(null/원시값/필드누락)은 건너뛰고 유효 항목만 병합', async () => {
    const { mod, count } = await loadFresh(mockFetch([
      null, 42, '문자열', {}, { id: 'GOV-X' }, { name: '아이디없음' },
      { id: 'GOV-OK', name: '유효복지' },
    ]))
    expect(count).toBe(SEED + 1)
    expect(mod.getPolicyMap()['GOV-OK']).toBeTruthy()
  })

  it('누락 필드 기본값 + required_docs 문자열 → 배열', async () => {
    const { mod } = await loadFresh(mockFetch([
      { id: 'GOV-N', name: '정규화복지', required_docs: '신분증, 통장사본; 등본' },
    ]))
    const p = mod.getPolicyMap()['GOV-N']
    expect(p.required_docs).toEqual(['신분증', '통장사본', '등본'])
    expect(p.category).toBe('기타')
    expect(p.renewal).toBe('기관 안내 확인')
    expect(p.contact).toBeUndefined()
  })

  it('HTTP 실패(404)면 시드만 사용', async () => {
    const { mod, count } = await loadFresh(mockFetch([{ id: 'GOV-Z', name: '안나옴' }], false))
    expect(count).toBe(SEED)
    expect(mod.getPolicyMap()['GOV-Z']).toBeUndefined()
  })

  it('fetch 예외도 조용히 시드 폴백', async () => {
    const { count } = await loadFresh(vi.fn(async () => { throw new Error('network') }) as unknown as typeof fetch)
    expect(count).toBe(SEED)
  })

  it('getCategories는 병합 후 새 카테고리를 포함', async () => {
    const { mod } = await loadFresh(mockFetch([{ id: 'GOV-C', name: '신규카테고리복지', category: '보훈' }]))
    expect(mod.getCategories()).toContain('보훈')
  })
})
