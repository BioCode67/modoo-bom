import { describe, it, expect } from 'vitest'
import { recoveryPlan } from './recovery'
import type { Explanation } from './explainEligibility'

const EX = (over: Partial<Explanation>): Explanation => ({
  mode: 'precise', eligible: false, priority: 'low', confidence: 0, verdict: '',
  gates: [], matchedFacts: [], ceiling: 60, incomeOver: 20, fixableByIncome: false, blocker: 'income', ...over,
})

describe('recoveryPlan — 사유별 대응 경로', () => {
  it('소득 초과(near-miss)면 재신청 조건 + 정밀 계산 안내', () => {
    const plan = recoveryPlan(EX({ blocker: 'income', fixableByIncome: true, ceiling: 60 }))!
    expect(plan.steps[0].detail).toMatch(/소득인정액|하위 60%/)
    expect(plan.steps.some((s) => /계산기/.test(s.detail))).toBe(true)
    expect(plan.steps.some((s) => /차상위/.test(s.title))).toBe(true)
  })

  it('소득 초과(재산 원인)면 재산 공제 확인 안내', () => {
    const plan = recoveryPlan(EX({ blocker: 'income', fixableByIncome: false }))!
    expect(plan.steps.some((s) => /재산/.test(s.title))).toBe(true)
  })

  it('대상(인구통계) 불일치면 대체 복지·조건 변화 재신청', () => {
    const plan = recoveryPlan(EX({ blocker: 'demographic' }))!
    expect(plan.steps.some((s) => /비슷한|다른 복지/.test(s.title))).toBe(true)
    expect(plan.steps.some((s) => /재신청/.test(s.title))).toBe(true)
  })

  it('신규 접수 중단이면 알림·대체 복지', () => {
    const plan = recoveryPlan(EX({ blocker: 'intake' }))!
    expect(plan.steps.some((s) => /알림/.test(s.title))).toBe(true)
    expect(plan.steps.some((s) => /대체/.test(s.title))).toBe(true)
  })

  it('사유 불명(other)이면 주민센터 상담', () => {
    const plan = recoveryPlan(EX({ blocker: 'other' }))!
    expect(plan.steps.some((s) => /주민센터|상담/.test(s.title))).toBe(true)
  })

  it('모든 대응에 이의신청 권리(90일)를 조건부로 안내', () => {
    const plan = recoveryPlan(EX({ blocker: 'income' }))!
    expect(plan.appeal.detail).toMatch(/90일/)
    expect(plan.appeal.detail).toMatch(/반려/)
  })
})

describe('recoveryPlan — 대상 아님만 안내(과장 방지)', () => {
  it('적격이면 null', () => {
    expect(recoveryPlan(EX({ eligible: true, blocker: null }))).toBeNull()
  })
  it('요약/심사형(summary)이면 null', () => {
    expect(recoveryPlan(EX({ mode: 'summary' }))).toBeNull()
  })
  it('사유(blocker)가 없으면 null', () => {
    expect(recoveryPlan(EX({ blocker: null }))).toBeNull()
  })
})
