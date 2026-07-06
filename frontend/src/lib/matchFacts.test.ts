import { describe, it, expect } from 'vitest'
import { matchFacts, type UserProfile } from './welfare-engine'
import type { Policy } from '@/data/policies'

const base: UserProfile = {
  name: '', age: 0, gender: 'other', region: '', household_type: '', income_percentile: 0,
  disability: false, disability_grade: '', employment_status: '', has_children: false,
  children_ages: [], is_pregnant: false, life_events: [],
}
const P = (over: Partial<Policy>): Policy => ({
  id: 'X', name: '', category: '', target: '', benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '', ...over,
})

describe('matchFacts', () => {
  it('노인+소득 정책에 어르신·소득 사실을 실제 값과 함께 반환', () => {
    const p = { ...base, age: 73, income_percentile: 15 }
    const facts = matchFacts(P({ name: '기초연금', category: '노인', eligibility: '만 65세 이상 소득 하위 70%' }), p)
    expect(facts.some((f) => f.includes('73세') && f.includes('어르신'))).toBe(true)
    expect(facts.some((f) => f.includes('하위 15%'))).toBe(true)
  })

  it('무관한 정책에는 빈 배열(과장 없음)', () => {
    const p = { ...base, age: 73, income_percentile: 15 }
    const facts = matchFacts(P({ name: '청년 월세 지원', category: '청년', eligibility: '만 19~34세 청년' }), p)
    expect(facts).toHaveLength(0)
  })

  it('장애·자녀 사실 매칭', () => {
    const p = { ...base, age: 40, disability: true, has_children: true, children_ages: [5] }
    const facts = matchFacts(P({ name: '장애아동 양육 지원', category: '장애인', eligibility: '등록 장애인 자녀 양육' }), p)
    expect(facts.some((f) => f.includes('장애'))).toBe(true)
  })

  it('프로필이 비어있으면 사실 없음', () => {
    expect(matchFacts(P({ name: '기초연금', eligibility: '노인 소득' }), base)).toHaveLength(0)
  })
})
