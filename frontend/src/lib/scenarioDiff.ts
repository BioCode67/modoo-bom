import { judgeBenefits } from '@/lib/incomeRecognition'

/**
 * 소득인정액 시나리오 비교 — '지금'과 '바뀐 뒤(이직·이사 등)'의 소득인정액과 자격 급여를 견준다.
 *
 * 소득인정액 계산기가 한 시점을 계산한다면, 여기선 두 시점을 비교해 "소득이 늘면 어떤 급여를
 * 잃고, 줄면 어떤 급여가 열리는지"를 보여준다 → 복지 절벽(소득이 늘어 급여를 잃는 구간)을
 * 눈으로 확인하는 계획 도구. judgeBenefits(엔진 기준값) 결과의 차집합만 쓰므로 규칙과 일치.
 */

export interface Benefit { key: string; label: string; emoji: string }

export interface ScenarioDiff {
  totalDelta: number      // after − before (소득인정액 변화; +면 늘어남 = 자격에 불리)
  gained: Benefit[]       // 새로 자격이 되는 급여(소득이 줄어 열림)
  lost: Benefit[]         // 자격을 잃는 급여(소득이 늘어 닫힘)
  unchanged: boolean
}

export interface ScenarioPoint { total: number; size: number }

/** before → after 로 갈 때 자격 급여의 득실 */
export function diffScenarios(before: ScenarioPoint, after: ScenarioPoint): ScenarioDiff {
  const b = new Map(judgeBenefits(before.total, before.size).map((x) => [x.key, x as Benefit]))
  const a = new Map(judgeBenefits(after.total, after.size).map((x) => [x.key, x as Benefit]))
  const gained = [...a.values()].filter((x) => !b.has(x.key))
  const lost = [...b.values()].filter((x) => !a.has(x.key))
  const totalDelta = after.total - before.total
  return { totalDelta, gained, lost, unchanged: gained.length === 0 && lost.length === 0 }
}

/** 비교 결과 한 줄 요약 */
export function diffSummary(d: ScenarioDiff): string {
  if (d.unchanged) return '자격 급여 변화 없음'
  const parts: string[] = []
  if (d.lost.length > 0) parts.push(`잃음: ${d.lost.map((x) => x.label).join('·')}`)
  if (d.gained.length > 0) parts.push(`열림: ${d.gained.map((x) => x.label).join('·')}`)
  return parts.join(' / ')
}
