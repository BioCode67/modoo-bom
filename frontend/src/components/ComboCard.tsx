import { motion } from 'framer-motion'
import { Layers, AlertTriangle, TrendingDown, CheckCircle2 } from 'lucide-react'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { analyzeCombos, hasCombos } from '@/lib/comboSolver'

/**
 * 수급 조합 안내 카드 — "같이 받을 수 있는 것 vs 하나만 골라야 하는 것 vs 감액 주의".
 * 기존 복지앱에 없는 기능(창의성). 금액 재계산 없이 공식 출처가 확인된 '관계'만 사실대로 안내(정직성).
 */
export function ComboCard({ eligible }: { eligible: EligiblePolicy[] }) {
  const r = analyzeCombos(eligible)
  if (!hasCombos(r)) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="mt-8 card-cute p-4 sm:p-5"
    >
      <h2 className="text-lg font-extrabold flex items-center gap-2">
        <Layers className="h-5 w-5 text-sprout-500" /> 수급 조합 도우미
      </h2>
      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
        받을 수 있는 복지끼리도 <b>같이 받는 것</b>과 <b>하나만 고르는 것</b>이 있어요. 놓치거나 헛걸음하지 않게 관계를 짚어드려요.
        <span className="block mt-0.5 text-xs">※ 금액은 다시 계산하지 않고, 공식 안내로 확인된 관계만 사실대로 알려드려요.</span>
      </p>

      <div className="mt-3 space-y-2.5">
        {r.exclusive.map(({ rule, a, b }) => (
          <Row key={rule.a + rule.b} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} tag="하나만 받을 수 있어요"
            title={`${a.name} ↔ ${b.name}`} note={rule.note} source={rule.source} />
        ))}
        {r.reduction.map(({ rule, a, b }) => (
          <Row key={rule.a + rule.b} tone="amber" icon={<TrendingDown className="h-4 w-4" />} tag="함께 받으면 줄 수 있어요"
            title={`${a.name} + ${b.name}`} note={rule.note} source={rule.source} />
        ))}
        {r.compatible.map(({ rule, a, b }) => (
          <Row key={rule.a + rule.b} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} tag="함께 받을 수 있어요"
            title={`${a.name} + ${b.name}`} note={rule.note} source={rule.source} />
        ))}
      </div>
    </motion.section>
  )
}

const TONES = {
  warn: { box: 'border-rose-200 bg-rose-50/60', chip: 'bg-rose-100 text-rose-700', ic: 'text-rose-500' },
  amber: { box: 'border-amber-200 bg-amber-50/60', chip: 'bg-amber-100 text-amber-700', ic: 'text-amber-500' },
  ok: { box: 'border-sprout-200 bg-sprout-50/60', chip: 'bg-sprout-100 text-sprout-700', ic: 'text-sprout-500' },
} as const

function Row({ tone, icon, tag, title, note, source }: { tone: keyof typeof TONES; icon: React.ReactNode; tag: string; title: string; note: string; source: string }) {
  const t = TONES[tone]
  return (
    <div className={`rounded-2xl border p-3 ${t.box}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={t.ic}>{icon}</span>
        <span className={`chip ${t.chip}`}>{tag}</span>
        <span className="font-bold text-sm">{title}</span>
      </div>
      <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed">{note}</p>
      <p className="text-[11px] text-muted-foreground/80 mt-1">📄 {source}</p>
    </div>
  )
}
