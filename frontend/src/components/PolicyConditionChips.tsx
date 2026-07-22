import type { Policy } from '@/data/policies'
import { eligibilityConditions } from '@/lib/eligibilityConditions'
import { benefitBreakdown } from '@/lib/benefitBreakdown'
import { formatWon } from '@/lib/format'

/**
 * 정책을 한눈에 — 자격 요건을 스캔 가능한 칩으로, 합산형 금액을 구성 요소로 풀어 보여준다.
 * 순수 로직(eligibilityConditions·benefitBreakdown)이 계산하고 여기선 표시만 담당한다.
 * 뽑을 게 없으면 아무것도 렌더하지 않는다.
 */

const CHIP_TONE: Record<string, string> = {
  age: 'bg-sky2-50 text-sky2-700',
  income: 'bg-peach-50 text-peach-700',
  target: 'bg-sprout-50 text-sprout-700',
  region: 'bg-violet-50 text-violet-700',
}

/** 자격 요건 조건 칩 (연령·소득·대상군·지역) */
export function ConditionChips({ policy }: { policy: Policy }) {
  const conds = eligibilityConditions(policy)
  if (conds.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {conds.map((c, i) => (
        <span key={`${c.type}-${i}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP_TONE[c.type] ?? 'bg-muted text-foreground'}`}>
          <span aria-hidden>{c.emoji}</span> {c.label}
        </span>
      ))}
    </div>
  )
}

/** 합산형 혜택 금액의 구성 분해 (기초 + 부가 = 합계) */
export function BenefitBreakdownView({ benefit }: { benefit: string }) {
  const b = benefitBreakdown(benefit)
  if (!b.hasBreakdown) return null
  return (
    <div className="mt-2 rounded-xl border border-sprout-100 bg-sprout-50/40 p-2.5">
      <p className="mb-1 text-[11px] font-bold text-sprout-700">금액 구성</p>
      <ul className="space-y-0.5 text-xs">
        {b.parts.map((p, i) => (
          <li key={i} className="flex items-center justify-between">
            <span className="text-muted-foreground">{p.label}</span>
            <span className="tabular-nums font-semibold">{formatWon(p.won)}</span>
          </li>
        ))}
        <li className="mt-0.5 flex items-center justify-between border-t border-sprout-100 pt-1">
          <span className="font-bold">합계</span>
          <span className="tabular-nums font-extrabold text-sprout-700">월 {formatWon(b.total)}</span>
        </li>
      </ul>
    </div>
  )
}
