import type { Policy } from '@/data/policies'

/**
 * 자격 조건 칩 추출 — 자유서술 자격/대상 문구를 '스캔 가능한 조건 칩'(연령·소득·대상군·지역)으로 쪼갠다.
 * 긴 문장을 읽지 않아도 "내가 해당되나"를 눈으로 빠르게 가늠하게 한다(정책 카드·상세·비교에 공용).
 *
 * ⚠️ 소득은 '원문에 적힌 숫자 그대로' 표기한다(welfare-engine의 incomeCeiling은 중위 환산값이라 화면용 아님).
 *    부양의무자·부모 소득 언급 절은 제거해 '신청인 기준'만 남긴다(오해 방지).
 */

export type ConditionType = 'age' | 'income' | 'target' | 'region'
export interface Condition {
  type: ConditionType
  label: string
  emoji: string
}

/** 연령 조건 — 범위(만 N~M세) > 이상(N세 이상) > 미만/이하 순(더 구체적인 것 우선). */
export function parseAgeCondition(doc: string): Condition | null {
  const d = doc || ''
  const range = d.match(/만?\s*(\d{1,3})\s*[~∼\-–]\s*(\d{1,3})\s*세/)
  if (range) return { type: 'age', label: `${range[1]}~${range[2]}세`, emoji: '🎂' }
  const over = d.match(/만?\s*(\d{1,3})\s*세\s*이상/)
  if (over) return { type: 'age', label: `${over[1]}세 이상`, emoji: '🎂' }
  const under = d.match(/만?\s*(\d{1,3})\s*세\s*(미만|이하)/)
  if (under) return { type: 'age', label: `${under[1]}세 ${under[2]}`, emoji: '🎂' }
  return null
}

/** 소득 조건 — 부양의무자·부모 소득 절 제거 후, 기초생활>차상위>중위%>하위% 순으로 원문 숫자 표기. */
export function parseIncomeCondition(doc: string): Condition | null {
  const d = (doc || '')
    .replace(/부양\s*의무자[^,.\n]*/g, '')
    .replace(/부모[^,.\n]*소득[^,.\n]*/g, '')
  if (/기초생활|생계\s*급여|수급자/.test(d)) return { type: 'income', label: '기초생활수급 수준', emoji: '💰' }
  if (/차상위/.test(d)) return { type: 'income', label: '차상위 수준', emoji: '💰' }
  const median = d.match(/중위\s*소득\s*(\d{2,3})\s*%/)
  if (median) return { type: 'income', label: `중위소득 ${median[1]}% 이하`, emoji: '💰' }
  const lower = d.match(/(?:소득\s*)?하위\s*(\d{1,3})\s*%/)
  if (lower) return { type: 'income', label: `소득 하위 ${lower[1]}%`, emoji: '💰' }
  return null
}

// 대상군 키워드 → 칩(11군). 첫 매칭만(중복 라벨 제거).
const TARGET_GROUPS: { re: RegExp; label: string; emoji: string }[] = [
  { re: /장애/, label: '장애인', emoji: '♿' },
  { re: /한부모|모자\s*가정|부자\s*가정|조손/, label: '한부모·조손', emoji: '👨‍👧' },
  { re: /다문화|결혼\s*이민|이주민/, label: '다문화', emoji: '🌏' },
  { re: /임신|임산부|출산|산모/, label: '임신·출산', emoji: '🤰' },
  { re: /청년/, label: '청년', emoji: '🧑' },
  { re: /노인|어르신|고령|65\s*세/, label: '노인', emoji: '👵' },
  { re: /아동|어린이|영유아|보육/, label: '아동·양육', emoji: '🧒' },
  { re: /1인\s*가구|단독\s*가구|독거/, label: '1인가구', emoji: '🏠' },
  { re: /무주택|임차|전세|월세/, label: '무주택·임차', emoji: '🏘️' },
  { re: /구직|실업|실직|이직/, label: '구직·실직', emoji: '💼' },
  { re: /농어민|농업|어업|농촌|어촌/, label: '농어민', emoji: '🌾' },
]

/** 정책 하나의 자격 조건 칩 목록(연령→소득→대상군→지역 순). 뽑을 게 없으면 빈 배열. */
export function eligibilityConditions(policy: Policy): Condition[] {
  const doc = `${policy.eligibility || ''} ${policy.target || ''}`
  const out: Condition[] = []
  const age = parseAgeCondition(doc)
  if (age) out.push(age)
  const income = parseIncomeCondition(doc)
  if (income) out.push(income)
  const seen = new Set<string>()
  for (const g of TARGET_GROUPS) {
    if (g.re.test(doc) && !seen.has(g.label)) {
      out.push({ type: 'target', label: g.label, emoji: g.emoji })
      seen.add(g.label)
    }
  }
  // 지자체(LOC-) 정책은 target 앞 "[시도 시군구]"에서 지역 칩(시군구 우선)
  const rm = policy.id.startsWith('LOC-') ? (policy.target || '').match(/^\[([^\]]+)\]/) : null
  if (rm) out.push({ type: 'region', label: rm[1].split(/\s+/).pop() || rm[1], emoji: '📍' })
  return out
}

/** 칩들을 한 줄 텍스트로(비교표·리포트용). */
export function conditionsToText(conds: Condition[]): string {
  return conds.map((c) => c.label).join(' · ')
}
