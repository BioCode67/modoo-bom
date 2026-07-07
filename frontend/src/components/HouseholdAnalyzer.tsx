import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Plus, Trash2, ChevronRight } from 'lucide-react'
import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { formatWon, categoryMeta, sumCashMonthly } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

interface Member {
  id: string
  relation: string
  age: number
  disability: boolean
  is_pregnant: boolean
  unemployed: boolean
}

const RELATIONS = ['본인', '배우자', '자녀', '부모', '조부모', '형제자매']
let _seq = 0
const uid = () => `m${++_seq}`

function emptyMember(relation = '배우자', age = 40): Member {
  return { id: uid(), relation, age, disability: false, is_pregnant: false, unemployed: false }
}

function toProfile(m: Member, income: number, household: string, childrenAges: number[] = []): UserProfile {
  // '자녀' 나이는 부모(본인·배우자)에게만 주입 — 자녀 본인/조부모에게 부모용 아동복지가 붙지 않게
  const isParent = m.relation === '본인' || m.relation === '배우자'
  const kids = isParent ? childrenAges : []
  return {
    name: m.relation, age: m.age, gender: 'other', region: '', household_type: household,
    // 장애 체크만으론 중증 단정 불가 → 등급 비움('등록 장애' 일반 분기로만 매칭, 중증 전용 오노출 방지)
    income_percentile: income, disability: m.disability, disability_grade: '',
    employment_status: m.unemployed ? 'unemployed' : '', has_children: kids.length > 0, children_ages: kids,
    is_pregnant: m.is_pregnant, life_events: [],
  }
}

