import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, Sparkles, Check, Calculator } from 'lucide-react'
import type { UserProfile } from '@/lib/welfare-engine'
import { IncomeCalculator } from '@/components/IncomeCalculator'
import { cn } from '@/lib/utils'

const EMPTY: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

const DEMOS: { label: string; emoji: string; profile: UserProfile }[] = [
  { label: '독거 어르신', emoji: '👵', profile: { ...EMPTY, name: '김복순', age: 72, gender: 'female', household_type: '1인가구', income_percentile: 25 } },
  { label: '청년 취준생', emoji: '🧑‍💻', profile: { ...EMPTY, name: '이청년', age: 26, gender: 'male', household_type: '1인가구', income_percentile: 55, employment_status: 'unemployed', life_events: ['실직'] } },
  { label: '신혼 출산가정', emoji: '👶', profile: { ...EMPTY, name: '박보람', age: 32, gender: 'female', household_type: '신혼부부', income_percentile: 90, has_children: true, children_ages: [0], life_events: ['출산'] } },
  { label: '중증 장애인', emoji: '♿', profile: { ...EMPTY, name: '정도움', age: 45, gender: 'male', household_type: '1인가구', income_percentile: 35, disability: true, disability_grade: '1급', life_events: ['장애진단'] } },
]

const HOUSEHOLDS = ['1인가구', '신혼부부', '다자녀가구', '한부모가족', '조손가구', '다문화가족', '일반가구']
const EMPLOYMENT = [
  { v: 'employed', l: '재직 중' }, { v: 'unemployed', l: '미취업/구직' },
  { v: 'student', l: '학생' }, { v: 'self', l: '자영업' }, { v: 'retired', l: '은퇴' },
]
const LIFE_EVENTS = ['실직', '출산', '장애진단', '결혼', '이사', '질병', '졸업', '창업']
const INCOME_STEPS = [
  { v: 25, l: '하위 25% 이하' }, { v: 50, l: '중위소득 50%' },
  { v: 80, l: '중위소득 80%' }, { v: 120, l: '중위소득 120%' }, { v: 180, l: '상위권' },
]

