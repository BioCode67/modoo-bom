import { describe, it, expect } from 'vitest'
import {
  extractKeywords, getEligiblePolicies, searchPolicies,
  estimateBenefits, runAnalysis, type UserProfile,
} from './welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}
const senior: UserProfile = { ...base, age: 72, income_percentile: 25 }
const youth: UserProfile = { ...base, age: 26, employment_status: 'unemployed', income_percentile: 55, life_events: ['실직'] }
const newborn: UserProfile = { ...base, age: 32, has_children: true, children_ages: [0], life_events: ['출산'] }
const disabled: UserProfile = { ...base, age: 45, disability: true, disability_grade: '1급', income_percentile: 35 }

describe('extractKeywords', () => {
  it('노인 프로필 → 기초연금 키워드', () => {
    expect(extractKeywords(senior).keywords).toContain('기초연금')
  })
  it('청년 미취업 → 실업급여/취업 키워드', () => {
    const kw = extractKeywords(youth).keywords.join(' ')
    expect(kw).toMatch(/실업급여|취업|청년/)
  })
})

describe('getEligiblePolicies', () => {
  it('72세 저소득 → 기초연금(POL-001) 포함, 우선순위 high', () => {
    const list = getEligiblePolicies(senior)
    const gp = list.find((p) => p.id === 'POL-001')
    expect(gp).toBeTruthy()
    expect(gp?.priority).toBe('high')
    expect(gp?.confidence).toBeGreaterThan(0.8)
  })
  it('만 0세 자녀 → 아동수당(POL-004) 포함', () => {
    expect(getEligiblePolicies(newborn).some((p) => p.id === 'POL-004')).toBe(true)
  })
  it('만 8세 자녀도 아동수당(POL-004) 포함 (2026년 9세 미만 확대)', () => {
    const child8: UserProfile = { ...base, age: 38, has_children: true, children_ages: [8] }
    expect(getEligiblePolicies(child8).some((p) => p.id === 'POL-004')).toBe(true)
  })
  it('중증장애인 → 장애인연금(POL-003) 포함', () => {
    expect(getEligiblePolicies(disabled).some((p) => p.id === 'POL-003')).toBe(true)
  })
  it('우선순위 정렬: high가 low보다 앞', () => {
    const list = getEligiblePolicies(senior)
    const firstLow = list.findIndex((p) => p.priority === 'low')
    const lastHigh = list.map((p) => p.priority).lastIndexOf('high')
    if (firstLow !== -1 && lastHigh !== -1) expect(lastHigh).toBeLessThan(firstLow)
  })
  it('연령 미달이면 노인 정책 제외(35세는 기초연금 아님)', () => {
    expect(getEligiblePolicies({ ...base, age: 35 }).some((p) => p.id === 'POL-001')).toBe(false)
  })
})

describe('searchPolicies', () => {
  it('키워드 "청년" 검색 결과 존재 + 카테고리/이름 매칭', () => {
    const res = searchPolicies('청년')
    expect(res.length).toBeGreaterThan(0)
    expect(res.some((p) => (p.name + p.category + p.target).includes('청년'))).toBe(true)
  })
  it('limit 옵션 적용', () => {
    expect(searchPolicies('지원', { limit: 3 }).length).toBeLessThanOrEqual(3)
  })
})

describe('estimateBenefits / runAnalysis', () => {
  it('노인 추정 결과 1건 이상', () => {
    expect(estimateBenefits(senior).eligible_count).toBeGreaterThan(0)
  })
  it('runAnalysis 결과 형태 + 월 합계 추정', () => {
    const r = runAnalysis(senior)
    expect(r.eligible_policies.length).toBeGreaterThan(0)
    expect(r.application_guides.length).toBeGreaterThan(0)
    expect(Array.isArray(r.required_docs)).toBe(true)
    expect(r.portfolio_summary.total_policies).toBe(r.eligible_policies.length)
    expect((r.portfolio_summary.total_monthly ?? 0)).toBeGreaterThan(0)
  })
  it('출산 프로필 → 출산 관련 알림 생성', () => {
    expect(runAnalysis(newborn).notifications.length).toBeGreaterThan(0)
  })
})
