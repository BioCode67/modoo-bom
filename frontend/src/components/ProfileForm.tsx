import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { UserProfile } from '@/types'
import {
  Sparkles, User, Home, Briefcase, ChevronRight, ChevronLeft,
  Baby, Heart, Accessibility, CheckCircle2, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { quickEstimate } from '@/lib/benefit-calc'

const REGIONS = [
  '서울특별시','부산광역시','대구광역시','인천광역시','광주광역시',
  '대전광역시','울산광역시','세종특별자치시','경기도','강원도',
  '충청북도','충청남도','전라북도','전라남도','경상북도','경상남도','제주특별자치도',
].map((r) => ({ value: r, label: r }))

const HOUSEHOLD_TYPES = [
  { value: '단독가구', label: '단독가구 (1인)' },
  { value: '부부가구', label: '부부가구' },
  { value: '한부모가족', label: '한부모가족' },
  { value: '다자녀가구', label: '다자녀가구' },
  { value: '조손가구', label: '조손가구' },
  { value: '일반가구', label: '일반가구' },
]

const EMPLOYMENT = [
  { value: 'employed', label: '취업 (근로자)' },
  { value: 'unemployed', label: '미취업 / 실직' },
  { value: 'self-employed', label: '자영업' },
  { value: 'student', label: '학생' },
  { value: 'retired', label: '은퇴' },
]

const LIFE_EVENT_OPTIONS = [
  { value: '실직', emoji: '💼' },
  { value: '출산', emoji: '👶' },
  { value: '만65세', emoji: '🎂' },
  { value: '임신', emoji: '🤰' },
  { value: '취업', emoji: '🏢' },
  { value: '장애진단', emoji: '♿' },
  { value: '입학', emoji: '🎓' },
  { value: '결혼', emoji: '💍' },
]

const DEMO_PROFILES: { label: string; emoji: string; desc: string; color: string; profile: Partial<UserProfile> }[] = [
  {
    label: '독거 노인',
    emoji: '👴',
    desc: '72세 · 경기도 · 은퇴',
    color: 'from-orange-50 to-amber-50 border-orange-200',
    profile: { name: '박순자', age: 72, gender: 'female', region: '경기도', household_type: '단독가구', income_percentile: 35, employment_status: 'retired', life_events: ['만65세'] },
  },
  {
    label: '청년 취준생',
    emoji: '🧑‍💻',
    desc: '26세 · 서울 · 미취업',
    color: 'from-blue-50 to-indigo-50 border-blue-200',
    profile: { name: '이민준', age: 26, gender: 'male', region: '서울특별시', household_type: '단독가구', income_percentile: 55, employment_status: 'unemployed', life_events: ['실직'] },
  },
  {
    label: '신혼 출산',
    emoji: '👶',
    desc: '32세 · 인천 · 영아자녀',
    color: 'from-pink-50 to-rose-50 border-pink-200',
    profile: { name: '김지연', age: 32, gender: 'female', region: '인천광역시', household_type: '부부가구', income_percentile: 80, has_children: true, children_ages: [0], life_events: ['출산'] },
  },
  {
    label: '중증장애인',
    emoji: '♿',
    desc: '45세 · 부산 · 장애1급',
    color: 'from-purple-50 to-violet-50 border-purple-200',
    profile: { name: '최동현', age: 45, gender: 'male', region: '부산광역시', household_type: '일반가구', income_percentile: 40, disability: true, disability_grade: '1급', employment_status: 'unemployed', life_events: ['장애진단'] },
  },
]

const DEFAULT_PROFILE: UserProfile = {
  name: '', age: 0, gender: 'other', region: '', household_type: '',
  income_percentile: 0, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

const STEPS = [
  { label: '기본 정보', icon: User, desc: '이름·나이·거주지' },
  { label: '가구·소득', icon: Home, desc: '가구유형·소득수준' },
  { label: '특수 조건', icon: Heart, desc: '장애·자녀·생애이벤트' },
]

interface Props {
  onSubmit: (profile: UserProfile) => void
  disabled?: boolean
}

export function ProfileForm({ onSubmit, disabled }: Props) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE)
  const [activeDemo, setActiveDemo] = useState<string | null>(null)
  const [showDemo, setShowDemo] = useState(true)

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }))

  const toggleLifeEvent = (event: string) =>
    set('life_events', profile.life_events.includes(event)
      ? profile.life_events.filter((e) => e !== event)
      : [...profile.life_events, event])

  const applyDemo = (d: typeof DEMO_PROFILES[0]) => {
    setActiveDemo(d.label)
    setProfile({ ...DEFAULT_PROFILE, ...d.profile })
    setShowDemo(false)
    setStep(0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step < 2) { setStep(s => s + 1); return }
    onSubmit(profile)
  }

  const canNext = () => {
    if (step === 0) return profile.name.trim() && profile.age > 0 && profile.region
    if (step === 1) return profile.household_type && profile.employment_status
    return true
  }

