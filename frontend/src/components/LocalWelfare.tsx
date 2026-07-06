import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, ArrowRight, Sparkles } from 'lucide-react'
import { useCatalog } from '@/data/useCatalog'
import { sidoOf } from '@/lib/welfare-engine'
import { regionStats } from '@/lib/localWelfare'
import { KoreaTileMap } from '@/components/KoreaTileMap'
import { useAppStore } from '@/store/useAppStore'

/**
 * 우리 동네 복지 — 지자체(LOC) 4,600여 건을 시·도로 세어 보여준다.
 * 보조금24 등 중앙부처 중심 서비스가 얇게 다루는 '내 지역' 복지를 정면으로 노출(차별화).
 * 저장된 프로필의 지역이 있으면 '내 지역'을 먼저 콕 집어 안내(개인화)하고,
 * 시·도를 고르면 실제 지원 예시를 바로 보여준다(카운트만이 아니라 '무엇이 있는지').
 */
export function LocalWelfare() {
  const catalog = useCatalog()
  const { setPendingRegion, setView, profile } = useAppStore()
  const [sel, setSel] = useState('')

  // 시·도별 지자체 복지 건수 + 예시(LOC-만). 최초 1회 계산.
  const { counts, examples, total } = useMemo(() => regionStats(catalog, 3), [catalog])

  // 저장된 프로필의 지역 → 시·도 정규화. 해당 지역 복지가 있으면 '내 지역'으로 먼저 안내.
  const myS = useMemo(() => sidoOf(profile?.region || ''), [profile?.region])
  const myCount = (myS && counts[myS]) || 0

  const go = (sido: string) => { setPendingRegion(sido); setView('explore') }
  const shown = sel || myS
  const shownExamples = (shown && examples[shown]) || []

  return (
    <section className="page-container py-10 sm:py-14">
      <motion.div
        initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }}
        className="rounded-3xl border-2 border-sky2-200 bg-gradient-to-br from-sky2-50 via-white to-sprout-50 p-6 sm:p-8"
      >
        <div className="flex items-center gap-2 text-sky2-700">
          <MapPin className="h-5 w-5" />
          <span className="text-sm font-bold">우리 동네 복지</span>
        </div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold leading-tight">
          내 지역에만 있는 복지{total > 0 ? <>, <span className="gradient-text">{total.toLocaleString()}건</span></> : <span className="gradient-text">을 콕 집어</span>}
        </h2>
        <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-2xl">
          정부 지원만 보면 놓쳐요. 시·군·구가 주는 <b>우리 동네 전용 지원</b>(출산장려금·청년수당·어르신 교통 등)까지 —
          지역을 고르면 바로 보여드려요.
        </p>

        {/* 개인화 — 저장된 지역이 있으면 '내 지역'을 먼저 콕 집어 안내 */}
        {myCount > 0 && (
          <button
            onClick={() => go(myS)}
            onMouseEnter={() => setSel(myS)} onFocus={() => setSel(myS)}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border-2 border-sky2-300 bg-white px-4 py-3 text-left transition-all hover:border-sky2-400 hover:shadow-sm sm:w-auto"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky2-100 text-sky2-700">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold text-sky2-600">내 지역 맞춤</span>
              <span className="block font-extrabold leading-tight">{myS} 복지 {myCount.toLocaleString()}건 바로 보기</span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-sky2-600" />
          </button>
        )}

        {/* 자체 렌더 한국 지도(단계구분도) — 건수 많을수록 진한 초록, 클릭 시 그 지역 복지로 */}
        <KoreaTileMap counts={counts} myS={myS} sel={sel} onHover={setSel} onPick={go} />

        {/* 선택(또는 내 지역)의 실제 지원 예시 — 카운트만이 아니라 '무엇이 있는지' 미리보기 */}
        {shown && shownExamples.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm">
            <span className="font-bold text-sky2-700">{shown}</span>
            <span className="text-muted-foreground"> 예: </span>
            <span className="text-foreground">
              {shownExamples.map((n, i) => (
                <span key={i}>{i > 0 && ' · '}{n}</span>
              ))}
              {(counts[shown] || 0) > shownExamples.length && (
                <span className="text-muted-foreground"> 외 {((counts[shown] || 0) - shownExamples.length).toLocaleString()}건</span>
              )}
            </span>
          </div>
        )}

        {sel && (counts[sel] || 0) > 0 && (
          <button onClick={() => go(sel)} className="mt-4 inline-flex items-center gap-1.5 btn-primary !py-2.5">
            {sel} 복지 {(counts[sel] || 0).toLocaleString()}건 보기 <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </motion.div>
    </section>
  )
}
