import { describe, it, expect } from 'vitest'
import { benefitCeilings, nearestCeiling, type CeilingInput } from './benefitCeiling'
import { medianIncome } from './medianIncome'
import type { PropertyInput, RecognitionOptions } from './incomeRecognition'

const prop = (o: Partial<PropertyInput> = {}): PropertyInput => ({ residential: 0, general: 0, financial: 0, car: 0, ...o })
const opt = (o: Partial<RecognitionOptions> = {}): RecognitionOptions => ({ basicProperty: 0, debt: 0, carExempt: false, ...o })
const input = (o: Partial<CeilingInput> = {}): CeilingInput => ({
  size: 1, currentTotal: 0, property: prop(), opts: opt(), other: 0, careExpense: 0, ...o,
})
const row = (rows: ReturnType<typeof benefitCeilings>, key: string) => rows.find((r) => r.key === key)!

describe('benefitCeilings — 급여별 허용 최대 근로소득(역산)', () => {
  it('1인·재산 없음: 생계 32%면 근로소득 월 1,172,222원 이하', () => {
    const rows = benefitCeilings(input({ size: 1 }))
    const living = row(rows, 'livelihood')
    expect(living.maxRecognition).toBe(Math.floor(medianIncome(1) * 0.32)) // 820,556
    expect(living.maxIncomeEval).toBe(820_556)
    expect(living.maxEarned).toBe(1_172_222) // floor(820,556 / 0.7)
  })

  it('1인·재산 없음: 의료 40% 상한 근로소득', () => {
    const medical = row(benefitCeilings(input({ size: 1 })), 'medical')
    expect(medical.maxRecognition).toBe(1_025_695)
    expect(medical.maxEarned).toBe(Math.floor(1_025_695 / 0.7)) // 1,465,278
  })

  it('재산환산이 상한을 갉아먹는다: 4인·금융 2천만(환산 1,252,000) → 교육 50% 근로 상한 하락', () => {
    const rows = benefitCeilings(input({ size: 4, property: prop({ financial: 20_000_000 }) }))
    const edu = row(rows, 'education')
    // maxRecognition = floor(6,494,738*0.5)=3,247,369 · 재산환산 1,252,000 차감 → 소득평가액 한도 1,995,369
    expect(edu.maxRecognition).toBe(3_247_369)
    expect(edu.maxIncomeEval).toBe(1_995_369)
    expect(edu.maxEarned).toBe(Math.floor(1_995_369 / 0.7)) // 2,850,527
  })

  it('재산환산만으로 상한 초과 → 소득과 무관하게 불가(maxEarned=null)', () => {
    // 1인 생계 상한 820,556 < 금융 6천만 환산(3,756,000)
    const rows = benefitCeilings(input({ size: 1, property: prop({ financial: 60_000_000 }) }))
    expect(row(rows, 'livelihood').maxEarned).toBeNull()
  })

  it('그 밖의 소득만으로 초과해도 근로소득 0으로 못 맞춤 → null', () => {
    const rows = benefitCeilings(input({ size: 1, other: 2_000_000 }))
    expect(rows.every((r) => r.maxEarned === null)).toBe(true)
  })

  it('그 밖의 소득이 일부 차지하면 근로 상한이 줄어든다', () => {
    const rows = benefitCeilings(input({ size: 1, other: 1_000_000 }))
    // 의료 40% 상한 1,025,695 − 기타소득 1,000,000 = 25,695 → /0.7
    expect(row(rows, 'medical').maxEarned).toBe(Math.floor(25_695 / 0.7)) // 36,707
    // 생계 32%(820,556)는 기타소득 100만이 이미 초과 → null
    expect(row(rows, 'livelihood').maxEarned).toBeNull()
  })

  it('가구특성 지출은 근로 상한을 늘린다(순소득 차감)', () => {
    const rows = benefitCeilings(input({ size: 1, careExpense: 500_000 }))
    // netOther = 0 − 500,000 = −500,000 → (820,556 + 500,000)/0.7
    expect(row(rows, 'livelihood').maxEarned).toBe(Math.floor(1_320_556 / 0.7)) // 1,886,508
  })

  it('eligibleNow·headroom: 현재 소득인정액 기준 자격/여유', () => {
    const rows = benefitCeilings(input({ size: 1, currentTotal: 900_000 }))
    expect(row(rows, 'livelihood').eligibleNow).toBe(false) // 900,000 > 820,556
    expect(row(rows, 'livelihood').headroom).toBe(820_556 - 900_000) // 음수
    expect(row(rows, 'medical').eligibleNow).toBe(true) // 900,000 ≤ 1,025,695
    expect(row(rows, 'medical').headroom).toBe(1_025_695 - 900_000)
  })
})

describe('nearestCeiling — 가장 빨리 벗어나는 경계', () => {
  it('자격 급여 중 여유(headroom)가 가장 작은 급여를 고른다', () => {
    const rows = benefitCeilings(input({ size: 1, currentTotal: 800_000 }))
    const near = nearestCeiling(rows)
    expect(near?.key).toBe('livelihood') // 생계 여유 20,556이 가장 작음
    expect(near?.headroom).toBe(820_556 - 800_000)
  })
  it('자격 급여가 없으면 null', () => {
    // 소득인정액이 매우 높아 모든 급여 상한 초과
    const rows = benefitCeilings(input({ size: 1, currentTotal: 9_000_000 }))
    expect(nearestCeiling(rows)).toBeNull()
  })
})