function BenefitPreview({ profile, step }: { profile: UserProfile; step: number }) {
  const benefits = useMemo(() => {
    if (!profile.age || profile.age === 0) return []
    return quickEstimate(profile).slice(0, 4)
  }, [profile])

  const monthlyTotal = useMemo(
    () => benefits.filter(b => b.unit === '월').reduce((s, b) => s + b.amount, 0),
    [benefits],
  )

  if (benefits.length === 0 || step === 0) return null

  return (
    <div className="mx-5 mb-4 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-3.5 animate-fade-in">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-blue-600" />
          <span className="text-xs font-bold text-blue-900">예상 혜택 미리보기</span>
        </div>
        {monthlyTotal > 0 && (
          <span className="text-xs font-bold text-blue-700">
            월 최대 {monthlyTotal.toLocaleString()}원
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {benefits.map((b) => (
          <span key={b.name} className={cn('inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2.5 py-1 border', b.bg, b.color)}>
            {b.name}
            {b.amount > 0 && (
              <span className="opacity-70">
                {b.unit === '월' ? ` ${b.amount.toLocaleString()}원` : ' (일시금)'}
              </span>
            )}
          </span>
        ))}
      </div>
      <p className="text-[9px] text-blue-400 mt-2">※ 입력 조건 기반 참고 수치 · 실제와 다를 수 있음</p>
    </div>
  )
}

  if (disabled) {
    return (
      <div className="rounded-2xl border border-border/50 bg-muted/30 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">{profile.name || '사용자'}님</p>
            <p className="text-xs text-muted-foreground">{profile.age}세 · {profile.region}</p>
          </div>
          <div className="ml-auto">
            <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-2.5 py-1 font-semibold">분석 중</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" />{profile.employment_status || '-'}</div>
          <div className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5" />{profile.household_type || '-'}</div>
          <div className="flex items-center gap-1.5"><Heart className="h-3.5 w-3.5" />중위소득 {profile.income_percentile}%</div>
          {profile.disability && <div className="flex items-center gap-1.5"><Accessibility className="h-3.5 w-3.5" />장애 {profile.disability_grade}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 데모 프로필 */}
      {showDemo && (
        <div className="animate-fade-in">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">빠른 데모 프로필</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_PROFILES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => applyDemo(d)}
                className={cn(
                  'flex items-center gap-2.5 rounded-2xl border bg-gradient-to-br px-3 py-3 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
                  d.color,
                  activeDemo === d.label && 'ring-2 ring-primary ring-offset-2',
                )}
              >
                <span className="text-2xl shrink-0">{d.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-tight">{d.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{d.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowDemo(false)}
            className="mt-2.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
          >
            직접 입력하기 →
          </button>
        </div>
      )}

      {/* 위저드 폼 */}
      {!showDemo && (
        <div className="rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden animate-fade-in-scale">
          {/* 스텝 인디케이터 */}
          <div className="bg-gradient-to-r from-slate-50 to-white border-b border-border/50 px-5 py-4">
            <div className="flex items-center gap-0">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                const done = i < step
                const active = i === step
                return (
                  <div key={i} className="flex items-center flex-1">
                    <button
                      type="button"
                      onClick={() => i < step && setStep(i)}
                      className={cn(
                        'flex items-center gap-2 shrink-0 transition-all duration-200',
                        i < step ? 'cursor-pointer' : 'cursor-default',
                      )}
                    >
                      <div className={cn(
                        'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300',
                        done ? 'bg-primary text-white shadow-sm shadow-primary/40' :
                        active ? 'bg-primary/15 text-primary ring-2 ring-primary/40' :
                        'bg-muted text-muted-foreground',
                      )}>
                        {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                      </div>
                      <div className="hidden sm:block text-left">
                        <p className={cn('text-xs font-semibold leading-none', active ? 'text-primary' : done ? 'text-foreground' : 'text-muted-foreground')}>
                          {s.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
                      </div>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={cn('flex-1 h-0.5 mx-3 rounded-full transition-all duration-500', i < step ? 'bg-primary' : 'bg-border')} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 폼 콘텐츠 */}
          <form onSubmit={handleSubmit}>
            <div className="px-5 py-5 min-h-[260px]">
              {/* STEP 0: 기본 정보 */}
              {step === 0 && (
                <div className="space-y-4 animate-fade-in">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs font-semibold">이름</Label>
                      <Input
                        id="name"
                        placeholder="홍길동"
                        value={profile.name}
                        onChange={(e) => set('name', e.target.value)}
                        required
                        className="h-10 text-sm rounded-xl"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="age" className="text-xs font-semibold">나이</Label>
                      <Input
                        id="age"
                        type="number"
                        min={0} max={120}
                        placeholder="35"
                        value={profile.age || ''}
                        onChange={(e) => set('age', Number(e.target.value))}
                        required
                        className="h-10 text-sm rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">성별</Label>
                    <div className="flex gap-2">
                      {[{ value: 'male', label: '남성', emoji: '👨' }, { value: 'female', label: '여성', emoji: '👩' }, { value: 'other', label: '기타', emoji: '🧑' }].map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => set('gender', g.value as UserProfile['gender'])}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition-all duration-150',
                            profile.gender === g.value
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'border-border hover:border-primary/40 text-muted-foreground',
                          )}
                        >
                          <span>{g.emoji}</span>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">거주 지역</Label>
                    <Select
                      value={profile.region}
                      onChange={(e) => set('region', e.target.value)}
                      options={REGIONS}
                      placeholder="거주 지역 선택"
                    />
                  </div>
                </div>
              )}

              {/* STEP 1: 가구·소득 */}
              {step === 1 && (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">가구 유형</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {HOUSEHOLD_TYPES.map((h) => (
                        <button
                          key={h.value}
                          type="button"
                          onClick={() => set('household_type', h.value)}
                          className={cn(
                            'rounded-xl border py-2 px-2 text-[11px] font-medium transition-all duration-150 text-center',
                            profile.household_type === h.value
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'border-border hover:border-primary/40 text-muted-foreground',
                          )}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">고용 상태</Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {EMPLOYMENT.map((e) => (
                        <button
                          key={e.value}
                          type="button"
                          onClick={() => set('employment_status', e.value)}
                          className={cn(
                            'rounded-xl border py-2.5 px-3 text-xs font-medium transition-all duration-150 text-left',
                            profile.employment_status === e.value
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'border-border hover:border-primary/40 text-muted-foreground',
                          )}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="income" className="text-xs font-semibold">기준 중위소득 (%)</Label>
                      <span className="text-xs text-primary font-bold">{profile.income_percentile}%</span>
                    </div>
                    <input
                      id="income"
                      type="range"
                      min={0} max={200} step={5}
                      value={profile.income_percentile}
                      onChange={(e) => set('income_percentile', Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>기초생활 (~30%)</span>
                      <span>중위 (50%)</span>
                      <span>중산층 (100%+)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: 특수 조건 */}
              {step === 2 && (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-2.5">
                    <Label className="text-xs font-semibold">특수 조건 (해당사항 체크)</Label>

                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-primary"
                        checked={profile.disability}
                        onChange={(e) => set('disability', e.target.checked)}
                      />
                      <Accessibility className="h-4 w-4 text-purple-500" />
                      <span className="text-sm font-medium flex-1">장애 있음</span>
                      {profile.disability && (
                        <Input
                          placeholder="등급 (예: 1급)"
                          className="w-28 h-7 text-xs"
                          value={profile.disability_grade}
                          onChange={(e) => set('disability_grade', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </label>

                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-primary"
                        checked={profile.has_children}
                        onChange={(e) => {
                          set('has_children', e.target.checked)
                          if (!e.target.checked) set('children_ages', [])
                        }}
                      />
                      <Baby className="h-4 w-4 text-pink-500" />
                      <span className="text-sm font-medium flex-1">자녀 있음</span>
                    </label>

                    {profile.has_children && (
                      <div className="ml-4 pl-4 border-l-2 border-primary/20">
                        <Label className="text-[11px] text-muted-foreground">자녀 나이 (쉼표 구분, 예: 3, 7, 12)</Label>
                        <Input
                          placeholder="3, 7, 12"
                          value={profile.children_ages.join(', ')}
                          onChange={(e) => {
                            const ages = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 0)
                            set('children_ages', ages)
                          }}
                          className="h-9 text-sm mt-1 rounded-xl"
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-primary"
                        checked={profile.is_pregnant}
                        onChange={(e) => set('is_pregnant', e.target.checked)}
                      />
                      <Heart className="h-4 w-4 text-rose-500" />
                      <span className="text-sm font-medium">임신 중</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">최근 생애 이벤트</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {LIFE_EVENT_OPTIONS.map(({ value, emoji }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleLifeEvent(value)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150',
                            profile.life_events.includes(value)
                              ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30'
                              : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          <span>{emoji}</span>
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 실시간 예상 혜택 미리보기 */}
            <BenefitPreview profile={profile} step={step} />

            {/* 하단 버튼 */}
            <div className="flex gap-3 px-5 pb-5">
              {step === 0 ? (
                <button
                  type="button"
                  onClick={() => setShowDemo(true)}
                  className="px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← 데모 선택
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep(s => s - 1)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                  이전
                </button>
              )}
              <button
                type="submit"
                disabled={!canNext()}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-150',
                  step < 2
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20 disabled:opacity-50'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/30 disabled:opacity-50',
                )}
              >
                {step < 2 ? (
                  <>다음 <ChevronRight className="h-4 w-4" /></>
                ) : (
                  <><Sparkles className="h-4 w-4" />AI 복지 분석 시작</>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
