import { describe, it, expect } from 'vitest'
import { WELFARE_POLICIES } from '@/data/policies'
import { rankPolicies } from './priority'
import { docCoverage } from './docCoverage'
import { buildDocPlan } from './docPlan'
import { explainEligibility } from './explainEligibility'
import { buildPaymentSchedule } from './paymentSchedule'
import { docPortalGroups } from './docPortalGroups'
import type { UserProfile } from './welfare-engine'

/**
 * 신규 기능 실데이터 통합 — 합성 목이 아니라 실제 시드 정책(POL-) 전체에 돌려
 * 런타임 크래시·범위 이탈이 없는지 잠근다(합성 테스트가 놓치는 실데이터 형태 방어).
 */

const profile: UserProfile = {
  name: '', age: 70, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: 'retired',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('rankPolicies — 실제 시드 정책 전체', () => {
  const ranked = rankPolicies(WELFARE_POLICIES)
  it('전 항목을 크래시 없이 점수화하고 0~100 범위', () => {
    expect(ranked.length).toBe(WELFARE_POLICIES.length)
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      expect(r.factors.reduce((a, f) => a + f.score, 0)).toBe(r.score) // 항목 합 = 총점
    }
  })
  it('점수 내림차순 정렬 불변식', () => {
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
  })
})

describe('docCoverage — 실제 시드 정책 전체', () => {
  it('모든 정책에서 issuable + manual = total(불변식)', () => {
    for (const p of WELFARE_POLICIES) {
      const c = docCoverage(p)
      expect(c.issuable + c.manual).toBe(c.total)
      expect(c.ratio).toBeGreaterThanOrEqual(0)
      expect(c.ratio).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildDocPlan — 실제 정책 다건', () => {
  it('시드 상위 10건으로 플랜을 만들어도 크래시 없이 합계 정합', () => {
    const top = WELFARE_POLICIES.slice(0, 10)
    const map = Object.fromEntries(top.map((p) => [p.id, p]))
    const plan = buildDocPlan(top.map((p) => ({ policyId: p.id })), map, {}, Date.now())
    expect(plan.uniqueDocs).toBe(plan.needs.length)
    expect(plan.missingCount + plan.readyCount + plan.expiringCount + plan.expiredCount).toBe(plan.needs.length)
    // 발급처 묶음도 크래시 없이 계산
    expect(() => docPortalGroups(plan.needs.map((n) => n.name))).not.toThrow()
  })
})

describe('explainEligibility — 실제 POL 정책', () => {
  it('정밀(POL) 정책은 mode precise + 4게이트, 크래시 없음', () => {
    for (const p of WELFARE_POLICIES.slice(0, 30)) {
      const ex = explainEligibility(p, profile)
      expect(ex.mode).toBe('precise') // POL- 은 요약형 아님
      expect(ex.gates).toHaveLength(4)
      expect(['high', 'medium', 'low']).toContain(ex.priority)
    }
  })
})

describe('buildPaymentSchedule — 실제 정책', () => {
  const entries = buildPaymentSchedule(WELFARE_POLICIES, new Date(2026, 6, 10))
  it('매핑된 급여만 나오고, 날짜·D-day가 정상 범위', () => {
    for (const e of entries) {
      expect(e.dDay).toBeGreaterThanOrEqual(0)
      expect(e.dDay).toBeLessThanOrEqual(40)
      expect(e.nextDate.getDay()).not.toBe(0) // 주말 보정
      expect(e.nextDate.getDay()).not.toBe(6)
    }
  })
  it('기초연금이 시드에 있으면 지급일 엔트리에 포함', () => {
    if (WELFARE_POLICIES.some((p) => p.name === '기초연금')) {
      expect(entries.some((e) => e.policy.name === '기초연금')).toBe(true)
    }
  })
})
