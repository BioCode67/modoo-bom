import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, X, Mic, ArrowDownWideNarrow, Calculator, ChevronDown } from 'lucide-react'
import { useSpeech } from '@/lib/useSpeech'
import { IncomeCalculator } from '@/components/IncomeCalculator'
import { parseMonthly } from '@/lib/format'
import { queryConcepts, relevance } from '@/lib/search'
import { cn } from '@/lib/utils'
import type { Policy } from '@/data/policies'
import { useCatalog } from '@/data/useCatalog'
import { sidoOf, guOf, type EligiblePolicy } from '@/lib/welfare-engine'
import { PolicyCard } from '@/components/PolicyCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { Glossary } from '@/components/Glossary'

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
  const [gungu, setGungu] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [visible, setVisible] = useState(PAGE)
  const catalog = useCatalog()
  const { supported: micOk, listening, toggle: toggleMic } = useSpeech((text) => setQ(text))

  // 선택한 시·도 안에서 고를 수 있는 시·군·구 목록(해당 시도 LOC 정책에서 추출, 가나다순)
  const gunguOptions = useMemo(() => {
    if (!region) return []
    const set = new Set<string>()
    for (const p of catalog) {
      if (!p.id.startsWith('LOC-') || sidoOf(p.target) !== region) continue
      const g = guOf(p.target)
      if (g) set.add(g)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [catalog, region])

  // 필터/검색/정렬 변경 시 노출 개수 초기화(점진 렌더링)
  useEffect(() => { setVisible(PAGE) }, [q, bucket, sort, onlyCash, region, gungu])
  // 시·도가 바뀌면 시·군·구 선택 초기화
  useEffect(() => { setGungu('') }, [region])

  const filtered = useMemo(() => {
    const b = BUCKETS.find((x) => x.key === bucket)
    const concepts = queryConcepts(q)
    // 1) 비검색 필터(분류·지역·현금성) 먼저 적용
    const base = catalog.filter((p) => {
      if (b?.match && !b.match.some((m) => p.category.includes(m))) return false
      // 지역 선택 시: 전국(중앙·시드)은 모두 보이고, 지자체(LOC)는 해당 시·도만
      if (region && p.id.startsWith('LOC-') && sidoOf(p.target) !== region) return false
      // 시·군·구 선택 시: 해당 LOC는 그 시군구 또는 시도 광역(구 표기 없음)만 (다른 구는 제외)
      if (gungu && p.id.startsWith('LOC-')) {
        const g = guOf(p.target)
        if (g && g !== gungu) return false
      }
      if (onlyCash && parseMonthly(p.benefit) <= 0) return false
      return true
    })
    // 2) 검색어가 있으면 개념 확장 + 관련도순(기본 정렬일 때). 다단어·생활어·다개념 우대.
    let list = base
    if (concepts.length) {
      list = base
        .map((p) => ({ p, s: relevance(p, concepts, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b2) => b2.s - a.s)
        .map((x) => x.p)
    }
    if (sort === 'amount') return [...list].sort((a, b2) => parseMonthly(b2.benefit) - parseMonthly(a.benefit))
    if (sort === 'name') return [...list].sort((a, b2) => a.name.localeCompare(b2.name, 'ko'))
    return list
  }, [q, bucket, catalog, sort, onlyCash, region, gungu])

  return (
    <div className="page-container py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">정책 탐색 <span className="gradient-text">🧭</span></h1>
        <p className="text-muted-foreground mt-1">{catalog.length.toLocaleString()}개 복지 정책을 검색하고 둘러보세요.</p>

        {/* 기초생활보장 급여 계산기 — 접이식(내가 받을 수 있는 급여를 1분에 확인) */}
        <div className="mt-4 max-w-xl">
          <button
            onClick={() => setShowCalc((v) => !v)}
            aria-expanded={showCalc}
            className="w-full flex items-center gap-2 rounded-2xl border-2 border-sky2-100 bg-sky2-50/50 px-4 py-3 text-left hover:border-sky2-200 transition-colors"
          >
            <Calculator className="h-5 w-5 text-sky2-600 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold">내가 받을 수 있는 급여 계산하기</span>
              <span className="block text-xs text-muted-foreground">가구원 수·월 소득만 넣으면 생계·의료·주거급여 자격을 바로 확인</span>
            </span>
            <ChevronDown className={cn('h-5 w-5 text-muted-foreground shrink-0 transition-transform', showCalc && 'rotate-180')} />
          </button>
          {showCalc && (
            <div className="mt-2">
              <IncomeCalculator onPickBenefit={(label) => { setQ(label); setShowCalc(false) }} />
            </div>
          )}
        </div>

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
          {/* 시·도 선택 시 시·군·구 2차 필터 — '내 동네 복지'만 */}
          {region && gunguOptions.length > 0 && (
            <select
              value={gungu}
              onChange={(e) => setGungu(e.target.value)}
              aria-label="시군구 선택"
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer', gungu ? 'bg-sky2-500 border-sky2-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
            >
              <option value="">{region} 전체</option>
              {gunguOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
      </motion.div>

      <div className="mt-5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          총 <b className="text-foreground">{filtered.length}</b>개 정책{onlyCash ? ' · 현금성' : ''}{sort === 'amount' ? ' · 금액순' : sort === 'name' ? ' · 이름순' : ''}
        </p>
        <Glossary />
      </div>

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

      {/* 데이터 출처·기준 투명성 — 신뢰 가능한 서비스를 위한 정직한 안내 */}
      <div className="mt-10 rounded-2xl border border-sprout-100 bg-sprout-50/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground/70">ℹ️ 데이터 출처 · 기준</p>
        <p className="mt-0.5">
          보건복지부 검증 시드 + <b>한국사회보장정보원 공공데이터(복지로)</b> 기준 총 {catalog.length.toLocaleString()}건 ·
          금액·선정기준은 <b>2026년</b> 기준입니다. 공공데이터 정책은 요약 정보라 실제 자격·금액과 다를 수 있어요 —
          정확한 내용은 <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="font-semibold text-sprout-600 hover:underline">복지로</a> 또는
          주민센터(☎129 보건복지상담)에서 꼭 확인하세요.
        </p>
      </div>

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
    </div>
  )
}
