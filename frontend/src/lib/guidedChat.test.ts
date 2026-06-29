import { describe, it, expect } from 'vitest'
import { buildProfile, recommend, GUIDE_STEPS } from './guidedChat'

describe('buildProfile', () => {
  it('상황 선택 → 프로필 필드 매핑', () => {
    const p = buildProfile({ age: 70, situations: ['singleparent', 'disability'], income: 25 })
    expect(p.age).toBe(70)
    expect(p.household_type).toBe('한부모가족')
    expect(p.disability).toBe(true)
    expect(p.income_percentile).toBe(25)
    expect(p.life_events).toContain('장애진단')
  })
  it('자녀 상황 → has_children + children_ages', () => {
    const p = buildProfile({ situations: ['children'] })
    expect(p.has_children).toBe(true)
    expect(p.children_ages.length).toBeGreaterThan(0)
  })
  it('출산/실직 → life_events 누적', () => {
    const p = buildProfile({ situations: ['birth', 'unemployed'] })
    expect(p.is_pregnant).toBe(true)
    expect(p.employment_status).toBe('unemployed')
    expect(p.life_events).toEqual(expect.arrayContaining(['출산', '실직']))
  })
  it('미입력 기본값 안전(age 30, income 80)', () => {
    const p = buildProfile({ situations: [] })
    expect(p.age).toBe(30)
    expect(p.income_percentile).toBe(80)
  })
})

describe('recommend', () => {
  it('노인 저소득 → 추천 정책 + 안내 텍스트', () => {
    const r = recommend({ age: 72, situations: [], income: 25 })
    expect(r.policies.length).toBeGreaterThan(0)
    expect(r.text).toContain('찾았어요')
  })
  it('GUIDE_STEPS 3단계(age·situations·income)', () => {
    expect(GUIDE_STEPS.length).toBe(3)
    expect(GUIDE_STEPS.map((s) => s.id)).toEqual(['age', 'situations', 'income'])
  })
})
