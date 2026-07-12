import { describe, it, expect } from 'vitest'
import { runAnalysis, checkPolicy, type UserProfile } from '@/lib/welfare-engine'
import { WELFARE_POLICIES } from '@/data/policies'

const P = (o: Partial<UserProfile>): UserProfile => ({
  name: '', age: 40, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 50, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [], ...o,
})
const find = (id: string) => WELFARE_POLICIES.find((p) => p.id === id)!

describe('false-negative 수정 검증', () => {
  it('에너지바우처: 78세 독거 수급자(22%)에게 이제 노출(비임신인데 임산부 게이트로 탈락하던 것)', () => {
    const senior = P({ age: 78, income_percentile: 22, household_type: '노인가구' })
    const r = checkPolicy(find('POL-020'), senior)
    expect(r.eligible).toBe(true)
  })
  it('에너지바우처 정직성: 고소득 노인(수급 아님, 90%)에겐 노출 안 됨(false-positive 방지)', () => {
    const rich = P({ age: 78, income_percentile: 90, household_type: '노인가구' })
    expect(checkPolicy(find('POL-020'), rich).eligible).toBe(false)
  })
  it('에너지바우처 정직성: 취약구성원 없는 30세 단독 수급자(22%)엔 노출 안 됨', () => {
    const single = P({ age: 30, income_percentile: 22, household_type: '1인가구' })
    expect(checkPolicy(find('POL-020'), single).eligible).toBe(false)
  })
  it('긴급복지 생계지원: 질병 위기·재직·45%에게 이제 노출(실직 아니라 탈락하던 것)', () => {
    const crisis = P({ age: 47, income_percentile: 45, life_events: ['질병'] })
    expect(checkPolicy(find('POL-023'), crisis).eligible).toBe(true)
  })
  it('긴급복지 정직성: 위기 신호 없는 일반 저소득(45%)엔 실직 아니면 노출 안 됨', () => {
    const normal = P({ age: 47, income_percentile: 45, life_events: [] })
    expect(checkPolicy(find('POL-023'), normal).eligible).toBe(false)
  })
  it('긴급복지 정직성: 고소득 위기자(90%)엔 노출 안 됨', () => {
    const rich = P({ age: 47, income_percentile: 90, life_events: ['질병'] })
    expect(checkPolicy(find('POL-023'), rich).eligible).toBe(false)
  })
})
