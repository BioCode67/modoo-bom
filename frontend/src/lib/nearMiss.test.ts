import { describe, it, expect } from 'vitest'
import { getNearMisses } from './nearMiss'
import type { UserProfile } from './welfare-engine'

const E: UserProfile = { name: '', age: 30, gender: 'other', region: '', household_type: '', income_percentile: 80, disability: false, disability_grade: '', employment_status: '', has_children: false, children_ages: [], is_pregnant: false, life_events: [] }

describe('getNearMisses — 아깝게 놓친 복지(소득 근접)', () => {
  it('소득 45%는 의료급여(40%)를 아깝게 놓침(5%p)', () => {
    const r = getNearMisses({ ...E, age: 40, income_percentile: 45, household_type: '일반가구' })
    expect(r.some((x) => /의료급여/.test(x.policy.name))).toBe(true)
    expect(r[0].gap).toBeLessThanOrEqual(25)
  })
  it('가장 아까운(근접) 것부터 정렬', () => {
    const r = getNearMisses({ ...E, age: 40, income_percentile: 45, household_type: '일반가구' })
    for (let i = 1; i < r.length; i++) expect(r[i].gap).toBeGreaterThanOrEqual(r[i - 1].gap)
  })
  it('고소득(90%)은 저소득 정책을 놓쳤다고 과장하지 않음', () => {
    expect(getNearMisses({ ...E, age: 35, income_percentile: 90 }).length).toBe(0)
  })
  it('상한 초과폭이 크면(margin 밖) 제외', () => {
    // 소득 70%는 생계급여(32%)와 38%p 차이 → margin(25) 밖 → near-miss 아님
    const r = getNearMisses({ ...E, age: 40, income_percentile: 70 })
    expect(r.some((x) => /생계급여/.test(x.policy.name))).toBe(false)
  })
})
