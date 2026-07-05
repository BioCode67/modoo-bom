import { describe, it, expect } from 'vitest'
import { FINANCIAL_POLICIES } from './financialPolicies'
import { getCatalog, getPolicyMap } from './catalog'
import { runAnalysis, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import { isCashBenefit } from '@/lib/format'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}
const fin = (list: EligiblePolicy[]) => list.filter((p) => p.id.startsWith('FIN-'))

describe('FINANCIAL_POLICIES — 정책서민금융(서민금융진흥원) 큐레이션', () => {
  it('FIN- 고유 id, 필수 필드, 서민금융 카테고리', () => {
    const ids = new Set<string>()
    for (const p of FINANCIAL_POLICIES) {
      expect(p.id).toMatch(/^FIN-\d{3}$/)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.name).toBeTruthy()
      expect(p.category).toBe('서민금융')
      expect(p.benefit).toBeTruthy()
      expect(p.department).toContain('서민금융진흥원')
    }
  })

  it('application에 살아있는 kinfa 공식 URL', () => {
    for (const p of FINANCIAL_POLICIES) {
      expect(p.application).toMatch(/https:\/\/(www\.)?(kinfa\.or\.kr|sloan\.kinfa\.or\.kr)/)
    }
  })

  it('전부 대출임을 명시 — 현금성 합산에서 제외(받는 돈으로 오인 금지)', () => {
    for (const p of FINANCIAL_POLICIES) {
      expect(p.benefit).toContain('대출')
      expect(p.benefit).toContain('상환') // 상환 의무 안내
      expect(isCashBenefit(p.benefit)).toBe(false) // '대출'은 현금성 지원이 아님
    }
  })

  it('⚠️ eligibility/target에 "하위 N%" 없음 — 신용기준을 소득상한으로 오해석하는 게이트 회피', () => {
    for (const p of FINANCIAL_POLICIES) {
      expect(`${p.eligibility} ${p.target}`).not.toMatch(/하위\s*\d{1,3}\s*%/)
    }
  })

  it('정직성: 어떤 프로필에서도 FIN은 high/precise로 과장되지 않음(저신뢰 관련 복지)', () => {
    const personas: UserProfile[] = [
      { ...base, age: 26, income_percentile: 30 },
      { ...base, age: 40, income_percentile: 45 },
      { ...base, age: 72, income_percentile: 25 },
    ]
    for (const prof of personas) {
      for (const x of fin(runAnalysis(prof).eligible_policies)) {
        expect(x.priority).toBe('low')
        expect(x.confidence).toBeLessThanOrEqual(0.68)
      }
    }
  })

  it('청년(26세)에게 햇살론유스가 관련 복지로 뜬다', () => {
    const list = fin(runAnalysis({ ...base, age: 26, income_percentile: 40 }).eligible_policies)
    expect(list.some((p) => p.id === 'FIN-002')).toBe(true)
  })

  it('저소득(중위 40%) 사용자에게 소액생계비대출이 관련 복지로 뜬다(신용 하위 20% 오게이트 없이)', () => {
    const list = fin(runAnalysis({ ...base, age: 45, income_percentile: 40 }).eligible_policies)
    expect(list.some((p) => p.id === 'FIN-001')).toBe(true)
  })

  it('고소득(중위 150%)에겐 서민금융 누수 없음', () => {
    const list = fin(runAnalysis({ ...base, age: 45, income_percentile: 150 }).eligible_policies)
    expect(list.length).toBe(0)
  })

  it('카탈로그·맵에 병합됨', () => {
    const map = getPolicyMap()
    const cat = new Set(getCatalog().map((p) => p.id))
    for (const p of FINANCIAL_POLICIES) {
      expect(map[p.id]).toBeTruthy()
      expect(cat.has(p.id)).toBe(true)
    }
  })
})
