import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, X, Mic, ArrowDownWideNarrow } from 'lucide-react'
import { useSpeech } from '@/lib/useSpeech'
import { parseMonthly } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Policy } from '@/data/policies'
import { useCatalog } from '@/data/useCatalog'
import { sidoOf, type EligiblePolicy } from '@/lib/welfare-engine'
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
  { key: 'veteran', label: '보훈', emoji: '🎖️', match: ['보훈'] },
  { key: 'farm', label: '농어민', emoji: '🌾', match: ['농어'] },
]

type SortKey = 'default' | 'amount' | 'name'
const PAGE = 60

export function Explore() {
  const [q, setQ] = useState('')
  const [bucket, setBucket] = useState('all')
  const [sort, setSort] = useState<SortKey>('default')
  const [onlyCash, setOnlyCash] = useState(false)
  const [region, setRegion] = useState('')
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [visible, setVisible] = useState(PAGE)
  const catalog = useCatalog()
  const { supported: micOk, listening, toggle: toggleMic } = useSpeech((text) => setQ(text))

  // 필터/검색/정렬 변경 시 노출 개수 초기화(점진 렌더링)
  useEffect(() => { setVisible(PAGE) }, [q, bucket, sort, onlyCash, region])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const b = BUCKETS.find((x) => x.key === bucket)
    const list = catalog.filter((p) => {
      if (b?.match && !b.match.some((m) => p.category.includes(m))) return false
      // 지역 선택 시: 전국(중앙·시드)은 모두 보이고, 지자체(LOC)는 해당 시·도만
      if (region && p.id.startsWith('LOC-') && sidoOf(p.target) !== region) return false
      if (onlyCash && parseMonthly(p.benefit) <= 0) return false
      if (!query) return true
      return (p.name + p.category + p.target + p.eligibility + p.benefit).toLowerCase().includes(query)
    })
    if (sort === 'amount') return [...list].sort((a, b2) => parseMonthly(b2.benefit) - parseMonthly(a.benefit))
    if (sort === 'name') return [...list].sort((a, b2) => a.name.localeCompare(b2.name, 'ko'))
    return list
  }, [q, bucket, catalog, sort, onlyCash, region])

  return (
    <div className="page-container py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">정책 탐색 <span className="gradient-text">🧭</span></h1>
        <p className="text-muted-foreground mt-1">{catalog.length.toLocaleString()}개 복지 정책을 검색하고 둘러보세요.</p>

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
            <button onClick={() => setQ('')} aria-label="검색어 지우기" className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1.5 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
          {micOk && (
            <button onClick={toggleMic} aria-label={listening ? '음성 입력 중지' : '음성으로 검색'}
              className={cn('absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 transition-colors', listening ? 'bg-rose-500 text-white animate-pulse' : 'text-sprout-600 hover:bg-sprout-50')}>
              <Mic className="h-4 w-4" />
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
        {/* 정렬·필터 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
          {([['default', '기본순'], ['amount', '금액 높은순'], ['name', '이름순']] as [SortKey, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', sort === k ? 'bg-sprout-500 border-sprout-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}>
              {l}
            </button>
          ))}
          <button onClick={() => setOnlyCash((v) => !v)}
            className={cn('ml-1 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', onlyCash ? 'bg-peach-400 border-peach-400 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}>
            💰 현금성만
          </button>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            aria-label="지역 선택"
            className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer', region ? 'bg-sky2-500 border-sky2-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
          >
            <option value="">📍 전국</option>
            {['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </motion.div>

      <p className="mt-5 text-sm text-muted-foreground">
        총 <b className="text-foreground">{filtered.length}</b>개 정책{onlyCash ? ' · 현금성' : ''}{sort === 'amount' ? ' · 금액순' : sort === 'name' ? ' · 이름순' : ''}
      </p>

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <p className="text-4xl mb-2">🔍</p>
          검색 결과가 없어요. 다른 키워드로 찾아보세요.
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.slice(0, visible).map((p, i) => (
              <PolicyCard key={p.id} policy={p} index={Math.min(i, 12)} onOpen={setSelected} />
            ))}
          </div>
          {visible < filtered.length && (
            <div className="mt-6 text-center">
              <button onClick={() => setVisible((v) => v + PAGE)} className="btn-secondary">
                더 보기 ({filtered.length - visible}건 남음)
              </button>
            </div>
          )}
        </>
      )}

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
    </div>
  )
}
