import { describe, it, expect } from 'vitest'
import { medianIncome, incomePercentile, qualifyingBenefits, benefitCutoffs } from './medianIncome'

describe('medianIncome (2026 공식값)', () => {
  it('가구원수별 기준 중위소득 100%', () => {
    expect(medianIncome(1)).toBe(2_564_238)
    expect(medianIncome(4)).toBe(6_494_738)
    expect(medianIncome(6)).toBe(8_555_952)
  })
  it('7인 이상은 6인보다 큼(가산 근사)', () => {
    expect(medianIncome(7)).toBeGreaterThan(medianIncome(6))
  })
})

describe('incomePercentile / qualifyingBenefits', () => {
  it('1인 가구 월 80만원 → 약 31% → 생계급여(≤32%) 포함', () => {
    const pct = incomePercentile(1, 800_000)
    expect(pct).toBeLessThanOrEqual(32)
    expect(qualifyingBenefits(pct).some((b) => b.key === 'livelihood')).toBe(true)
  })
  it('4인 가구 월 600만원 → ~92% → 기초생활 급여 해당 없음', () => {
    const pct = incomePercentile(4, 6_000_000)
    expect(pct).toBeGreaterThan(50)
    expect(qualifyingBenefits(pct).length).toBe(0)
  })
  it('주거급여 경계: 1인 약 48%면 주거급여 포함', () => {
    expect(qualifyingBenefits(48).some((b) => b.key === 'housing')).toBe(true)
    expect(qualifyingBenefits(49).some((b) => b.key === 'housing')).toBe(false)
  })
})

describe('benefitCutoffs (가구별 급여 소득상한, 보건복지부 공식)', () => {
  it('4인 가구 생계급여 상한 = 2,078,316원 (중위 32%)', () => {
    const c = benefitCutoffs(4)
    expect(c.find((b) => b.key === 'livelihood')!.cutoff).toBe(2_078_316)
  })
  it('1인 가구 생계급여 상한 = 820,556원', () => {
    expect(benefitCutoffs(1).find((b) => b.key === 'livelihood')!.cutoff).toBe(820_556)
  })
  it('월 소득 주면 충족 여부(ok) 판정', () => {
    const c = benefitCutoffs(1, 800_000) // 생계급여 상한(820,556) 이하
    expect(c.find((b) => b.key === 'livelihood')!.ok).toBe(true)
    expect(c.find((b) => b.key === 'medical')!.ok).toBe(true) // 더 높은 상한도 당연히 충족
  })
  it('소득 미입력 시 ok는 null', () => {
    expect(benefitCutoffs(3).every((b) => b.ok === null)).toBe(true)
  })
})
