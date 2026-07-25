import { describe, it, expect } from 'vitest'
import {
  parseAmount, incomeEvaluation, propertyConversion, computeRecognition,
  recognitionPercentile, judgeBenefits, BASIC_PROPERTY, CONVERSION_RATE, REGION_LABEL,
  type IncomeInput, type PropertyInput, type RecognitionOptions,
} from './incomeRecognition'
import { benefitCutoffs } from './medianIncome'
import { benefitCeilings } from './benefitCeiling'
import { diffScenarios } from './scenarioDiff'

const inc = (o: Partial<IncomeInput> = {}): IncomeInput => ({ earned: 0, other: 0, careExpense: 0, ...o })
const prop = (o: Partial<PropertyInput> = {}): PropertyInput => ({ residential: 0, general: 0, financial: 0, car: 0, ...o })
const opt = (o: Partial<RecognitionOptions> = {}): RecognitionOptions => ({ basicProperty: 0, debt: 0, carExempt: false, ...o })

describe('parseAmount — 금액 문자열 파싱', () => {
  it('콤마·단위·비숫자를 제거하고 정수로', () => {
    expect(parseAmount('1,200,000')).toBe(1200000)
    expect(parseAmount('1200000원')).toBe(1200000)
    expect(parseAmount('  850,000 ')).toBe(850000)
  })
  it('빈값·문자·음수는 0', () => {
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount(-500)).toBe(0)
    expect(parseAmount(NaN)).toBe(0)
  })
})

describe('incomeEvaluation — 소득평가액', () => {
  it('근로·사업소득은 30% 공제(70% 반영)', () => {
    expect(incomeEvaluation(inc({ earned: 1_000_000 }))).toBe(700_000)
    expect(incomeEvaluation(inc({ earned: 2_000_000 }))).toBe(1_400_000)
  })
  it('그 밖의 소득은 공제 없이 전액', () => {
    expect(incomeEvaluation(inc({ earned: 1_000_000, other: 300_000 }))).toBe(1_000_000)
  })
  it('가구특성 지출은 차감하되 하한 0', () => {
    expect(incomeEvaluation(inc({ earned: 1_000_000, careExpense: 200_000 }))).toBe(500_000)
    expect(incomeEvaluation(inc({ earned: 1_000_000, careExpense: 900_000 }))).toBe(0) // 음수 방지
  })
})

describe('propertyConversion — 재산의 소득환산액', () => {
  it('환산율은 종류별 공식값(주거 1.04·일반 4.17·금융 6.26·자동차 100%)', () => {
    expect(CONVERSION_RATE.residential).toBe(0.0104)
    expect(CONVERSION_RATE.general).toBe(0.0417)
    expect(CONVERSION_RATE.financial).toBe(0.0626)
    expect(CONVERSION_RATE.car).toBe(1.0)
  })

  it('기본재산액을 주거→일반→금융 순으로 차감', () => {
    // res 30M, gen 40M, fin 10M, 기본재산액 50M → res 0, gen 20M, fin 10M
    const r = propertyConversion(prop({ residential: 30_000_000, general: 40_000_000, financial: 10_000_000 }), opt({ basicProperty: 50_000_000 }))
    expect(r.afterDeduction).toEqual({ residential: 0, general: 20_000_000, financial: 10_000_000 })
    expect(r.general).toBe(Math.round(20_000_000 * 0.0417)) // 834,000
    expect(r.financial).toBe(Math.round(10_000_000 * 0.0626)) // 626,000
    expect(r.total).toBe(834_000 + 626_000)
  })

  it('부채는 기본재산액 차감 후 다시 주거→일반→금융 순으로 차감', () => {
    const r = propertyConversion(prop({ residential: 100_000_000 }), opt({ basicProperty: 50_000_000, debt: 30_000_000 }))
    expect(r.afterDeduction.residential).toBe(20_000_000) // 100M − 50M − 30M
    expect(r.residential).toBe(Math.round(20_000_000 * 0.0104)) // 208,000
  })

  it('자동차는 원칙적으로 100% 환산, 예외 차량은 제외', () => {
    expect(propertyConversion(prop({ car: 5_000_000 }), opt()).car).toBe(5_000_000)
    expect(propertyConversion(prop({ car: 5_000_000 }), opt({ carExempt: true })).car).toBe(0)
  })

  it('자동차엔 기본재산액·부채 공제가 적용되지 않는다', () => {
    // 기본재산액이 커도 자동차는 그대로 100% (주거·일반·금융에서만 차감)
    const r = propertyConversion(prop({ car: 3_000_000 }), opt({ basicProperty: 99_000_000 }))
    expect(r.car).toBe(3_000_000)
  })
})

