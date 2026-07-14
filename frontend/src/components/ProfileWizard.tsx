import { useId, useState } from 'react'
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
  // 복지 사각지대(대회 핵심 주제) — 다문화·한부모를 데모로 즉시 시연
  { label: '다문화 가정', emoji: '🌏', profile: { ...EMPTY, name: '흐엉', age: 34, gender: 'female', household_type: '다문화가족', income_percentile: 55, has_children: true, children_ages: [5] } },
  { label: '한부모 가정', emoji: '👩‍👧', profile: { ...EMPTY, name: '최한결', age: 38, gender: 'female', household_type: '한부모가족', income_percentile: 40, has_children: true, children_ages: [8], employment_status: 'employed' } },
]

const HOUSEHOLDS = ['1인가구', '신혼부부', '다자녀가구', '한부모가족', '조손가구', '다문화가족', '일반가구']
const EMPLOYMENT = [
  { v: 'employed', l: '재직 중' }, { v: 'unemployed', l: '미취업/구직' },
  { v: 'student', l: '학생' }, { v: 'self', l: '자영업' }, { v: 'retired', l: '은퇴' },
]
const LIFE_EVENTS = ['실직', '출산', '장애진단', '장애아 자녀', '결혼', '이사', '질병', '가족 사망', '화재·재난', '졸업', '창업']
// 표시는 현행 체계(심한/심하지 않은), 저장값(v)은 판정 엔진 호환을 위해 유지(중증=1급 매칭). 장애등급제는 2019년 폐지됨.
const DISABILITY = [
  { v: '1급', l: '심한 장애 (중증)' }, { v: '4급', l: '심하지 않은 장애 (경증)' },
  { v: '지적', l: '지적장애' }, { v: '자폐', l: '자폐성장애' }, { v: '기타', l: '잘 모르겠어요' },
]
// 라벨은 생활어(쉬운 말) + 괄호에 행정 기준(%)을 병기 — 어르신·저자력층 이해를 돕기 위함
const INCOME_STEPS = [
  { v: 25, l: '소득이 적은 편', sub: '하위 25%' }, { v: 50, l: '가운데보다 낮아요', sub: '중위 50%' },
  { v: 80, l: '가운데쯤이에요', sub: '중위 80%' }, { v: 120, l: '가운데보다 높아요', sub: '중위 120%' }, { v: 180, l: '소득이 많은 편', sub: '상위권' },
]

