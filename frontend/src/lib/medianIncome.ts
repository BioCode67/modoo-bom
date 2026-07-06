// 2026년 기준 중위소득 100% (월, 원) — 보건복지부 고시 출처. 1~7인 공식 확정값.
// 8인 이상은 공식 가산액(959,198원/인)으로 산정.
const MEDIAN_2026: Record<number, number> = {
  1: 2_564_238,
  2: 4_199_292,
  3: 5_359_036,
  4: 6_494_738,
  5: 7_556_719,
  6: 8_555_952,
  7: 9_515_150,
}
const ADD_PER_PERSON = 959_198 // 8인+ 공식 1인 가산액(= 7인 9,515,150 - 6인 8,555,952)

export const MEDIAN_YEAR = 2026

/** 가구원수별 기준 중위소득 100% (월). 7인 이상은 근사. */
export function medianIncome(size: number): number {
  const n = Math.max(1, Math.min(size, 12))
  if (MEDIAN_2026[n]) return MEDIAN_2026[n]
  return MEDIAN_2026[6] + ADD_PER_PERSON * (n - 6)
}
export function isApprox(size: number): boolean {
  return size > 7 // 1~7인은 공식 확정값, 8인+만 가산 산정
}

/** 월 소득(소득인정액 근사) → 기준 중위소득 대비 % */
export function incomePercentile(size: number, monthlyIncome: number): number {
  const m = medianIncome(size)
  if (m <= 0) return 0
  return Math.round((monthlyIncome / m) * 100)
}

// 급여별 선정기준(기준 중위소득 대비 %) — 2026
export const BENEFIT_THRESHOLDS: { key: string; label: string; pct: number; emoji: string }[] = [
  { key: 'livelihood', label: '생계급여', pct: 32, emoji: '🍚' },
  { key: 'medical', label: '의료급여', pct: 40, emoji: '🏥' },
  { key: 'housing', label: '주거급여', pct: 48, emoji: '🏠' },
  { key: 'education', label: '교육급여', pct: 50, emoji: '📚' },
  { key: 'nearpoor', label: '차상위계층', pct: 50, emoji: '🤝' },
]

/** 해당 소득%로 받을 수 있는 급여(기준 이하) */
export function qualifyingBenefits(pct: number) {
  return BENEFIT_THRESHOLDS.filter((b) => pct <= b.pct)
}

/**
 * 가구원수별 각 급여의 월 소득 상한(원). 복지의 핵심 정보인데 사용자가 가장 모르는 값.
 * 예) 4인 가구 생계급여는 월 2,078,316원 이하. monthly가 주어지면 충족 여부(ok)도 함께.
 */
export function benefitCutoffs(size: number, monthly?: number) {
  const m = medianIncome(size)
  return BENEFIT_THRESHOLDS.map((b) => {
    const cutoff = Math.round((m * b.pct) / 100)
    return { ...b, cutoff, ok: monthly != null && monthly > 0 ? monthly <= cutoff : null }
  })
}

/**
 * 예상 생계급여(월, 원) = 생계급여 선정기준(기준 중위소득 32%) − 소득인정액(입력 소득 근사).
 * 사용자가 가장 알고 싶은 "그래서 얼마 받나"를 보여주기 위함. 소득이 기준 초과면 0(미해당).
 * 실제 소득인정액은 재산·부채 환산이 포함돼 다를 수 있어 '예상'으로만 안내.
 */
export function livelihoodPayment(size: number, monthlyIncome: number): number {
  const cutoff = Math.round((medianIncome(size) * 32) / 100)
  return Math.max(0, cutoff - Math.max(0, monthlyIncome || 0))
}

export function won(n: number): string {
  return n.toLocaleString() + '원'
}
