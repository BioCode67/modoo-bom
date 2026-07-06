import { motion } from 'framer-motion'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly, formatWon, categoryMeta } from '@/lib/format'

/** 월 혜택 상위 정책 가로 막대 — 금액이 파싱되는 정책만 */
export function BenefitBreakdown({ policies }: { policies: EligiblePolicy[] }) {
  const rows = policies
    .map((p) => ({ name: p.name, won: parseMonthly(p.benefit), cat: p.category }))
    .filter((r) => r.won > 0)
    .sort((a, b) => b.won - a.won)
    .slice(0, 5)

  if (rows.length === 0) return null
  const max = rows[0].won

  return (
    <div className="card-cute p-5">
      <p className="text-sm font-bold mb-1">월 예상 혜택 (상위 {rows.length})</p>
      <p className="text-xs text-muted-foreground mb-4">정책별 월 최대 수령액 기준</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-semibold truncate pr-2">{categoryMeta(r.cat).emoji} {r.name}</span>
              <span className="text-xs font-extrabold text-sprout-700 tabular-nums shrink-0">{formatWon(r.won)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-sprout-50 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(8, (r.won / max) * 100)}%` }}
                transition={{ duration: 0.7, delay: i * 0.08, ease: 'easeOut' }}
                className="h-full rounded-full bg-gradient-to-r from-sprout-400 to-emerald-500"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const DONUT_COLORS = ['#22c55e', '#38bdf8', '#fb923c', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#94a3b8']

/** 카테고리 분포 도넛 + 범례 (순수 SVG) */
export function CategoryDistribution({ policies }: { policies: EligiblePolicy[] }) {
  const counts = new Map<string, number>()
  for (const p of policies) counts.set(p.category, (counts.get(p.category) || 0) + 1)
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const total = policies.length
  if (total === 0 || entries.length === 0) return null

  // 상위 6개 + 기타
  const top = entries.slice(0, 6)
  const otherCount = entries.slice(6).reduce((s, [, n]) => s + n, 0)
  const segs = otherCount > 0 ? [...top, ['기타', otherCount] as [string, number]] : top

  const R = 42, C = 2 * Math.PI * R
  let offset = 0
  const arcs = segs.map(([cat, n], i) => {
    const frac = n / total
    const seg = { cat, n, color: DONUT_COLORS[i % DONUT_COLORS.length], dash: frac * C, gap: C - frac * C, off: offset }
    offset -= frac * C
    return seg
  })

  return (
    <div className="card-cute p-5">
      <p className="text-sm font-bold mb-1">카테고리 분포</p>
      <p className="text-xs text-muted-foreground mb-4">수혜 가능 {total}개 정책 구성</p>
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90">
          {arcs.map((a) => (
            <circle key={a.cat} cx="50" cy="50" r={R} fill="none" stroke={a.color} strokeWidth="14"
              strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={a.off} />
          ))}
          <text x="50" y="50" className="rotate-90" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central"
            fontSize="20" fontWeight="800" fill="#16a34a">{total}</text>
        </svg>
        <ul className="flex-1 grid grid-cols-1 gap-1.5 min-w-0">
          {arcs.map((a) => (
            <li key={a.cat} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
              <span className="truncate flex-1">{a.cat}</span>
              <span className="font-bold tabular-nums text-muted-foreground">{a.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
