import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly, formatWon } from '@/lib/format'

export interface GuideOption { label: string; value: string }
export interface GuideStep { id: 'age' | 'situations' | 'income'; question: string; multi?: boolean; options: GuideOption[] }

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'age',
    question: '어떤 분의 복지를 찾고 계세요? 연령대를 골라주세요. 👵🧑👶',
    options: [
      { label: '영유아 (0~6세)', value: '3' },
      { label: '아동·청소년 (7~18세)', value: '14' },
      { label: '청년 (19~34세)', value: '27' },
      { label: '중장년 (35~64세)', value: '50' },
      { label: '어르신 (65세 이상)', value: '70' },
    ],
  },
  {
    id: 'situations',
    question: '해당되는 상황을 모두 골라주세요. (여러 개 가능)',
    multi: true,
    options: [
      { label: '임신·출산', value: 'birth' },
      { label: '장애가 있어요', value: 'disability' },
      { label: '실직·구직 중', value: 'unemployed' },
      { label: '한부모 가정', value: 'singleparent' },
      { label: '자녀 양육 중', value: 'children' },
      { label: '특별한 상황 없음', value: 'none' },
    ],
  },
  {
    id: 'income',
    question: '소득 수준은 어느 정도세요? 💰',
    options: [
      { label: '낮은 편 (중위 50% 이하)', value: '30' },
      { label: '보통 (중위 100% 안팎)', value: '80' },
      { label: '여유 있는 편', value: '150' },
    ],
  },
]

export interface GuideAnswers { age?: number; situations: string[]; income?: number }

export function buildProfile(a: GuideAnswers): UserProfile {
  const s = new Set(a.situations)
  const age = a.age ?? 30
  return {
    name: '', age, gender: 'other', region: '',
    household_type: s.has('singleparent') ? '한부모가족' : '',
    income_percentile: a.income ?? 80,
    disability: s.has('disability'),
    disability_grade: s.has('disability') ? '1급' : '',
    employment_status: s.has('unemployed') ? 'unemployed' : '',
    has_children: s.has('children'),
    children_ages: s.has('children') ? [5] : [],
    is_pregnant: s.has('birth'),
    life_events: [
      ...(s.has('birth') ? ['출산'] : []),
      ...(s.has('unemployed') ? ['실직'] : []),
      ...(s.has('disability') ? ['장애진단'] : []),
    ],
  }
}

export function recommend(a: GuideAnswers): { text: string; policies: EligiblePolicy[] } {
  const elig = getEligiblePolicies(buildProfile(a))
  if (elig.length === 0) {
    return { text: '입력하신 조건으로는 딱 맞는 정책을 바로 찾지 못했어요. 😅 "내 복지 찾기"에서 더 자세히 입력하거나 ☎129 무료 상담을 이용해 보세요.', policies: [] }
  }
  const top = elig.slice(0, 5)
  const total = top.reduce((sum, p) => sum + parseMonthly(p.benefit), 0)
  const lines = top.map((p) => {
    const m = parseMonthly(p.benefit)
    return `• ${p.name}${m > 0 ? ` (월 ${formatWon(m)}까지)` : ''}`
  })
  return {
    text: `조건에 맞는 복지를 ${elig.length}개 찾았어요! 추천 ${top.length}가지는 👇\n${lines.join('\n')}` +
      (total > 0 ? `\n\n예상 월 합계는 약 ${formatWon(total)}이에요.` : '') +
      '\n\n아래 정책을 눌러 자세히 보거나, "내 복지 찾기"에서 정밀 분석을 받아보세요.',
    policies: top,
  }
}
