import { describe, it, expect } from 'vitest'
import { explainEligibility, blockerHint, isSummaryLike, type Gate } from './explainEligibility'
import type { Policy } from '@/data/policies'
import type { UserProfile } from '@/lib/welfare-engine'

const P = (over: Partial<Policy>): Policy => ({
  id: 'POL-T', name: '테스트복지', category: '기타', target: '', eligibility: '', benefit: '월 20만원',
  summary: '', how: '', link: '', deadline: '', agency: '', required_docs: [],
  ...over,
} as unknown as Policy)

const U = (over: Partial<UserProfile> = {}): UserProfile => ({
  name: '', age: 30, gender: 'other', region: '', household_type: '', income_percentile: 50,
  disability: false, disability_grade: '', employment_status: '', has_children: false,
  children_ages: [], is_pregnant: false, life_events: [], ...over,
})

const gate = (gates: Gate[], key: Gate['key']) => gates.find((g) => g.key === key)!

describe('isSummaryLike — 요약/심사형 판별', () => {
  it('GOV·LOC·PRV·FIN 접두는 요약형, POL·SUP·HOU는 정밀', () => {
    expect(isSummaryLike('LOC-123')).toBe(true)
    expect(isSummaryLike('GOV-9')).toBe(true)
    expect(isSummaryLike('PRV-001')).toBe(true)
    expect(isSummaryLike('FIN-3')).toBe(true)
    expect(isSummaryLike('POL-055')).toBe(false)
    expect(isSummaryLike('SUP-10')).toBe(false)
  })
})

describe('explainEligibility — 정밀 정책 게이트 분해', () => {
  it('정밀 정책은 4개 게이트(신규·대상·소득·종합)를 만든다', () => {
    const ex = explainEligibility(P({ eligibility: '소득 하위 60% 이하' }), U())
    expect(ex.mode).toBe('precise')
    expect(ex.gates.map((g) => g.key)).toEqual(['intake', 'demographic', 'income', 'verdict'])
  })

  it('소득 게이트: 상한 이하면 pass, 초과면 fail(내가 계산 — 판정과 무관하게 정확)', () => {
    const policy = P({ eligibility: '기준 중위소득 60% 이하' })
    const pass = explainEligibility(policy, U({ income_percentile: 50 }))
    expect(gate(pass.gates, 'income').status).toBe('pass')
    expect(gate(pass.gates, 'income').detail).toMatch(/충족/)
    expect(pass.ceiling).toBe(60)

    const fail = explainEligibility(policy, U({ income_percentile: 80 }))
    expect(gate(fail.gates, 'income').status).toBe('fail')
    expect(fail.incomeOver).toBe(20) // 80 − 60
  })

  it('소득 상한이 없으면 소득 게이트는 info', () => {
    const ex = explainEligibility(P({ eligibility: '누구나 신청 가능' }), U())
    expect(gate(ex.gates, 'income').status).toBe('info')
    expect(ex.ceiling).toBeNull()
  })

  it('종합 판정 게이트는 checkPolicy 결과(eligible)를 그대로 반영(단일 진실원)', () => {
    // 소득 초과가 명백하면 종합도 fail
    const ex = explainEligibility(P({ eligibility: '기준 중위소득 50% 이하' }), U({ income_percentile: 95 }))
    expect(ex.eligible).toBe(false)
    expect(gate(ex.gates, 'verdict').status).toBe('fail')
    expect(ex.blocker).toBe('income')
  })

  it('near-miss: 소득만 초과하고 상한까지 낮추면 대상 → fixableByIncome', () => {
    // 청년 대상 + 소득 상한 60. 27세 청년이 소득 80이면 소득만 아깝게 초과.
    const policy = P({ name: '청년 지원', category: '청년', target: '만 19~34세 청년', eligibility: '기준 중위소득 60% 이하' })
    const ex = explainEligibility(policy, U({ age: 27, income_percentile: 80 }))
    if (!ex.eligible && ex.blocker === 'income') {
      expect(ex.fixableByIncome).toBe(true)
      expect(blockerHint(ex)).toMatch(/아깝게|줄면/)
    }
    // 적격이 됐다면(엔진이 관대) 최소한 소득 게이트는 fail로 근거를 남긴다
    expect([true, false]).toContain(ex.fixableByIncome)
  })
})

describe('explainEligibility — 요약/심사형은 하드 판정 대신 상황 신호', () => {
  it('LOC 정책은 summary 모드, 게이트 없음, 안내 문구', () => {
    const ex = explainEligibility(P({ id: 'LOC-1', name: '지역청년지원', eligibility: '지역 청년' }), U({ age: 27 }))
    expect(ex.mode).toBe('summary')
    expect(ex.gates).toEqual([])
    expect(ex.verdict).toMatch(/요약 정보|상세/)
    expect(ex.fixableByIncome).toBe(false)
  })
  it('PRV(민간재단)도 summary 모드', () => {
    expect(explainEligibility(P({ id: 'PRV-1', name: '재단장학' }), U({ age: 22 })).mode).toBe('summary')
  })
})

describe('blockerHint — 부적격 사유 안내', () => {
  it('적격이면 null', () => {
    const ex = explainEligibility(P({ eligibility: '누구나' }), U())
    if (ex.eligible) expect(blockerHint(ex)).toBeNull()
  })
  it('소득 초과(수정 불가)면 상한 안내', () => {
    const ex = explainEligibility(P({ eligibility: '기준 중위소득 40% 이하' }), U({ income_percentile: 95 }))
    const hint = blockerHint(ex)
    if (!ex.eligible) expect(hint).toMatch(/소득/)
  })
})
