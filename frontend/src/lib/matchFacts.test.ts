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

  it('household_type·children_ages가 undefined인 부분 프로필에도 크래시 없음(스키마 진화 방어)', () => {
    // localStorage에 예전 스키마로 저장됐다 필드가 빠진 프로필이 들어와도 .includes/.some가 터지지 않아야.
    const partial = { ...base, household_type: undefined, children_ages: undefined } as unknown as UserProfile
    expect(() => matchFacts(P({ name: '다문화 가족 지원', category: '가족', eligibility: '다문화 결혼이민' }), partial)).not.toThrow()
    const p2 = { ...partial, is_pregnant: true }
    expect(() => matchFacts(P({ name: '임신출산 지원', eligibility: '임산부 출산' }), p2)).not.toThrow()
  })
})
