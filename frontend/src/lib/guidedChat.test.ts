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
  it('감사 회귀: 장애 선택만으로 중증(1급) 단정 안 함 — 장애인연금 과장 방지', () => {
    const p = buildProfile({ age: 50, situations: ['disability'], income: 30 })
    expect(p.disability).toBe(true)
    expect(p.disability_grade).toBe('') // 미상 — 중증 전용 급여 과장 안 함
    // 중증 전용 장애인연금(POL-003)이 자격 목록에 안 뜸(경증 사용자 과장 방지)
    const r = recommend({ age: 50, situations: ['disability'], income: 30 })
    expect(r.policies.some((x) => x.id === 'POL-003')).toBe(false)
    expect(r.text).toContain('중증') // 대신 정직한 안내
  })
  it('감사 회귀: 자녀 나이 가정을 사용자에게 고지', () => {
    const r = recommend({ age: 40, situations: ['children'], income: 30 })
    expect(r.text).toContain('만 5세로 가정')
  })
})

describe('14차 감사 회귀 — 소득 미답 시 income_known=false(하드배제 방지)', () => {
  it('소득을 답하지 않으면 income_known=false — 저소득 급여 조건부 노출 경로', async () => {
    const { buildProfile } = await import('./guidedChat')
    const p = buildProfile({ situations: [] })
    expect(p.income_percentile).toBe(80)
    expect(p.income_known).toBe(false)
    // 소득을 답하면 known=true
    expect(buildProfile({ situations: [], income: 40 }).income_known).toBe(true)
  })
})