describe('computeRecognition — 소득인정액 종합(손계산 검증)', () => {
  it('4인 대도시 워크스루: 근로 200만 + 주거 1.5억 + 금융 2천만 = 소득인정액 3,182,400', () => {
    const r = computeRecognition(
      inc({ earned: 2_000_000 }),
      prop({ residential: 150_000_000, financial: 20_000_000 }),
      opt({ basicProperty: BASIC_PROPERTY.metro }), // 99,000,000
    )
    expect(r.incomeEval).toBe(1_400_000)
    // 주거: (150M−99M)=51M ×1.04% = 530,400 · 금융: 20M ×6.26% = 1,252,000
    expect(r.byType.residential).toBe(530_400)
    expect(r.byType.financial).toBe(1_252_000)
    expect(r.propertyConversion).toBe(1_782_400)
    expect(r.total).toBe(3_182_400)
  })

  it('재산·소득 0이면 소득인정액 0', () => {
    const r = computeRecognition(inc(), prop(), opt())
    expect(r.total).toBe(0)
  })
})

describe('recognitionPercentile · judgeBenefits — 급여 판정', () => {
  it('소득인정액 3,182,400 / 4인 → 약 49% (median 6,494,738)', () => {
    expect(recognitionPercentile(3_182_400, 4)).toBe(49)
  })
  it('49%면 교육급여·차상위(≤50)는 되고 주거급여(≤48)는 안 됨', () => {
    const keys = judgeBenefits(3_182_400, 4).map((b) => b.key)
    expect(keys).toContain('education')
    expect(keys).toContain('nearpoor')
    expect(keys).not.toContain('housing')
    expect(keys).not.toContain('livelihood')
  })
  it('소득인정액이 매우 낮으면 생계급여까지 전부 해당', () => {
    const keys = judgeBenefits(500_000, 4).map((b) => b.key)
    expect(keys).toContain('livelihood') // ≤32%
  })
})

describe('judgeBenefits — 원 단위 경계 판정(반올림 오판 회귀)', () => {
  // 회귀(MONEY-01): 예전엔 정수 %로 반올림한 뒤 비교해, 선정기준액(원)을 최대 약 4.8만원(7인)
  // 초과한 소득도 '해당 가능'으로 오판했다(같은 화면의 benefitCeilings.eligibleNow와 모순).
  // 판정은 benefitCutoffs의 선정기준액(원)과 원 단위로 직접 비교해야 한다. %는 표시용.
  const cutoffOf = (size: number, key: string) => benefitCutoffs(size).find((b) => b.key === key)!.cutoff

  it('1인 830,000원(생계 기준 820,556원 초과)은 생계급여 미해당 — 결함 시나리오 그대로', () => {
    expect(cutoffOf(1, 'livelihood')).toBe(820_556)
    expect(recognitionPercentile(830_000, 1)).toBe(32) // 반올림 %는 32로 보여도
    const keys = judgeBenefits(830_000, 1).map((b) => b.key)
    expect(keys).not.toContain('livelihood') // 판정은 원 단위 → 미해당
    expect(keys).toContain('medical') // 의료급여(40%) 기준 이하는 그대로 해당(비회귀)
  })

  it('경계: 정확히 선정기준액은 해당, +1원은 미해당', () => {
    const c = cutoffOf(1, 'livelihood')
    expect(judgeBenefits(c, 1).map((b) => b.key)).toContain('livelihood')
    expect(judgeBenefits(c + 1, 1).map((b) => b.key)).not.toContain('livelihood')
  })

  it('7인 3,090,000원(기준 초과)도 생계급여 미해당 — 가구가 클수록 벌어지던 오표시 창', () => {
    expect(3_090_000).toBeGreaterThan(cutoffOf(7, 'livelihood'))
    expect(judgeBenefits(3_090_000, 7).map((b) => b.key)).not.toContain('livelihood')
  })

  it('같은 입력에서 benefitCeilings.eligibleNow(원 단위)와 판정이 일치 — 한 화면 모순 제거', () => {
    const total = 830_000
    const liv = benefitCeilings({
      size: 1, currentTotal: total,
      property: prop(), opts: opt(), other: 0, careExpense: 0,
    }).find((r) => r.key === 'livelihood')!
    expect(liv.eligibleNow).toBe(false)
    expect(judgeBenefits(total, 1).map((b) => b.key)).not.toContain('livelihood')
  })

  it('시나리오 비교: 실제 상한을 넘는 소득 변화(820,000→833,000)는 생계급여 잃음으로 보고', () => {
    const d = diffScenarios({ total: 820_000, size: 1 }, { total: 833_000, size: 1 })
    expect(d.lost.map((x) => x.key)).toContain('livelihood')
    expect(d.unchanged).toBe(false)
  })

  it('반환 행은 칩 표시에 쓰는 label·emoji·pct 필드를 유지(비회귀)', () => {
    const rows = judgeBenefits(500_000, 1)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(typeof r.label).toBe('string')
      expect(typeof r.emoji).toBe('string')
      expect(typeof r.pct).toBe('number')
    }
  })
})

describe('BASIC_PROPERTY · REGION_LABEL — 지역 프리셋', () => {
  it('세 지역 프리셋과 라벨이 존재', () => {
    expect(BASIC_PROPERTY.metro).toBeGreaterThan(BASIC_PROPERTY.city)
    expect(BASIC_PROPERTY.city).toBeGreaterThan(BASIC_PROPERTY.rural)
    expect(REGION_LABEL.metro).toBe('대도시')
    expect(REGION_LABEL.rural).toBe('농어촌')
  })
})