export function ProfileWizard({ onSubmit }: { onSubmit: (p: UserProfile) => void }) {
  const [step, setStep] = useState(0)
  const [p, setP] = useState<UserProfile>(EMPTY)
  const [showCalc, setShowCalc] = useState(false)
  const set = (patch: Partial<UserProfile>) => setP((prev) => ({ ...prev, ...patch }))

  const STEPS = ['기본 정보', '가구·소득', '나의 상황']
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const prev = () => setStep((s) => Math.max(s - 1, 0))

  const toggleEvent = (e: string) =>
    set({ life_events: p.life_events.includes(e) ? p.life_events.filter((x) => x !== e) : [...p.life_events, e] })

  return (
    <div className="card-cute p-5 sm:p-7 max-w-xl mx-auto">
      {/* 데모 */}
      {step === 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold text-muted-foreground mb-2">⚡ 빠른 체험 — 클릭하면 자동 입력</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMOS.map((d) => (
              <button
                key={d.label}
                onClick={() => { setP(d.profile); onSubmit(d.profile) }}
                className="flex items-center gap-2 rounded-2xl border-2 border-sprout-100 bg-white px-3 py-2.5 text-sm font-semibold hover:border-sprout-300 hover:bg-sprout-50 transition-all active:scale-95 text-left"
              >
                <span className="text-xl">{d.emoji}</span> {d.label}
              </button>
            ))}
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex-1 dotted-divider" /> 또는 직접 입력 <span className="flex-1 dotted-divider" />
          </div>
        </div>
      )}

      {/* 진행 표시 */}
      <div className="flex items-center gap-2 mb-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
              i < step ? 'bg-sprout-500 text-white' : i === step ? 'bg-sprout-500 text-white ring-4 ring-sprout-100' : 'bg-muted text-muted-foreground')}>
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn('text-xs font-semibold hidden sm:block', i === step ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
            {i < STEPS.length - 1 && <span className={cn('h-0.5 flex-1 rounded', i < step ? 'bg-sprout-400' : 'bg-muted')} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="space-y-5 min-h-[260px]">
          {step === 0 && (
            <>
              <Field label="이름 (선택)">
                <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="홍길동" className="input-cute" />
              </Field>
              <Field label={`나이 — 만 ${p.age}세`}>
                <input type="range" min={0} max={100} value={p.age} onChange={(e) => set({ age: +e.target.value })} className="w-full accent-sprout-500" />
                <input type="number" min={0} max={120} value={p.age} onChange={(e) => set({ age: +e.target.value })} className="input-cute mt-2 w-28" />
              </Field>
              <Field label="성별">
                <div className="grid grid-cols-3 gap-2">
                  {[{ v: 'female', l: '여성' }, { v: 'male', l: '남성' }, { v: 'other', l: '선택안함' }].map((g) => (
                    <Choice key={g.v} active={p.gender === g.v} onClick={() => set({ gender: g.v as UserProfile['gender'] })}>{g.l}</Choice>
                  ))}
                </div>
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field label="가구 형태">
                <div className="flex flex-wrap gap-2">
                  {HOUSEHOLDS.map((h) => (
                    <Choice key={h} active={p.household_type === h} onClick={() => set({ household_type: h })} small>{h}</Choice>
                  ))}
                </div>
              </Field>
              <Field label={`소득 수준 (기준 중위소득${p.income_percentile ? ` · 현재 ${p.income_percentile}%` : ''})`}>
                <div className="flex flex-wrap gap-2">
                  {INCOME_STEPS.map((s) => (
                    <Choice key={s.v} active={p.income_percentile === s.v} onClick={() => set({ income_percentile: s.v })} small>{s.l}</Choice>
                  ))}
                </div>
                <button onClick={() => setShowCalc((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky2-600 hover:underline">
                  <Calculator className="h-3.5 w-3.5" /> 내 소득 %를 모르겠어요 (계산기)
                </button>
                {showCalc && (
                  <div className="mt-2">
                    <IncomeCalculator onApply={(pct) => { set({ income_percentile: pct }); setShowCalc(false) }} />
                  </div>
                )}
              </Field>
              <Field label="거주 지역 (선택)">
                <input value={p.region} onChange={(e) => set({ region: e.target.value })} placeholder="예: 서울특별시" className="input-cute" />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="취업 상태">
                <div className="flex flex-wrap gap-2">
                  {EMPLOYMENT.map((e) => (
                    <Choice key={e.v} active={p.employment_status === e.v} onClick={() => set({ employment_status: e.v })} small>{e.l}</Choice>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Toggle label="🤰 임신 중" on={p.is_pregnant} onClick={() => set({ is_pregnant: !p.is_pregnant })} />
                <Toggle label="👶 자녀 있음" on={p.has_children} onClick={() => set({ has_children: !p.has_children, children_ages: !p.has_children ? [0] : [] })} />
              </div>
              {p.has_children && (
                <Field label="자녀 나이 (쉼표로 구분)">
                  <input
                    defaultValue={p.children_ages.join(', ')}
                    onChange={(e) => set({ children_ages: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) })}
                    placeholder="예: 0, 5"
                    className="input-cute"
                  />
                </Field>
              )}
              <Toggle label="♿ 등록 장애인" on={p.disability} onClick={() => set({ disability: !p.disability, disability_grade: !p.disability ? '1급' : '' })} />
              {p.disability && (
                <Field label="장애 정도">
                  <div className="flex flex-wrap gap-2">
                    {['1급', '2급', '3급', '지적', '자폐', '기타'].map((g) => (
                      <Choice key={g} active={p.disability_grade === g} onClick={() => set({ disability_grade: g })} small>{g}</Choice>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="최근 생애 변화 (해당되면 선택)">
                <div className="flex flex-wrap gap-2">
                  {LIFE_EVENTS.map((e) => (
                    <Choice key={e} active={p.life_events.includes(e)} onClick={() => toggleEvent(e)} small>{e}</Choice>
                  ))}
                </div>
              </Field>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 하단 버튼 */}
      <div className="mt-6 flex gap-2">
        {step > 0 && (
          <button onClick={prev} className="btn-secondary !px-4"><ArrowLeft className="h-4 w-4" /> 이전</button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={next} className="btn-primary flex-1">다음 <ArrowRight className="h-4 w-4" /></button>
        ) : (
          <button onClick={() => onSubmit(p)} className="btn-primary flex-1 text-base !py-3.5">
            <Sparkles className="h-5 w-5" /> 내 복지 분석하기
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-bold mb-2">{label}</label>
      {children}
    </div>
  )
}

function Choice({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl border-2 font-semibold transition-all active:scale-95',
        small ? 'px-3.5 py-2 text-sm' : 'px-4 py-3 text-sm flex-1',
        active ? 'bg-sprout-500 border-sprout-500 text-white shadow-soft' : 'bg-white border-sprout-100 text-foreground hover:border-sprout-200',
      )}
    >
      {children}
    </button>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-between rounded-2xl border-2 px-4 py-3 text-sm font-bold transition-all',
        on ? 'bg-sprout-50 border-sprout-300 text-sprout-700' : 'bg-white border-sprout-100 text-muted-foreground',
      )}
    >
      {label}
      <span className={cn('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-sprout-500' : 'bg-muted')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}
