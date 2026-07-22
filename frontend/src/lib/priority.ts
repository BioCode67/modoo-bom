import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly, isCashBenefit, formatWon } from '@/lib/format'
import { deadlineHint } from '@/lib/deadline'
import { applyChannel, type ApplyChannel } from '@/lib/roadmap'

/**
 * 복지 신청 우선순위 추천 — "여러 개 되는데 뭐부터 하지?"에 답한다.
 *
 * 로드맵(roadmap)이 '무엇을 어떤 순서의 단계로'라면, 여기선 '어떤 복지가 먼저 챙길 가치가 큰지'를
 * 투명한 점수(예상 금액·시급성·자격 확실성·신청 편의)로 매긴다. 각 항목 점수를 그대로 보여줘
 * 왜 이 순위인지 납득할 수 있게 한다(블랙박스 랭킹 금지).
 *
 * 정직성: 점수는 우선순위 '가늠자'일 뿐 자격·금액을 단정하지 않는다. 금액은 현금성만 반영하고
 * (서비스·감면 제외), 확실성은 엔진 confidence를 그대로 쓴다. 전부 온디바이스 계산.
 */

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', medium: '보통', hard: '어려움' }

/** 신청 채널 + 서류 수로 예상 신청 난이도 */
export function applyDifficulty(channel: ApplyChannel, docCount: number): Difficulty {
  if (channel === 'online' && docCount <= 2) return 'easy'
  if (channel === 'visit' || docCount >= 6) return 'hard'
  return 'medium'
}

export interface ScoreInput {
  monthly: number          // 월 현금성 금액(0 = 현금성 아님/미상)
  urgent: boolean | null   // true=마감 임박 · false=신청 기간 있음 · null=상시
  confidence: number       // 0~1 (엔진 자격 확실성)
  difficulty: Difficulty
}

export interface PriorityFactor { label: string; score: number; max: number; note: string }
export interface Scored { score: number; factors: PriorityFactor[] }

// 항목별 만점: 금액 40 · 시급성 25 · 확실성 20 · 편의 15 (합 100)
const CASH_MAX = 40, URGENCY_MAX = 25, CONF_MAX = 20, EASE_MAX = 15
const CASH_FULL = 300000 // 월 30만원 이상이면 금액 만점

/** 투명한 우선순위 점수(0~100) + 항목별 근거 */
export function scorePolicy(inp: ScoreInput): Scored {
  const cash = Math.round(Math.min(Math.max(inp.monthly, 0) / CASH_FULL, 1) * CASH_MAX)
  const urgency = inp.urgent === true ? URGENCY_MAX : inp.urgent === false ? 14 : 6
  const conf = Math.round(Math.min(Math.max(inp.confidence, 0), 1) * CONF_MAX)
  const ease = inp.difficulty === 'easy' ? EASE_MAX : inp.difficulty === 'medium' ? 8 : 3
  const factors: PriorityFactor[] = [
    { label: '예상 금액', score: cash, max: CASH_MAX, note: inp.monthly > 0 ? `월 ${formatWon(inp.monthly)}` : '현금성 아님/미상' },
    { label: '신청 시급성', score: urgency, max: URGENCY_MAX, note: inp.urgent === true ? '마감 임박' : inp.urgent === false ? '신청 기간 있음' : '상시 신청' },
    { label: '자격 확실성', score: conf, max: CONF_MAX, note: `${Math.round(Math.min(Math.max(inp.confidence, 0), 1) * 100)}%` },
    { label: '신청 편의', score: ease, max: EASE_MAX, note: DIFFICULTY_LABEL[inp.difficulty] },
  ]
  return { score: cash + urgency + conf + ease, factors }
}

export interface RankedPolicy extends Scored {
  policy: Policy | EligiblePolicy
  monthly: number
  difficulty: Difficulty
  urgent: boolean | null
}

/** 정책 목록을 우선순위 점수 내림차순으로 정렬(근거 동봉) */
export function rankPolicies(policies: (Policy | EligiblePolicy)[]): RankedPolicy[] {
  const ranked = (policies || []).filter(Boolean).map((policy) => {
    const monthly = isCashBenefit(policy.benefit, `${policy.name} ${policy.category}`) ? parseMonthly(policy.benefit) : 0
    const hint = deadlineHint(policy)
    const urgent = hint ? hint.urgent : null
    const confidence = 'confidence' in policy && typeof (policy as EligiblePolicy).confidence === 'number'
      ? (policy as EligiblePolicy).confidence : 0.5
    const difficulty = applyDifficulty(applyChannel(policy.application), (policy.required_docs || []).length)
    const scored = scorePolicy({ monthly, urgent, confidence, difficulty })
    return { policy, monthly, difficulty, urgent, ...scored }
  })
  // 점수 내림차순, 동점이면 금액 내림차순으로 안정 정렬
  ranked.sort((a, b) => b.score - a.score || b.monthly - a.monthly)
  return ranked
}
