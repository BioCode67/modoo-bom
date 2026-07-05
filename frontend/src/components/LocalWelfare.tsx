import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, ArrowRight } from 'lucide-react'
import { useCatalog } from '@/data/useCatalog'
import { sidoOf } from '@/lib/welfare-engine'
import { useAppStore } from '@/store/useAppStore'

/**
 * 우리 동네 복지 — 지자체(LOC) 4,500여 건을 시·도로 세어 보여준다.
 * 보조금24 등 중앙부처 중심 서비스가 얇게 다루는 '내 지역' 복지를 정면으로 노출(차별화).
 */
const SIDOS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']

export function LocalWelfare() {
  const catalog = useCatalog()
  const { setPendingRegion, setView } = useAppStore()
  const [sel, setSel] = useState('')

  // 시·도별 지자체 복지 건수(LOC-만). 최초 1회 계산.
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of catalog) {
      if (!p.id.startsWith('LOC-')) continue
      const s = sidoOf(p.target)
      if (s) m[s] = (m[s] || 0) + 1
    }
    return m
  }, [catalog])

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts])
  const go = (sido: string) => { setPendingRegion(sido); setView('explore') }

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

        <div className="mt-5 flex flex-wrap gap-2">
          {SIDOS.map((s) => {
            const n = counts[s] || 0
            const active = sel === s
            return (
              <button
                key={s}
                onMouseEnter={() => setSel(s)} onFocus={() => setSel(s)}
                onClick={() => go(s)}
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-all ' +
                  (active ? 'bg-sky2-500 border-sky2-500 text-white shadow-sm' : 'bg-white border-sky2-100 text-foreground hover:border-sky2-300')
                }
              >
                {s}
                {n > 0 && <span className={active ? 'text-xs opacity-90' : 'text-xs text-sky2-600'}>{n.toLocaleString()}</span>}
              </button>
            )
          })}
        </div>
        {sel && (counts[sel] || 0) > 0 && (
          <button onClick={() => go(sel)} className="mt-4 inline-flex items-center gap-1.5 btn-primary !py-2.5">
            {sel} 복지 {(counts[sel] || 0).toLocaleString()}건 보기 <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </motion.div>
    </section>
  )
}
