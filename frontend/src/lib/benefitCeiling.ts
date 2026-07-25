import { medianIncome, BENEFIT_THRESHOLDS } from '@/lib/medianIncome'
import { EARNED_DEDUCTION_RATE, propertyConversion, type PropertyInput, type RecognitionOptions } from '@/lib/incomeRecognition'

/**
 * '얼마까지 벌어도 자격이 되나' — 소득인정액 정계산의 역산.
 *
 * 사용자가 가장 많이 묻는 질문: "생계급여(또는 차상위)를 받으려면 월 소득이 얼마 이하여야 하나요?"
 * 재산은 그대로 두고, 각 급여 기준(생계 32·의료 40·주거 48·교육/차상위 50%)을 만족하는
 * '허용 최대 근로·사업소득'을 급여별로 계산한다.
 *
 *   소득인정액 = 소득평가액 + 재산의 소득환산액 ≤ (기준 중위소득 × 급여%)
 *   소득평가액 = 근로·사업소득×(1−0.3) + 그 밖의 소득 − 가구특성 지출
 *   ⇒ 허용 근로소득 = (급여상한 − 재산환산 − (그밖소득 − 지출)) / 0.7
 *
 * 정직성: 소득인정액 계산과 같은 공식·상한을 쓰고, 재산환산만으로 이미 초과하면
 * '소득과 무관하게 재산 초과'로 정직하게 표시(maxEarned=null). 결과는 추정이며 확정은 심사.
 */

export interface CeilingRow {
  key: string
  label: string
  emoji: string
  pct: number
  maxRecognition: number      // 이 급여 상한 소득인정액(월)
  maxIncomeEval: number       // 재산환산 제외 후 남는 소득평가액 한도(≥0)
  maxEarned: number | null    // 허용 최대 근로·사업소득(월). null = 재산만으로 초과(소득 0도 불가)
  eligibleNow: boolean        // 현재 소득인정액 기준 자격 여부
  headroom: number            // 상한까지 남은 소득인정액(양수=여유, 음수=초과)
}

export interface CeilingInput {
  size: number                // 가구원수
  currentTotal: number        // 현재 소득인정액(computeRecognition().total)
  property: PropertyInput
  opts: RecognitionOptions
  other: number               // 그 밖의 소득(월)
  careExpense: number         // 가구특성 지출(월)
}

/** 급여별 허용 최대 근로소득 계산(역산) */
export function benefitCeilings(input: CeilingInput): CeilingRow[] {
  const { size, currentTotal, property, opts, other, careExpense } = input
  const pc = propertyConversion(property, opts).total
  const median = medianIncome(size)
  const netOther = other - careExpense // 근로소득 외 소득평가 요소(음수면 지출이 더 큼 → 여유↑)
  const ded = 1 - EARNED_DEDUCTION_RATE

  return BENEFIT_THRESHOLDS.map((b) => {
    const maxRecognition = Math.floor((median * b.pct) / 100)
    const rawIncomeEval = maxRecognition - pc // 소득평가액 한도(음수 가능)
    let maxEarned: number | null
    if (rawIncomeEval < 0 || netOther > rawIncomeEval) {
      // 재산환산만으로 초과했거나, 근로소득이 0이어도 그 밖의 소득만으로 초과
      maxEarned = null
    } else {
      maxEarned = Math.max(0, Math.floor((rawIncomeEval - netOther) / ded))
    }
    return {
      key: b.key, label: b.label, emoji: b.emoji, pct: b.pct,
      maxRecognition,
      maxIncomeEval: Math.max(0, rawIncomeEval),
      maxEarned,
      eligibleNow: currentTotal <= maxRecognition,
      headroom: maxRecognition - currentTotal,
    }
  })
}

/** 현재 자격이 되는 가장 관대한(=%가 큰) 급여의 상한까지 남은 여유 — '조금만 더 벌어도 넘는' 경계 안내용 */
export function nearestCeiling(rows: CeilingRow[]): CeilingRow | null {
  // 자격이 되는 것들 중 headroom(여유)이 가장 작은 = 가장 빨리 벗어나는 경계
  const eligible = rows.filter((r) => r.eligibleNow)
  if (eligible.length === 0) return null
  return eligible.reduce((min, r) => (r.headroom < min.headroom ? r : min))
}