/** 우리 가족 복지 한눈에 — 가구 구성원별 + 가구 전체 고유 정책 */
export function HouseholdAnalyzer({ onOpen }: { onOpen: (p: Policy | EligiblePolicy) => void }) {
  const profile = useAppStore((s) => s.profile)
  const [income, setIncome] = useState<number>(profile?.income_percentile ?? 80)
  const [household, setHousehold] = useState<string>(profile?.household_type || '일반가구')
  const [members, setMembers] = useState<Member[]>(() => {
    const me: Member = {
      id: uid(), relation: '본인', age: profile?.age ?? 40,
      disability: profile?.disability ?? false, is_pregnant: profile?.is_pregnant ?? false,
      unemployed: profile?.employment_status === 'unemployed',
    }
    return [me, emptyMember('배우자', 40)]
  })

  const analysis = useMemo(() => {
    // 미성년 '자녀' 구성원의 나이를 모아 부모 프로필에 주입 — 아동수당·부모급여 등이 매칭되게(구조적 누락 수정)
    const childrenAges = members.filter((m) => m.relation === '자녀' && m.age < 18).map((m) => m.age)
    const per = members.map((m) => {
      const elig = getEligiblePolicies(toProfile(m, income, household, childrenAges))
      // 현금성만 합산 — 서비스 한도·바우처를 가구 현금소득처럼 부풀리지 않는다(정직성).
      const monthly = sumCashMonthly(elig)
      return { member: m, elig, monthly }
    })
    const uniq = new Map<string, EligiblePolicy>()
    per.forEach((r) => r.elig.forEach((p) => uniq.set(p.id, p)))
    // 가구 단위 급여(생계·주거 등)를 구성원 수만큼 중복 합산하지 않도록 — 고유 정책 기준 1회만 현금성 합계(정직성)
    const refTotal = sumCashMonthly([...uniq.values()])
    return { per, uniqueCount: uniq.size, refTotal }
  }, [members, income, household])

  const update = (id: string, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold flex items-center gap-2"><Users className="h-5 w-5 text-sky2-500" /> 우리 가족 복지 한눈에</h2>
      <p className="text-sm text-muted-foreground mt-1">가구 구성원을 더하면 가족 전체가 받을 수 있는 복지를 한 번에 확인해요. 복지는 가구 단위가 많아요.</p>

      {/* 가구 공통 */}
      <div className="mt-3 card-cute p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-bold text-muted-foreground">가구 소득(중위)</span>
        {[25, 50, 80, 120].map((v) => (
          <button key={v} onClick={() => setIncome(v)} className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold border', income === v ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100')}>{v}%</button>
        ))}
        <span className="ml-2 text-xs font-bold text-muted-foreground">가구 형태</span>
        <select aria-label="가구 형태" value={household} onChange={(e) => setHousehold(e.target.value)} className="rounded-lg border border-sprout-100 px-2 py-1 text-xs">
          {['일반가구', '한부모가족', '다문화가족', '조손가구', '1인가구'].map((h) => <option key={h}>{h}</option>)}
        </select>
      </div>

      {/* 가구 요약 */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="card-cute px-3 py-3 text-center"><p className="text-xl font-extrabold gradient-text">{members.length}명</p><p className="text-[11px] text-muted-foreground">가구 구성원</p></div>
        <div className="rounded-2xl px-3 py-3 text-center bg-gradient-to-br from-sky2-700 to-sprout-700 text-white"><p className="text-xl font-extrabold">{analysis.uniqueCount}종</p><p className="text-[11px] text-white">가구 전체 복지</p></div>
        <div className="card-cute px-3 py-3 text-center"><p className="text-xl font-extrabold text-sprout-700">{analysis.refTotal > 0 ? formatWon(analysis.refTotal) : '-'}</p><p className="text-[11px] text-muted-foreground">참고 합산/월</p></div>
      </div>

      {/* 구성원별 */}
      <div className="mt-3 space-y-3">
        <AnimatePresence>
          {analysis.per.map(({ member: m, elig, monthly }) => (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="card-cute p-4">
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="가구 구성원 관계" value={m.relation} onChange={(e) => update(m.id, { relation: e.target.value })} className="rounded-lg border border-sprout-100 px-2 py-1 text-sm font-bold">
                  {RELATIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <label className="text-xs text-muted-foreground flex items-center gap-1">만
                  <input type="number" min={0} max={120} value={m.age} onChange={(e) => update(m.id, { age: +e.target.value })} className="w-16 rounded-lg border border-sprout-100 px-2 py-1 text-sm" />세
                </label>
                {(['disability', 'is_pregnant', 'unemployed'] as const).map((k) => (
                  <button key={k} onClick={() => update(m.id, { [k]: !m[k] })} className={cn('rounded-lg px-2.5 py-1 text-[11px] font-semibold border', m[k] ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground')}>
                    {k === 'disability' ? '장애' : k === 'is_pregnant' ? '임신' : '미취업'}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs font-extrabold text-sprout-700">복지 {elig.length}개{monthly > 0 ? ` · 월 ${formatWon(monthly)}` : ''}</span>
                  {members.length > 1 && (
                    <button onClick={() => setMembers((ms) => ms.filter((x) => x.id !== m.id))} aria-label="구성원 삭제" className="rounded-full p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
              {elig.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {elig.slice(0, 5).map((p) => (
                    <button key={p.id} onClick={() => onOpen(p)} className="chip bg-muted hover:bg-sprout-100 transition-colors">
                      {categoryMeta(p.category).emoji} {p.name} <ChevronRight className="h-3 w-3" />
                    </button>
                  ))}
                  {elig.length > 5 && <span className="chip bg-muted text-muted-foreground">+{elig.length - 5}</span>}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <button onClick={() => setMembers((ms) => [...ms, emptyMember()])} className="btn-secondary mt-3 w-full"><Plus className="h-4 w-4" /> 가구 구성원 추가</button>
      <p className="mt-2 text-[11px] text-muted-foreground">※ ‘참고 합산’은 가구 전체 <b>고유 복지</b>의 현금성 월 합계예요(같은 급여 중복 제거). 생계급여 등 가구 단위 급여는 실제 수급액이 다를 수 있어요.</p>
    </section>
  )
}
