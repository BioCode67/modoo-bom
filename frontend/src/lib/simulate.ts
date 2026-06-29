import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly } from '@/lib/format'

export interface FutureScenario {
  key: string
  emoji: string
  label: string
  desc: string
  newPolicies: EligiblePolicy[]
  monthlyGain: number
}

/**
 * 현재 프로필을 기준으로, 앞으로 생길 수 있는 생애 변화별로
 * "새로 받을 수 있는 복지"와 예상 월 증가액을 엔진으로 시뮬레이션한다.
 * (민감한 사건인 장애·질병은 권유하지 않으므로 제외)
 */
export function simulateFuture(profile: UserProfile): FutureScenario[] {
  const baseIds = new Set(getEligiblePolicies(profile).map((p) => p.id))
  const out: FutureScenario[] = []

  const add = (key: string, emoji: string, label: string, desc: string, variant: UserProfile) => {
    const gained = getEligiblePolicies(variant).filter((p) => !baseIds.has(p.id))
    if (gained.length === 0) return
    out.push({
      key, emoji, label, desc,
      newPolicies: gained.slice(0, 6),
      monthlyGain: gained.reduce((s, p) => s + parseMonthly(p.benefit), 0),
    })
  }

  // 출산/육아 — 가임 연령대(만 19~45세)이고 아직 자녀·임신이 없을 때만
  if (!profile.has_children && !profile.is_pregnant && profile.age >= 19 && profile.age <= 45) {
    add('birth', '👶', '아이가 태어나면', '출산·육아 관련 혜택이 새로 열려요',
      { ...profile, has_children: true, children_ages: [0], life_events: [...profile.life_events, '출산'] })
  }

  // 만 65세 도달 — 아직 65세 미만일 때
  if (profile.age < 65) {
    add('senior', '🎂', '만 65세가 되면', '어르신 대상 복지가 시작돼요',
      { ...profile, age: 65 })
  }

  // 실직 — 근로 연령대(만 19~64세)이고 현재 재직/구직중이 아닐 때만 (은퇴자 제외)
  if (profile.age >= 19 && profile.age <= 64 && !['unemployed', 'retired'].includes(profile.employment_status)) {
    add('jobloss', '💼', '갑자기 실직하면', '재취업·생계 지원을 받을 수 있어요',
      { ...profile, employment_status: 'unemployed', life_events: [...profile.life_events, '실직'] })
  }

  // 자녀 학령기 — 영유아 자녀가 있을 때
  if (profile.has_children && profile.children_ages.some((a) => a < 7)) {
    add('school', '🎒', '자녀가 학교에 가면', '교육·돌봄 지원이 추가돼요',
      { ...profile, children_ages: profile.children_ages.map((a) => (a < 7 ? 8 : a)) })
  }

  // 소득이 낮아지면 — 현재 중위소득 50% 초과일 때
  if (profile.income_percentile > 50) {
    add('lowincome', '📉', '소득이 크게 줄면', '저소득층 지원 대상이 될 수 있어요',
      { ...profile, income_percentile: 30 })
  }

  return out
}
