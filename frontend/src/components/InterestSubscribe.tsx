import { useMemo } from 'react'
import { BellRing, Plus, Check, ArrowRight, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { INTEREST_CATEGORIES, interestDigest } from '@/lib/interest'
import type { EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 관심 분야 알림 구독 — 웰로·복지멤버십의 핵심 기능(분야 단위 상시 관심)을 채운다.
 * 구독한 분야에서 '받을 수 있는데(분석 추천) 아직 안 담은' 복지를 능동적으로 콕 집어 안내.
 * 구독 상태는 기기(localStorage)에만 저장 — 서버 전송 없음.
 */
export function InterestSubscribe({ onOpenPolicy }: { onOpenPolicy: (id: string) => void }) {
  const { result, tracked, subscribedCategories, toggleCategory, setView } = useAppStore()
  const eligible = useMemo(() => (result?.eligible_policies ?? []) as EligiblePolicy[], [result])
  const trackedIds = useMemo(() => new Set(tracked.map((t) => t.policyId)), [tracked])

  // 분야별 추천 복지 수(구독 여부 무관 — 칩 배지용)
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of INTEREST_CATEGORIES) {
      // 빈 카테고리(pc==='')는 c.key.includes('')가 항상 true라 모든 분야에 잡히므로 제외.
      m[c.key] = eligible.filter((p) => {
        const pc = p.category || ''
        return !!pc && (pc.includes(c.key) || c.key.includes(pc))
      }).length
    }
    return m
  }, [eligible])

  const nudges = useMemo(
    () => interestDigest(subscribedCategories, eligible, trackedIds),
    [subscribedCategories, eligible, trackedIds],
  )

  return (
    <section className="mt-6 rounded-3xl border-2 border-peach-200 bg-gradient-to-br from-peach-50 via-white to-sprout-50 p-5 sm:p-6">
      <div className="flex items-center gap-2 text-peach-700">
        <BellRing className="h-5 w-5" />
        <span className="text-sm font-bold">관심 분야 알림</span>
      </div>
      <h2 className="mt-1.5 text-lg font-extrabold sm:text-xl">
        분야를 구독하면 <span className="text-peach-700">새로 챙길 복지</span>를 먼저 알려드려요
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        관심 분야를 켜두면, 받을 수 있는데 아직 안 담은 복지를 이 자리에서 능동적으로 안내해요. (기기에만 저장)
      </p>

      {/* 분야 칩 — 구독 토글 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {INTEREST_CATEGORIES.map((c) => {
          const on = subscribedCategories.includes(c.key)
          const n = countByCat[c.key] || 0
          return (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              aria-pressed={on}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-all ' +
                (on ? 'border-peach-500 bg-peach-500 text-white shadow-sm'
                  : 'border-peach-200 bg-white text-foreground hover:border-peach-400')
              }
            >
              <span aria-hidden>{c.emoji}</span>{c.key}
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 opacity-60" />}
              {n > 0 && (
                <span className={'rounded-full px-1.5 text-[10px] font-bold ' + (on ? 'bg-white/25' : 'bg-peach-100 text-peach-700')}>
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 구독 결과 — 분야별 '받을 수 있는데 안 담은' 복지 */}
      {subscribedCategories.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">👆 위에서 관심 분야를 켜보세요.</p>
      ) : eligible.length === 0 ? (
        <button
          onClick={() => setView('analyze')}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-sprout-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sprout-700"
        >
          <Sparkles className="h-4 w-4" /> 분석하면 구독 분야에서 받을 복지를 콕 집어드려요
        </button>
      ) : nudges.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">구독하신 분야는 이미 다 챙기셨어요! 🎉</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {nudges.map((nd) => (
            <div key={nd.category} className="rounded-2xl bg-white/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">
                  {nd.category} · {nd.untracked > 0
                    ? <>받을 수 있는데 아직 안 담은 <span className="text-peach-700">{nd.untracked}건</span></>
                    : <span className="text-sprout-700">다 챙기셨어요 🎉</span>}
                </span>
              </div>
              {nd.examples.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {nd.examples.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onOpenPolicy(e.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-sprout-200 bg-white px-2.5 py-1 text-xs font-semibold text-sprout-800 hover:border-sprout-400"
                    >
                      {e.name}<ArrowRight className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
