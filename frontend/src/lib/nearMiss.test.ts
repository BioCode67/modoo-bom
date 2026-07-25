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
    // (2026-07-25 엔진 감사 ENG-2 반영) 기존 기대값 '0건'은 엔진이 평생교육바우처(명시 상한 중위 65%)를
    //   '차상위 포함' 문구 탓에 50%로 오게이트하던 결함에 의존한 값이었다. 상한 65%가 바로잡히면서
    //   90%에겐 gap 25(= margin 경계, 위 '≤25%p' 규칙 그대로)인 정당한 near-miss가 된다.
    //   테스트 의도(기초생활 급여류를 '아깝게 놓쳤다'고 과장 금지)는 그대로 고정한다.
    const r = getNearMisses({ ...E, age: 35, income_percentile: 90 })
    expect(r.every((x) => x.gap > 0 && x.gap <= 25)).toBe(true)
    expect(r.some((x) => /생계급여|의료급여|주거급여|차상위|기초생활/.test(x.policy.name))).toBe(false)
    expect(r.some((x) => x.policy.id === 'POL-123')).toBe(true) // 상한 65% 정책만 경계에 정당히 남음
  })
  it('상한 초과폭이 크면(margin 밖) 제외', () => {
    // 소득 70%는 생계급여(32%)와 38%p 차이 → margin(25) 밖 → near-miss 아님
    const r = getNearMisses({ ...E, age: 40, income_percentile: 70 })
    expect(r.some((x) => /생계급여/.test(x.policy.name))).toBe(false)
  })
})
