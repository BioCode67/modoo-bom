import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserProfile } from '@/types'
import { Sparkles, User } from 'lucide-react'
import { cn } from '@/lib/utils'

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

const LIFE_EVENT_OPTIONS = ['실직', '출산', '만65세', '임신', '취업', '장애진단', '입학', '결혼']

const DEMO_PROFILES: { label: string; emoji: string; desc: string; profile: Partial<UserProfile> }[] = [
  {
    label: '독거 노인',
    emoji: '👴',
    desc: '72세 · 경기도',
    profile: { name: '박순자', age: 72, gender: 'female', region: '경기도', household_type: '단독가구', income_percentile: 35, employment_status: 'retired', life_events: ['만65세'] },
  },
  {
    label: '청년 취준생',
    emoji: '🧑‍💻',
    desc: '26세 · 서울',
    profile: { name: '이민준', age: 26, gender: 'male', region: '서울특별시', household_type: '단독가구', income_percentile: 55, employment_status: 'unemployed', life_events: ['실직'] },
  },
  {
    label: '신혼 출산',
    emoji: '👶',
    desc: '32세 · 인천',
    profile: { name: '김지연', age: 32, gender: 'female', region: '인천광역시', household_type: '부부가구', income_percentile: 80, has_children: true, children_ages: [0], life_events: ['출산'] },
  },
  {
    label: '중증장애인',
    emoji: '♿',
    desc: '45세 · 부산',
    profile: { name: '최동현', age: 45, gender: 'male', region: '부산광역시', household_type: '일반가구', income_percentile: 40, disability: true, disability_grade: '1급', employment_status: 'unemployed', life_events: ['장애진단'] },
  },
]

const DEFAULT_PROFILE: UserProfile = {
  name: '', age: 0, gender: 'other', region: '', household_type: '',
  income_percentile: 0, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

interface Props {
  onSubmit: (profile: UserProfile) => void
  disabled?: boolean
}

export function ProfileForm({ onSubmit, disabled }: Props) {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE)
  const [activeDemo, setActiveDemo] = useState<string | null>(null)

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }))

  const toggleLifeEvent = (event: string) =>
    set('life_events', profile.life_events.includes(event)
      ? profile.life_events.filter((e) => e !== event)
      : [...profile.life_events, event])

  const applyDemo = (d: typeof DEMO_PROFILES[0]) => {
    setActiveDemo(d.label)
    setProfile({ ...DEFAULT_PROFILE, ...d.profile })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(profile)
  }

  const sectionLabel = (text: string) => (
    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{text}</p>
  )

  return (
    <Card className="border-0 shadow-md shadow-black/5">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4 text-primary" />
          프로필 입력
        </CardTitle>
        <p className="text-xs text-muted-foreground">정확한 정보일수록 맞춤 복지 정확도가 높아집니다.</p>
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {/* 데모 프로필 */}
        <div className="mb-5">
          {sectionLabel('빠른 데모 프로필')}
          <div className="grid grid-cols-2 gap-2">
            {DEMO_PROFILES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => applyDemo(d)}
                disabled={disabled}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
                  activeDemo === d.label
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50',
                )}
              >
                <span className="text-xl shrink-0">{d.emoji}</span>
                <div className="min-w-0">
                  <p className={cn('text-xs font-semibold leading-tight', activeDemo === d.label ? 'text-primary' : 'text-foreground')}>
                    {d.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{d.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-border/50 mb-4" />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 기본 정보 */}
          {sectionLabel('기본 정보')}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">이름</Label>
              <Input id="name" placeholder="홍길동" value={profile.name} onChange={(e) => set('name', e.target.value)} disabled={disabled} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="age" className="text-xs">나이</Label>
              <Input id="age" type="number" min={0} max={120} placeholder="35" value={profile.age || ''} onChange={(e) => set('age', Number(e.target.value))} disabled={disabled} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">성별</Label>
              <Select
                value={profile.gender}
                onChange={(e) => set('gender', e.target.value as UserProfile['gender'])}
                options={[{ value: 'male', label: '남성' }, { value: 'female', label: '여성' }, { value: 'other', label: '기타' }]}
                disabled={disabled}
              />
            </div>
          </div>

          {/* 거주 / 가구 */}
          {sectionLabel('거주 및 가구')}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">거주 지역</Label>
              <Select value={profile.region} onChange={(e) => set('region', e.target.value)} options={REGIONS} placeholder="지역 선택" disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">가구 유형</Label>
              <Select value={profile.household_type} onChange={(e) => set('household_type', e.target.value)} options={HOUSEHOLD_TYPES} placeholder="선택" disabled={disabled} />
            </div>
          </div>

          {/* 경제 */}
          {sectionLabel('소득 및 고용')}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="income" className="text-xs">기준 중위소득 (%)</Label>
              <Input id="income" type="number" min={0} max={300} placeholder="50" value={profile.income_percentile || ''} onChange={(e) => set('income_percentile', Number(e.target.value))} disabled={disabled} className="h-9 text-sm" />
              <p className="text-[10px] text-muted-foreground">예: 50 → 중위소득 50% 이하</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">고용 상태</Label>
              <Select value={profile.employment_status} onChange={(e) => set('employment_status', e.target.value)} options={EMPLOYMENT} placeholder="선택" disabled={disabled} />
            </div>
          </div>

          {/* 특수 조건 */}
          {sectionLabel('특수 조건')}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded accent-primary"
                checked={profile.disability} onChange={(e) => set('disability', e.target.checked)} disabled={disabled} />
              <span className="text-sm font-medium">장애 있음</span>
              {profile.disability && (
                <Input placeholder="등급 (예: 1급)" className="ml-auto w-32 h-7 text-xs" value={profile.disability_grade}
                  onChange={(e) => set('disability_grade', e.target.value)} disabled={disabled} />
              )}
            </label>

            <div className="h-px bg-border/40" />

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded accent-primary"
                  checked={profile.has_children} onChange={(e) => {
                    set('has_children', e.target.checked)
                    if (!e.target.checked) set('children_ages', [])
                  }} disabled={disabled} />
                <span className="text-sm font-medium">자녀 있음</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded accent-primary"
                  checked={profile.is_pregnant} onChange={(e) => set('is_pregnant', e.target.checked)} disabled={disabled} />
                <span className="text-sm font-medium">임신 중</span>
              </label>
            </div>

            {profile.has_children && (
              <div className="pl-6">
                <Label className="text-[11px] text-muted-foreground">자녀 나이 (쉼표 구분)</Label>
                <Input
                  placeholder="예: 3, 7, 12"
                  value={profile.children_ages.join(', ')}
                  onChange={(e) => {
                    const ages = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 0)
                    set('children_ages', ages)
                  }}
                  className="h-8 text-sm mt-1"
                  disabled={disabled}
                />
              </div>
            )}
          </div>

          {/* 생애 이벤트 */}
          {sectionLabel('최근 생애 이벤트')}
          <div className="flex flex-wrap gap-1.5">
            {LIFE_EVENT_OPTIONS.map((evt) => (
              <button
                key={evt}
                type="button"
                onClick={() => toggleLifeEvent(evt)}
                disabled={disabled}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
                  profile.life_events.includes(evt)
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {evt}
              </button>
            ))}
          </div>

          <div className="pt-1">
            <Button type="submit" disabled={disabled} className="w-full gap-2 h-11 rounded-xl shadow-sm shadow-primary/20" size="lg">
              <Sparkles className="h-4 w-4" />
              {disabled ? 'AI 분석 중...' : 'AI 복지 분석 시작'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
