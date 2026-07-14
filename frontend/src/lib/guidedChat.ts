import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly, formatWon, isCashBenefit, sumCashMonthly } from '@/lib/format'

export interface GuideOption { label: string; value: string }
export interface GuideStep { id: 'age' | 'situations' | 'income'; question: string; multi?: boolean; options: GuideOption[] }

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'age',
    question: '어떤 분의 복지를 찾고 계세요? 아래에 성함과 정확한 나이를 입력하시면 더 정밀해요(나중에 서류 발급·신청 자동입력에도 쓰여요). 대략만 고르셔도 돼요. 👵🧑👶',
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

export interface GuideAnswers { name?: string; age?: number; situations: string[]; income?: number }

export function buildProfile(a: GuideAnswers): UserProfile {
  const s = new Set(a.situations)
  const age = a.age ?? 30
  return {
    name: (a.name || '').trim(), age, gender: 'other', region: '',
    household_type: s.has('singleparent') ? '한부모가족' : '',
    income_percentile: a.income ?? 80,
    // 소득을 답하지 않았으면 '모름'을 명시 — 기본 80이 확정 소득으로 취급되면 생계·의료급여가
    // 하드배제되고 요약이 80%를 단정한다(위저드와 동일 결함, 12차 감사 자매 케이스). parseQuery와 대칭.
    income_known: a.income !== undefined,
    disability: s.has('disability'),
    // ⚠️ 장애 정도를 '1급'으로 단정하지 않는다 — 그러면 경증 사용자에게도 중증(1·2급) 전용 장애인연금이
    //   자격 있는 것처럼 과장된다. 미상('')으로 두면 일반 장애 복지는 그대로 뜨고 중증 전용만 정밀 분석으로 넘긴다.
    disability_grade: '',
    employment_status: s.has('unemployed') ? 'unemployed' : '',
    has_children: s.has('children'),
    // 자녀 나이 미상 → 대표값(만 5세) 가정. recommend()에서 이 가정을 사용자에게 명시 고지(날조 아님).
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
  // 현금성만 합산해 '예상 월 합계'가 서비스 한도·바우처까지 부풀지 않게(정직성) + per-item도 현금성일 때만 금액 표기.
  const total = sumCashMonthly(top)
  const lines = top.map((p) => {
    const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
    return `• ${p.name}${m > 0 ? ` (월 ${formatWon(m)}까지)` : ''}`
  })
  // 가이드 상담은 세부 조건을 다 묻지 않으므로, 가정한 부분을 사용자에게 솔직히 고지한다(과장·날조 방지).
  const notes: string[] = []
  if (a.situations.includes('children')) notes.push('자녀 나이를 만 5세로 가정해 계산했어요')
  if (a.situations.includes('disability')) notes.push('장애 정도(중증 여부)는 반영하지 않았어요 — 중증(1·2급)이면 장애인연금 등이 더 있어요')
  const noteText = notes.length ? `\n\n※ ${notes.join(' · ')}. 정밀 분석에서 정확히 확인하세요.` : ''
  return {
    text: `조건에 맞는 복지를 ${elig.length}개 찾았어요! 추천 ${top.length}가지는 👇\n${lines.join('\n')}` +
      (total > 0 ? `\n\n월 최대 ${formatWon(total)}까지 받을 수 있어요(중복지원 제한·실제 자격은 미반영한 최대치).` : '') +
      noteText +
      '\n\n마음에 드는 건 아래에서 바로 담아두세요("다 담아줘"라고 하셔도 돼요). 더 정확히는 정밀 분석으로!',
    policies: top,
  }
}
