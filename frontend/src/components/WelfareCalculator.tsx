import { useState, useMemo } from 'react'
import { Calculator, ChevronDown, ChevronUp, Info, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── 정책별 급여 데이터 (2024년 기준) ── */
const POLICIES = [
  {
    id: 'basic_pension',
    name: '기초연금',
    category: '노인',
    maxAmount: 334810,
    unit: '월',
    condition: (p: CalcProfile) => p.age >= 65 && p.income <= 50,
    calcAmount: (p: CalcProfile) => p.income <= 40 ? 334810 : Math.round(334810 * (1 - (p.income - 40) / 20)),
    desc: '만 65세 이상, 소득 하위 70% 해당 시',
    color: 'from-orange-400 to-amber-500',
    bg: 'bg-orange-50 border-orange-200',
    text: 'text-orange-700',
  },
  {
    id: 'child_allowance',
    name: '아동수당',
    category: '아동',
    maxAmount: 100000,
    unit: '월',
    condition: (p: CalcProfile) => p.childrenUnder8 > 0,
    calcAmount: (p: CalcProfile) => p.childrenUnder8 * 100000,
    desc: '만 8세 미만 아동 1인당 10만원',
    color: 'from-pink-400 to-rose-500',
    bg: 'bg-pink-50 border-pink-200',
    text: 'text-pink-700',
  },
  {
    id: 'parental_benefit_0',
    name: '부모급여 (0세)',
    category: '영유아',
    maxAmount: 1000000,
    unit: '월',
    condition: (p: CalcProfile) => p.hasNewborn0,
    calcAmount: () => 1000000,
    desc: '0세 아동 양육 가구, 월 100만원',
    color: 'from-purple-400 to-violet-500',
    bg: 'bg-purple-50 border-purple-200',
    text: 'text-purple-700',
  },
  {
    id: 'parental_benefit_1',
    name: '부모급여 (1세)',
    category: '영유아',
    maxAmount: 500000,
    unit: '월',
    condition: (p: CalcProfile) => p.hasNewborn1,
    calcAmount: () => 500000,
    desc: '1세 아동 양육 가구, 월 50만원',
    color: 'from-violet-400 to-purple-500',
    bg: 'bg-violet-50 border-violet-200',
    text: 'text-violet-700',
  },
  {
    id: 'first_meeting',
    name: '첫만남이용권',
    category: '출산',
    maxAmount: 2000000,
    unit: '일시금',
    condition: (p: CalcProfile) => p.hasNewbornAny,
    calcAmount: (p: CalcProfile) => p.isSecondChild ? 3000000 : 2000000,
    desc: '출생 아동 1인당 200만원 (둘째 이상 300만원) 바우처',
    color: 'from-teal-400 to-emerald-500',
    bg: 'bg-teal-50 border-teal-200',
    text: 'text-teal-700',
  },
  {
    id: 'disability_benefit',
    name: '장애인연금',
    category: '장애',
    maxAmount: 334810,
    unit: '월',
    condition: (p: CalcProfile) => p.disability && p.disabilityGrade <= 2 && p.income <= 50,
    calcAmount: (p: CalcProfile) => p.income <= 30 ? 334810 : 223870,
    desc: '중증장애인(1~2급), 소득 기준 충족 시',
    color: 'from-blue-400 to-indigo-500',
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-700',
  },
  {
    id: 'youth_savings',
    name: '청년 내일저축계좌',
    category: '청년',
    maxAmount: 30000,
    unit: '월',
    condition: (p: CalcProfile) => p.age >= 19 && p.age <= 34 && p.income <= 100 && p.employed,
    calcAmount: () => 30000,
    desc: '근로 청년 자산형성 지원, 본인 10만원 저축 시 정부 3만원 매칭',
    color: 'from-sky-400 to-blue-500',
    bg: 'bg-sky-50 border-sky-200',
    text: 'text-sky-700',
  },
  {
    id: 'youth_dooyak',
    name: '청년 도약계좌',
    category: '청년',
    maxAmount: 24000,
    unit: '월',
    condition: (p: CalcProfile) => p.age >= 19 && p.age <= 34 && p.income <= 60,
    calcAmount: (p: CalcProfile) => p.income <= 40 ? 24000 : p.income <= 60 ? 20000 : 0,
    desc: '청년 자산형성, 납입 70만원에 정부기여금 최대 24,000원/월',
    color: 'from-emerald-400 to-green-500',
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
  },
  {
    id: 'basic_livelihood',
    name: '기초생활 생계급여',
    category: '저소득',
    maxAmount: 713102,
    unit: '월',
    condition: (p: CalcProfile) => p.income <= 32,
    calcAmount: (p: CalcProfile) => {
      const base = 713102
      const selfIncome = (p.income / 100) * 2228445
      return Math.max(0, Math.round(base - selfIncome))
    },
    desc: '1인 가구 기준, 중위소득 32% 이하 (2024년)',
    color: 'from-red-400 to-rose-500',
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-700',
  },
]

interface CalcProfile {
  age: number
  income: number
  disability: boolean
  disabilityGrade: number
  childrenUnder8: number
  hasNewborn0: boolean
  hasNewborn1: boolean
  hasNewbornAny: boolean
  isSecondChild: boolean
  employed: boolean
}

const DEFAULT_PROFILE: CalcProfile = {
  age: 30,
  income: 60,
  disability: false,
  disabilityGrade: 0,
  childrenUnder8: 0,
  hasNewborn0: false,
  hasNewborn1: false,
  hasNewbornAny: false,
  isSecondChild: false,
  employed: false,
}

export function WelfareCalculator() {
  const [p, setP] = useState<CalcProfile>(DEFAULT_PROFILE)
  const [expanded, setExpanded] = useState<string | null>(null)

  const set = <K extends keyof CalcProfile>(key: K, value: CalcProfile[K]) =>
    setP((prev) => ({ ...prev, [key]: value }))

  const eligible = useMemo(() => {
    return POLICIES
      .filter((pol) => pol.condition(p))
      .map((pol) => ({
        ...pol,
        amount: pol.calcAmount(p),
      }))
      .sort((a, b) => {
        const aMonthly = a.unit === '월' ? a.amount : a.amount / 12
        const bMonthly = b.unit === '월' ? b.amount : b.amount / 12
        return bMonthly - aMonthly
      })
  }, [p])

  const monthlyTotal = useMemo(() => {
    return eligible.reduce((sum, pol) => {
      return sum + (pol.unit === '월' ? pol.amount : 0)
    }, 0)
  }, [eligible])

  const annualTotal = useMemo(() => {
    return eligible.reduce((sum, pol) => {
      return sum + (pol.unit === '월' ? pol.amount * 12 : pol.amount)
    }, 0)
  }, [eligible])

  return (
    <div className="space-y-6">
      {/* 상단 헤더 */}
      <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100">
        <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-500/30">
          <Calculator className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-sm">복지 혜택 계산기</h3>
          <p className="text-xs text-muted-foreground">조건을 설정하면 수혜 가능한 금액을 바로 확인합니다 (2024년 기준)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 왼쪽: 조건 설정 */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">조건 설정</p>

          {/* 나이 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">나이</label>
              <span className="text-sm font-bold text-primary">{p.age}세</span>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={p.age}
              onChange={(e) => set('age', Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0세</span><span>34세 (청년)</span><span>65세 (노인)</span><span>100세</span>
            </div>
          </div>

          {/* 소득 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">기준 중위소득</label>
              <span className="text-sm font-bold text-primary">{p.income}%</span>
            </div>
            <input
              type="range" min={0} max={200} step={5}
              value={p.income}
              onChange={(e) => set('income', Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span><span>32% (기초)</span><span>50%</span><span>100%</span><span>200%</span>
            </div>
          </div>

          {/* 고용 상태 */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">고용 상태</label>
            <div className="flex gap-2">
              {[{ v: true, l: '취업 중' }, { v: false, l: '미취업' }].map(({ v, l }) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => set('employed', v)}
                  className={cn(
                    'flex-1 rounded-xl border py-2.5 text-sm font-medium transition-all',
                    p.employed === v ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 장애 */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-primary"
                checked={p.disability}
                onChange={(e) => set('disability', e.target.checked)}
              />
              <span className="text-sm font-medium">장애 있음</span>
            </label>
            {p.disability && (
              <div className="space-y-1.5 pl-6">
                <label className="text-xs font-medium text-muted-foreground">장애 등급</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set('disabilityGrade', g)}
                      className={cn(
                        'h-8 w-8 rounded-lg text-xs font-bold border transition-all',
                        p.disabilityGrade === g ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {g}급
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 자녀 */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
            <p className="text-sm font-semibold">자녀 현황</p>
            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground cursor-pointer">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={p.hasNewborn0}
                    onChange={(e) => set('hasNewborn0', e.target.checked)}
                  />
                  0세 영아 있음 (부모급여 100만원)
                </span>
              </label>
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground cursor-pointer">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={p.hasNewborn1}
                    onChange={(e) => set('hasNewborn1', e.target.checked)}
                  />
                  1세 영아 있음 (부모급여 50만원)
                </span>
              </label>
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground cursor-pointer">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={p.hasNewbornAny}
                    onChange={(e) => set('hasNewbornAny', e.target.checked)}
                  />
                  최근 출생아 있음 (첫만남이용권)
                </span>
              </label>
              {p.hasNewbornAny && (
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer pl-4">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={p.isSecondChild}
                    onChange={(e) => set('isSecondChild', e.target.checked)}
                  />
                  둘째 이상 (300만원 바우처)
                </label>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">만 8세 미만 자녀</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => set('childrenUnder8', Math.max(0, p.childrenUnder8 - 1))}
                    className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold hover:bg-muted/50 transition-colors"
                  >
                    −
                  </button>
                  <span className="text-sm font-bold w-4 text-center">{p.childrenUnder8}</span>
                  <button
                    type="button"
                    onClick={() => set('childrenUnder8', Math.min(10, p.childrenUnder8 + 1))}
                    className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold hover:bg-muted/50 transition-colors"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">명</span>
              </div>
            </div>
          </div>
        </div>

        {/* 오른쪽: 결과 */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">예상 혜택 금액</p>

          {/* 합계 카드 */}
          <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-5 shadow-lg shadow-blue-500/20">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-yellow-300" />
              <span className="text-sm font-semibold text-blue-100">총 예상 수혜 금액</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-blue-200 text-sm">월 수령</span>
                <span className="text-3xl font-extrabold text-white">
                  {monthlyTotal.toLocaleString()}원
                  <span className="text-base font-normal text-blue-300 ml-1">/월</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-white/10 pt-2">
                <span className="text-blue-200 text-xs">연간 합산 (일시금 포함)</span>
                <span className="text-lg font-bold text-yellow-300">
                  {annualTotal.toLocaleString()}원
                </span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex h-6 w-6 rounded-full bg-white/20 items-center justify-center">
                <span className="text-xs font-bold">{eligible.length}</span>
              </div>
              <span className="text-xs text-blue-200">수혜 가능 정책 {eligible.length}건</span>
            </div>
          </div>

          {/* 정책 목록 */}
          {eligible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <Info className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">현재 조건에 맞는 정책이 없습니다.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">조건을 조정해 보세요.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {eligible.map((pol) => (
                <div key={pol.id} className={cn('rounded-2xl border p-4 transition-all cursor-pointer', pol.bg)} onClick={() => setExpanded(expanded === pol.id ? null : pol.id)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn('h-2.5 w-2.5 rounded-full bg-gradient-to-br flex-shrink-0', pol.color)} />
                      <div className="min-w-0">
                        <p className={cn('text-sm font-semibold truncate', pol.text)}>{pol.name}</p>
                        <span className={cn('text-[10px] rounded-full px-1.5 py-0.5 font-medium bg-white/60', pol.text)}>{pol.category}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className={cn('text-base font-extrabold', pol.text)}>
                          {pol.amount.toLocaleString()}원
                        </p>
                        <p className="text-[10px] text-muted-foreground">{pol.unit}</p>
                      </div>
                      {expanded === pol.id
                        ? <ChevronUp className={cn('h-4 w-4', pol.text)} />
                        : <ChevronDown className={cn('h-4 w-4', pol.text)} />}
                    </div>
                  </div>
                  {expanded === pol.id && (
                    <div className="mt-3 pt-3 border-t border-white/40 text-xs text-muted-foreground leading-relaxed animate-fade-in">
                      {pol.desc}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            ※ 실제 지급액은 가구원 수, 재산, 소득 공제 등에 따라 다를 수 있습니다
          </p>
        </div>
      </div>
    </div>
  )
}
