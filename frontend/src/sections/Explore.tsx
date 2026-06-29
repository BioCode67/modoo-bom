import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { WELFARE_POLICIES, type Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { PolicyCard } from '@/components/PolicyCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'

const BUCKETS: { key: string; label: string; emoji: string; match?: string[] }[] = [
  { key: 'all', label: '전체', emoji: '🌼' },
  { key: 'senior', label: '노인', emoji: '👵', match: ['노인'] },
  { key: 'child', label: '아동·육아', emoji: '👶', match: ['아동', '영유아', '보육'] },
  { key: 'youth', label: '청년', emoji: '🧑', match: ['청년'] },
  { key: 'disabled', label: '장애인', emoji: '♿', match: ['장애'] },
  { key: 'birth', label: '임신·출산', emoji: '🤰', match: ['임신', '출산', '모'] },
  { key: 'lowincome', label: '저소득', emoji: '🤝', match: ['저소득', '생계', '기초'] },
  { key: 'house', label: '주거', emoji: '🏠', match: ['주거'] },
  { key: 'medical', label: '의료', emoji: '🏥', match: ['의료', '건강'] },
  { key: 'job', label: '고용', emoji: '💼', match: ['고용', '취업', '일자리'] },
  { key: 'edu', label: '교육', emoji: '📚', match: ['교육', '학'] },
  { key: 'family', label: '가족', emoji: '👨‍👩‍👧', match: ['한부모', '가족', '다문화'] },
]

export function Explore() {
  const [q, setQ] = useState('')
  const [bucket, setBucket] = useState('all')
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const b = BUCKETS.find((x) => x.key === bucket)
    return WELFARE_POLICIES.filter((p) => {
      if (b?.match && !b.match.some((m) => p.category.includes(m))) return false
      if (!query) return true
      return (p.name + p.category + p.target + p.eligibility + p.benefit).toLowerCase().includes(query)
    })
  }, [q, bucket])

  return (
    <div className="page-container py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">정책 탐색 <span className="gradient-text">🧭</span></h1>
        <p className="text-muted-foreground mt-1">120여 개 복지 정책을 검색하고 둘러보세요.</p>

        {/* 검색 */}
        <div className="mt-5 relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="기초연금, 청년, 출산… 검색"
            className="w-full rounded-2xl border-2 border-sprout-100 bg-white pl-12 pr-10 py-3.5 text-sm font-medium focus-ring"
            aria-label="정책 검색"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="검색어 지우기" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 카테고리 칩 */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2 nice-scroll -mx-1 px-1">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBucket(b.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold border-2 transition-all ${
                bucket === b.key ? 'bg-sprout-500 border-sprout-500 text-white shadow-soft' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200'
              }`}
            >
              <span>{b.emoji}</span> {b.label}
            </button>
          ))}
        </div>
      </motion.div>

      <p className="mt-5 text-sm text-muted-foreground">
        총 <b className="text-foreground">{filtered.length}</b>개 정책
      </p>

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <p className="text-4xl mb-2">🔍</p>
          검색 결과가 없어요. 다른 키워드로 찾아보세요.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p, i) => (
            <PolicyCard key={p.id} policy={p} index={i} onOpen={setSelected} />
          ))}
        </div>
      )}

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