export function ProfileWizard({ onSubmit }: { onSubmit: (p: UserProfile) => void }) {
  const [step, setStep] = useState(0)
  const [p, setP] = useState<UserProfile>(EMPTY)
  const [showCalc, setShowCalc] = useState(false)
  // 소득은 기본값(80%)이 '이미 선택된 것처럼' 보이면 저소득 사용자가 그대로 넘겨 조용히 오배제된다(감사 반영).
  //   실제로 고르기 전엔 어떤 칩도 활성화하지 않고, 미선택 안내를 띄운다.
  const [incomeTouched, setIncomeTouched] = useState(false)
  const set = (patch: Partial<UserProfile>) => setP((prev) => ({ ...prev, ...patch }))
  const setIncome = (v: number) => { set({ income_percentile: v }); setIncomeTouched(true) }

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
              i < step ? 'bg-sprout-700 text-white' : i === step ? 'bg-sprout-700 text-white ring-4 ring-sprout-100' : 'bg-muted text-muted-foreground')}>
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
                <input aria-label="이름" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="홍길동" className="input-cute" />
              </Field>
              <Field label={`나이 — 만 ${p.age}세`}>
                <input type="range" aria-label={`나이 슬라이더, 현재 만 ${p.age}세`} min={0} max={100} value={p.age} onChange={(e) => set({ age: +e.target.value })} className="w-full accent-sprout-500" />
                <input
                  type="number" aria-label="나이 직접 입력" min={0} max={120} value={p.age}
                  onChange={(e) => {
                    // 빈 값을 0(신생아)으로 저장하지 않는다 — 지우는 중에는 유지, 유효 범위로 클램프(0~120)
                    const v = e.target.value
                    if (v === '') return
                    const n = parseInt(v, 10)
                    if (!Number.isNaN(n)) set({ age: Math.max(0, Math.min(120, n)) })
                  }}
                  // 비운 채로 포커스를 떠나면 표시(빈칸)와 실제 상태(이전 값)가 어긋난다 → 상태값으로 다시 채워 재동기화.
                  onBlur={(e) => { if (e.currentTarget.value === '') e.currentTarget.value = String(p.age) }}
                  className="input-cute mt-2 w-28"
                />
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
              <Field label="우리 집 소득은 어느 정도인가요?">
                <p className="-mt-1 mb-2 text-xs text-muted-foreground leading-relaxed">
                  잘 모르시겠으면 대략만 골라도 돼요. <span className="font-medium text-foreground">중위소득</span>은 전국 가구를
                  소득 순서로 세웠을 때 딱 <span className="font-medium text-foreground">가운데</span>인 소득이에요 — 복지 자격은 보통 이걸 기준으로 정해져요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {INCOME_STEPS.map((s) => (
                    <Choice key={s.v} active={incomeTouched && p.income_percentile === s.v} onClick={() => setIncome(s.v)} small>
                      {s.l} <span className="opacity-60 font-normal">({s.sub})</span>
                    </Choice>
                  ))}
                </div>
                {!incomeTouched && (
                  <p className="mt-2 text-xs font-semibold text-orange-600">👆 소득 구간을 하나 골라주세요 — 안 고르면 ‘중간 소득’으로 분석돼 기초생활·의료급여가 빠질 수 있어요.</p>
                )}
                <button onClick={() => setShowCalc((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky2-700 hover:underline">
                  <Calculator className="h-3.5 w-3.5" /> 내 소득이 어디쯤인지 모르겠어요 (계산기)
                </button>
                {showCalc && (
                  <div className="mt-2">
                    <IncomeCalculator onApply={(pct) => { setIncome(pct); setShowCalc(false) }} />
                  </div>
                )}
              </Field>
              <Field label="거주 지역 (선택 — 우리 동네 지자체 복지를 더 정확히 찾아드려요)">
                <div className="flex flex-wrap gap-1.5">
                  {['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'].map((s) => (
                    <Choice key={s} active={p.region === s} onClick={() => set({ region: p.region === s ? '' : s })} small>{s}</Choice>
                  ))}
                </div>
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
                {/* 나이 미상 자리표시 0세 금지 — 0으로 채우면 신생아 전용 급여가 오추천됨(실제 나이 입력 시 정밀 매칭) */}
                <Toggle label="👶 자녀 있음" on={p.has_children} onClick={() => set({ has_children: !p.has_children, children_ages: [] })} />
              </div>
              {p.has_children && (
                <Field label="자녀 나이 (쉼표로 구분)">
                  <input
                    aria-label="자녀 나이 (쉼표로 구분)"
                    defaultValue={p.children_ages.join(', ')}
                    onChange={(e) => set({ children_ages: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 30) })}
                    placeholder="예: 0, 5"
                    className="input-cute"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">만 나이로 적어주세요. 자녀 대상 복지는 보통 만 18세 이하 기준이라, 그보다 많은 나이는 자동 제외돼요.</p>
                </Field>
              )}
              {/* 기본값은 '기타(잘 모르겠어요)' — '1급(중증)' 자동 주입은 경증 사용자가 그대로 제출하면
                  중증 전용 급여(장애인연금 등)를 확신형으로 오추천했다(12차 감사). 등급미상은 엔진이 조건부로 다룬다. */}
              <Toggle label="♿ 등록 장애인" on={p.disability} onClick={() => set({ disability: !p.disability, disability_grade: !p.disability ? '기타' : '' })} />
              {p.disability && (
                <Field label="장애 정도 (2019년부터 '심한/심하지 않은'으로 바뀌었어요)">
                  <div className="flex flex-wrap gap-2">
                    {DISABILITY.map((d) => (
                      <Choice key={d.v} active={p.disability_grade === d.v} onClick={() => set({ disability_grade: d.v })} small>{d.l}</Choice>
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
          // income_known 전달 — 소득을 안 고른 채 제출하면 기본 80%가 '확정 소득'으로 취급돼
          // 생계·의료급여 등이 하드배제되고 요약이 80%를 사실처럼 단정했다(12차 감사).
          // 한 문장 경로(parseQuery)와 동일하게 '모름'을 알려 조건부 노출·면책 문구가 나오게.
          <button onClick={() => onSubmit({ ...p, income_known: incomeTouched } as UserProfile)} className="btn-primary flex-1 text-base !py-3.5">
            <Sparkles className="h-5 w-5" /> 내 복지 분석하기
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // 선택지가 버튼 묶음이라 <label for>로 묶을 수 없다 → role=group+aria-labelledby로 질문↔답변을 프로그램적으로 연결(WCAG 1.3.1).
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="block text-sm font-bold mb-2">{label}</span>
      {children}
    </div>
  )
}

function Choice({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl border-2 font-semibold transition-all active:scale-95',
        small ? 'px-3.5 py-2 text-sm' : 'px-4 py-3 text-sm flex-1',
        active ? 'bg-sprout-700 border-sprout-700 text-white shadow-soft' : 'bg-white border-sprout-100 text-foreground hover:border-sprout-200',
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
      role="switch"
      aria-checked={on}
      aria-label={label}
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
