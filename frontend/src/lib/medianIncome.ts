// 2026년 기준 중위소득 100% (월, 원) — 보건복지부 고시 / 정책브리핑(korea.kr) 출처
// 1~6인 공식 확정값. 7인 이상은 6인 + (6인-5인) 가산으로 근사(추정 표기).
const MEDIAN_2026: Record<number, number> = {
  1: 2_564_238,
  2: 4_199_292,
  3: 5_359_036,
  4: 6_494_738,
  5: 7_556_719,
  6: 8_555_952,
}
const ADD_PER_PERSON = MEDIAN_2026[6] - MEDIAN_2026[5] // 7인+ 가산 근사

export const MEDIAN_YEAR = 2026

/** 가구원수별 기준 중위소득 100% (월). 7인 이상은 근사. */
export function medianIncome(size: number): number {
  const n = Math.max(1, Math.min(size, 12))
  if (MEDIAN_2026[n]) return MEDIAN_2026[n]
  return MEDIAN_2026[6] + ADD_PER_PERSON * (n - 6)
}
export function isApprox(size: number): boolean {
  return size > 6
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

export function won(n: number): string {
  return n.toLocaleString() + '원'
}
