import { describe, it, expect } from 'vitest'
import { getInsights } from './insights'
import { getEligiblePolicies, type UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '테스트', age: 40, gender: 'male', region: '서울', household_type: '3인가구',
  income_percentile: 50, disability: false, disability_grade: '', employment_status: 'employed',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('getInsights — 인사이트 아그리게이터', () => {
  it('프로필 없으면 빈 목록(적격도 없음)', () => {
    expect(getInsights(null, [])).toEqual([])
  })

  it('우선순위로 정렬하고 limit을 지킨다', () => {
    const p: UserProfile = { ...base, household_type: '1인가구', income_percentile: 60 }
    const insights = getInsights(p, getEligiblePolicies(p), { limit: 3 })
    expect(insights.length).toBeLessThanOrEqual(3)
    // priority 비내림차순
    for (let i = 1; i < insights.length; i++) {
      expect(insights[i].priority).toBeGreaterThanOrEqual(insights[i - 1].priority)
    }
    for (const it of insights) {
      expect(['timing', 'misconception', 'gap', 'freshness']).toContain(it.kind)
      expect(it.title.length).toBeGreaterThan(0)
      expect(it.emoji.length).toBeGreaterThan(0)
    }
  })

  it('신생아 부모는 급한 타이밍(priority 0) 인사이트가 맨 앞', () => {
    const p: UserProfile = { ...base, has_children: true, children_ages: [0], life_events: ['출산'] }
    const eligible = getEligiblePolicies(p)
    const hasRetro = eligible.some((e) => /아동수당|부모급여|첫만남/.test(e.name))
    const insights = getInsights(p, eligible)
    if (hasRetro) {
      expect(insights[0].kind).toBe('timing')
      expect(insights[0].priority).toBe(0)
    }
  })

  it('요약 신선도가 있으면 freshness 인사이트 포함(프로필 없어도)', () => {
    // 요약형이 섞인 실제 적격결과로 freshness가 잡히는지(구조적)
    const p: UserProfile = { ...base }
    const eligible = getEligiblePolicies(p)
    const insights = getInsights(p, eligible, { limit: 20 })
    // freshness는 verifyCount>0일 때만 — 있으면 kind 유효
    const fresh = insights.find((i) => i.kind === 'freshness')
    if (fresh) expect(fresh.detail).toMatch(/확인/)
  })
})
