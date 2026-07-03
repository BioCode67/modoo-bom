import { describe, it, expect, vi } from 'vitest'

// 지역 누수 회귀 — 지자체(LOC-) 정책이 사용자 시·도와 다르면 결과에 없어야 하고,
// LOC가 정밀(고신뢰) 분기로 새어 강력추천되면 안 된다(합성 카탈로그로 고정).
vi.mock('@/data/catalog', () => {
  const P = (id: string, name: string, region: string, elig: string) => ({
    id, name, category: '기타',
    target: `[${region}] ${elig}`, benefit: '', eligibility: elig,
    required_docs: [], application: '', department: '', renewal: '',
  })
  const ALL = [
    P('LOC-A', '하동군 어르신 지원', '경상남도 하동군', '만 65세 이상 어르신 지원'),
    P('LOC-B', '서울 어르신 지원', '서울특별시 강남구', '만 65세 이상 어르신 지원'),
    P('LOC-C', '제주 중증장애인 지원', '제주특별자치도', '중증장애인 대상 지원'),
  ]
  return { getCatalog: () => ALL, getPolicyMap: () => Object.fromEntries(ALL.map((p) => [p.id, p])) }
})

const { getEligiblePolicies } = await import('./welfare-engine')
const senior = { name: '', age: 70, gender: 'other' as const, region: '서울', household_type: '1인가구', income_percentile: 30, disability: false, disability_grade: '', employment_status: '', has_children: false, children_ages: [] as number[], is_pregnant: false, life_events: [] as string[] }

describe('지자체(LOC) 지역 게이트', () => {
  it('서울 사용자에게 타 지역(하동군·제주) LOC 정책이 안 나온다', () => {
    const r = getEligiblePolicies(senior)
    expect(r.some((p) => p.id === 'LOC-A')).toBe(false) // 하동군 — 제외
    expect(r.some((p) => p.id === 'LOC-C')).toBe(false) // 제주 — 제외
  })
  it('같은 지역(서울) LOC는 나오되 저신뢰 관련복지(정밀 고신뢰 아님)', () => {
    const r = getEligiblePolicies(senior)
    const b = r.find((p) => p.id === 'LOC-B')
    expect(b).toBeTruthy()
    expect(b!.confidence).toBeLessThan(0.8) // 정밀(0.9+)로 새면 안 됨
  })
})
