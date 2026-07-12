import { useState } from 'react'
import { Gift, ExternalLink, ChevronDown } from 'lucide-react'
import type { UserProfile } from '@/lib/welfare-engine'
import { getLinkedDiscounts } from '@/lib/linkedBenefits'
import { cn } from '@/lib/utils'

/**
 * 연계 감면(요금감면 일괄신청) 카드 — '자격이 되면 딸려오지만 몰라서 못 받는' 통신·전기·가스·TV수신료 감면을
 * 자격 신호별로 묶어 안내하고, 정부24 일괄신청으로 한 번에 처리하도록 연결(미션 직결).
 *
 * 정직성: 금액은 현금 합계에 더하지 않고(감면=지출 절감), '자격이 확정되면' 조건부로만 안내한다.
 */
export function LinkedDiscounts({ profile }: { profile: UserProfile }) {
  const groups = getLinkedDiscounts(profile)
  const [open, setOpen] = useState(true)
  if (groups.length === 0) return null

  return (
    <div className="mt-6 rounded-3xl border-2 border-peach-200 bg-peach-50/50 p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-peach-100 text-peach-700">
          <Gift className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-extrabold text-foreground">이건 몰라서 놓치기 쉬워요 — 자격이 되면 <span className="text-peach-700">요금감면도 함께</span></span>
          <span className="block text-xs text-muted-foreground mt-0.5">전기·가스·난방은 <b>정부24 요금감면 일괄신청</b>으로 한 번에 · 통신·TV수신료는 각 신청처 안내</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-peach-600 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-2xl bg-white/80 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-foreground">🎁 {g.label} 감면 묶음</h4>
                <a
                  href={g.apply.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-peach-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-peach-700 whitespace-nowrap"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {g.apply.label}
                </a>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">{g.why}</p>
              <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                {g.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    <span className="shrink-0" aria-hidden>{it.icon}</span>
                    <span>
                      <b className="text-foreground">{it.name}</b>
                      <span className="block text-muted-foreground text-[12px] leading-snug">{it.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            ※ 감면은 <b>지출을 줄여주는 혜택</b>이라 위 ‘현금 지원’ 합계엔 넣지 않았어요. 실제 감면 여부·금액은 자격 심사와 신청 시 확정돼요(2026년 기준 최대·근사치).
          </p>
        </div>
      )}
    </div>
  )
}
