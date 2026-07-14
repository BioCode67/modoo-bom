import type { UserProfile, EligiblePolicy } from './welfare-engine'
import type { Policy } from '@/data/policies'

/**
 * 신청 사유서 초안 생성 — 긴급복지·위기지원·장학·민간재단 등은 '신청 사유/상황 설명'을 직접 써야 하는데,
 * 어르신·외국인·저학력층이 가장 막히는 지점이다. 프로필 신호로 정중한 한국어 초안을 '규칙 기반'으로 만든다.
 *
 * 정직성: LLM 없음 → 환각 없음. 사용자가 입력·언급한 신호(life_events·가구·소득·장애·나이 등)만 문장으로 옮긴다.
 * 결과는 '초안'이며 사용자가 확인·수정해 쓰도록 안내한다(사실과 다른 문장을 지어내지 않는다).
 */
function situationSentences(p: UserProfile): string[] {
  const s: string[] = []
  const ev = p.life_events || []
  const has = (re: RegExp) => ev.some((e) => re.test(e))
  const push = (t: string) => { if (!s.includes(t)) s.push(t) }

  if (p.employment_status === 'unemployed' || has(/실직|실업|해고|권고사직/))
    push('현재 일자리를 잃어 소득이 끊긴 상태로, 생계를 이어가기에 큰 어려움을 겪고 있습니다.')
  if (has(/폐업/))
    push('운영하던 사업을 폐업하게 되어 소득이 크게 줄었습니다.')
  if (has(/질병|질환|산재/))
    push('질병(또는 부상)으로 인한 치료비 부담과 생활의 어려움이 있습니다.')
  if (has(/사망/))
    push('가족의 사망으로 갑작스러운 위기 상황에 놓였습니다.')
  if (has(/재난|화재/))
    push('갑작스러운 재난으로 생활 기반에 어려움을 겪고 있습니다.')
  if ((p.household_type || '').includes('한부모') || has(/이혼|사별/))
    push('혼자 자녀를 양육하고 있어 경제적·시간적 부담이 큽니다.')
  if (p.is_pregnant || has(/출산/))
    push('최근 출산(또는 임신)으로 양육 준비와 관련한 부담이 커졌습니다.')
  else if (p.has_children && (p.children_ages || []).some((a) => a < 8))
    push('어린 자녀를 양육하고 있어 양육비 부담이 있습니다.')
  if (p.disability)
    push('장애로 인해 일상생활과 경제활동에 제약이 있습니다.')
  if (p.age >= 65)
    push('고령으로 경제활동이 어려워 안정적인 생활 유지에 도움이 필요합니다.')
  if (has(/노숙|주거|전입/))
    push('주거와 관련한 어려움이 있어 지원이 필요한 상황입니다.')
  if (s.length === 0 && p.income_percentile <= 50)
    push('가구 소득이 넉넉하지 않아 기본적인 생활을 이어가기에 어려움이 있습니다.')
  return s.slice(0, 4) // 너무 길지 않게(핵심 사유만)
}

/** 오늘 날짜 문자열(로컬). 브라우저 실행이라 Date 사용 가능. */
function todayKo(): string {
  const d = new Date()
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function generateApplyLetter(p: UserProfile, policy: Policy | EligiblePolicy): string {
  const name = (p.name || '').trim()
  const who = [p.age > 0 ? `${p.age}세` : '', (p.household_type || '').trim(), name].filter(Boolean).join(' ')
  const sits = situationSentences(p)
  const body = sits.length > 0 ? sits.join(' ') : '현재 생활에 어려움이 있어 도움이 필요한 상황입니다.'
  return [
    `[${policy.name} 신청 사유서]`,
    '',
    `안녕하십니까. 저는 ${who || '아래와 같은 사정의 신청인'}입니다.`,
    '',
    body,
    '',
    `이에 「${policy.name}」을(를) 신청하고자 하오니, 저의 사정을 살펴 검토해 주시기를 부탁드립니다.`,
    '',
    todayKo(),
    `신청인: ${name || '______'} (서명)`,
  ].join('\n')
}
