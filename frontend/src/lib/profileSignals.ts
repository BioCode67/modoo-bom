import type { UserProfile } from './welfare-engine'

/**
 * 프로필에서 사람이 읽을 수 있는 '상황 신호'를 뽑아낸다(에이전트가 무엇을 근거로 판단하는지 투명하게).
 * 분석 오버레이(파악 단계)와 결과 화면의 '이렇게 이해했어요' 칩이 같은 로직을 공유(표기 일관).
 * 우선순위 순으로 정렬해 상위 몇 개만 노출 — 겹치는 신호(한부모↔가구원문)는 중복 제거한다.
 */
export function profileSignals(profile: UserProfile): string[] {
  const s: string[] = []
  if (profile.age >= 65) s.push('어르신')
  else if (profile.age >= 19 && profile.age <= 34) s.push('청년')

  if (profile.income_percentile <= 50) s.push('저소득')
  if (profile.disability) s.push('장애')
  if (profile.is_pregnant) s.push('임신')
  if (profile.has_children) {
    const n = (profile.children_ages || []).length
    s.push(n >= 2 ? `자녀 ${n}명 양육` : '자녀 양육')
  }
  if (profile.employment_status === 'unemployed') s.push('구직 중')
  else if (profile.employment_status === 'student') s.push('학생')

  // 가구 유형: 이미 유도된 신호(한부모·다문화 등)와 의미가 겹치면 원문 추가를 생략(중복 방지)
  const ht = profile.household_type || ''
  if (/한부모|조손/.test(ht)) s.push('한부모·조손')
  else if (ht.includes('다문화')) s.push('다문화')
  else if (ht) s.push(ht)

  // 생애 이벤트 중 앞선 신호와 안 겹치는 것만(질병은 별도 신호가 없어 추가 가치가 큼)
  const ev = profile.life_events || []
  if (ev.includes('질병')) s.push('질병·의료비')
  // 상태 기반 대상군(사각지대) — 파악한 자격군을 명시해 '관련 복지'의 근거를 투명하게
  if (ev.includes('북한이탈')) s.push('북한이탈주민')
  if (ev.includes('보훈')) s.push('국가유공·보훈')
  if (ev.includes('자립준비')) s.push('자립준비청년')
  if (ev.includes('가정폭력')) s.push('폭력 피해 지원')

  return [...new Set(s)]
}
