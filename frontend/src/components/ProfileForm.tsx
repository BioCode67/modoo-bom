import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserProfile } from '@/types'
import { UserCircle2, Sparkles } from 'lucide-react'

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

const DEMO_PROFILES: { label: string; profile: Partial<UserProfile> }[] = [
  {
    label: '독거 노인 (72세)',
    profile: { name: '박순자', age: 72, gender: 'female', region: '경기도', household_type: '단독가구', income_percentile: 35, employment_status: 'retired', life_events: ['만65세'] },
  },
  {
    label: '청년 취준생 (26세)',
    profile: { name: '이민준', age: 26, gender: 'male', region: '서울특별시', household_type: '단독가구', income_percentile: 55, employment_status: 'unemployed', life_events: ['실직'] },
  },
  {
    label: '신혼 출산 가정 (32세)',
    profile: { name: '김지연', age: 32, gender: 'female', region: '인천광역시', household_type: '부부가구', income_percentile: 80, is_pregnant: false, has_children: true, children_ages: [0], life_events: ['출산'] },
  },
  {
    label: '중증장애인 (45세)',
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

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }))

  const toggleLifeEvent = (event: string) =>
    set('life_events', profile.life_events.includes(event)
      ? profile.life_events.filter((e) => e !== event)
      : [...profile.life_events, event])

  const applyDemo = (partial: Partial<UserProfile>) =>
    setProfile({ ...DEFAULT_PROFILE, ...partial })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(profile)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-primary" />
          프로필 입력
        </CardTitle>
        <CardDescription>정확한 정보를 입력할수록 맞춤 복지 추천 정확도가 높아집니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 데모 프로필 */}
        <div className="mb-5">
          <p className="text-xs text-muted-foreground mb-2 font-medium">빠른 데모 프로필</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_PROFILES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => applyDemo(d.profile)}
                className="rounded-full border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 이름 / 나이 / 성별 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">이름</Label>
              <Input id="name" placeholder="홍길동" value={profile.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="age">나이</Label>
              <Input id="age" type="number" min={0} max={120} placeholder="35" value={profile.age || ''} onChange={(e) => set('age', Number(e.target.value))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gender">성별</Label>
              <Select
                id="gender"
                value={profile.gender}
                onChange={(e) => set('gender', e.target.value as UserProfile['gender'])}
                options={[{ value: 'male', label: '남성' }, { value: 'female', label: '여성' }, { value: 'other', label: '기타' }]}
              />
            </div>
          </div>

          {/* 지역 / 가구유형 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>거주 지역</Label>
              <Select value={profile.region} onChange={(e) => set('region', e.target.value)} options={REGIONS} placeholder="지역 선택" />
            </div>
            <div className="space-y-1.5">
              <Label>가구 유형</Label>
              <Select value={profile.household_type} onChange={(e) => set('household_type', e.target.value)} options={HOUSEHOLD_TYPES} placeholder="가구 유형" />
            </div>
          </div>

          {/* 소득 / 고용 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="income">기준 중위소득 (%)</Label>
              <Input id="income" type="number" min={0} max={300} placeholder="50" value={profile.income_percentile || ''} onChange={(e) => set('income_percentile', Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">예: 50 → 중위소득 50% 이하</p>
            </div>
            <div className="space-y-1.5">
              <Label>고용 상태</Label>
              <Select value={profile.employment_status} onChange={(e) => set('employment_status', e.target.value)} options={EMPLOYMENT} placeholder="선택" />
            </div>
          </div>

          {/* 장애 */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary"
                checked={profile.disability} onChange={(e) => set('disability', e.target.checked)} />
              <span className="text-sm">장애 있음</span>
            </label>
            {profile.disability && (
              <Input placeholder="장애 등급 (예: 1급)" className="w-40" value={profile.disability_grade}
                onChange={(e) => set('disability_grade', e.target.value)} />
            )}
          </div>

          {/* 자녀 / 임신 */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded"
                checked={profile.has_children} onChange={(e) => set('has_children', e.target.checked)} />
              <span className="text-sm">자녀 있음</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded"
                checked={profile.is_pregnant} onChange={(e) => set('is_pregnant', e.target.checked)} />
              <span className="text-sm">임신 중</span>
            </label>
          </div>

          {/* 생애 이벤트 */}
          <div className="space-y-1.5">
            <Label>최근 생애 이벤트 (복수 선택)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {LIFE_EVENT_OPTIONS.map((evt) => (
                <button
                  key={evt}
                  type="button"
                  onClick={() => toggleLifeEvent(evt)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    profile.life_events.includes(evt)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {evt}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={disabled} className="w-full gap-2" size="lg">
            <Sparkles className="h-4 w-4" />
            {disabled ? 'AI 분석 중...' : 'AI 복지 분석 시작'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
