import { useMemo } from 'react'
import { Zap } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { triageCrises, type SpeedTag, type RungWhen } from '@/lib/crisisTriage'

/**
 * 위기 속도 트리아지 — '무엇을'이 아니라 '언제 실제 도움이 오나'로 지원을 재정렬한다.
 * 순수 로직(triageCrises)이 정책 텍스트의 도달속도 신호로 사다리를 만들고, 여기선 표시만.
 * 압도된 위기자에게 '오늘 할 단 하나(fastestAction)'를 앞세운다. 모든 시간표기는 '추정'.
 */

const TAG_CLS: Record<SpeedTag, string> = {
  선지원: 'bg-sprout-100 text-sprout-700',
  즉시전화: 'bg-rose-100 text-rose-700',
  방문: 'bg-amber-100 text-amber-700',
  심사후: 'bg-sky2-100 text-sky2-700',
}

const WHEN_DOT: Record<RungWhen, string> = {
  now: 'bg-rose-500',
  today: 'bg-orange-500',
  week: 'bg-amber-500',
  month: 'bg-sky2-500',
  recovery: 'bg-sprout-500',
}

export function TriageLadder({ policies }: { policies: (Policy | EligiblePolicy)[] }) {
  const { rungs, fastestAction } = useMemo(() => triageCrises(policies), [policies])
  if (rungs.length === 0) return null

  return (
    <div className="mt-3 rounded-2xl border border-rose-100 bg-white/70 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-extrabold text-rose-700">
        <Zap className="h-4 w-4" /> 언제 도움이 오나 — 시간 순 실행 사다리
      </p>

      {/* 오늘 할 단 하나 — 압도된 위기자를 위한 단일 초점 */}
      {fastestAction && (
        <div className="mt-2 rounded-xl bg-rose-500 px-3 py-2.5 text-white">
          <p className="text-[11px] font-bold opacity-90">지금 이것부터 — 가장 빨리 도움받는 길</p>
          <p className="mt-0.5 text-sm font-bold">{fastestAction.policy.name}</p>
          <p className="text-[11px] opacity-90">{fastestAction.timeHint}</p>
        </div>
      )}

      <ol className="mt-3 space-y-2.5">
        {rungs.map((r) => (
          <li key={r.when} className="flex gap-2.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${WHEN_DOT[r.when]}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground/90">{r.label} <span className="font-normal text-muted-foreground">· {r.urgencyNote}</span></p>
              <ul className="mt-1 space-y-1">
                {r.items.map((it) => (
                  <li key={it.policy.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${TAG_CLS[it.speedTag]}`}>{it.speedTag}</span>
                    <span className="font-semibold text-foreground/80">{it.policy.name}</span>
                    <span className="text-[10px] text-muted-foreground">{it.timeHint}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-muted-foreground">※ 도달 시간은 정책 안내문 기반 추정이에요. 실제 심사·지급일은 기관 확인이 정확해요.</p>
    </div>
  )
}
