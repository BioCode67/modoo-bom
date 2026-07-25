import type { Policy } from '@/data/policies'

/**
 * 자격 요건 구조화 — 정책의 자격/대상 자유서술을 '스캔 가능한 조건 칩'으로 뽑아낸다.
 *
 * 왜 새로운가: explainEligibility 는 '내 프로필 대비 통과/탈락'을 본다면, 여기선 프로필과 무관하게
 * 그 정책 '자체의 조건'(연령·소득·대상군·지역)을 칩으로 정리한다. 카드/상세에서 긴 문장을 읽지 않고도
 * "만 65세 이상 · 소득 하위 70% · 노인"을 한눈에 파악하게 한다.
 *
 * 순수 함수(정규식 + 엔진의 incomeCeiling 재사용). 자유서술을 요약한 '표시용'이며, 정확한 자격은
 * 상세의 원문·심사가 우선(과장 금지). 전부 온디바이스.
 */

export type ConditionType = 'age' | 'income' | 'target' | 'region'

export interface Condition {
  type: ConditionType
  label: string
  emoji: string
}

/** 대상군 키워드 → 칩 (탐색 버킷과 결이 맞는 이모지) */
const TARGET_GROUPS: { re: RegExp; label: string; emoji: string }[] = [
  { re: /노인|어르신|고령|경로|장기요양/, label: '노인', emoji: '👵' },
  { re: /청년|대학생|취업준비|구직청년/, label: '청년', emoji: '🧑' },
  { re: /장애/, label: '장애인', emoji: '♿' },
  { re: /임신|임산부|출산|산모|난임/, label: '임신·출산', emoji: '🤰' },
  { re: /아동|영유아|보육|어린이|유아|양육/, label: '아동·육아', emoji: '👶' },
  { re: /한부모|모자가정|부자가정|조손/, label: '한부모·조손', emoji: '👨‍👧' },
  { re: /다문화|결혼이민|외국인주민|북한이탈/, label: '다문화·이주', emoji: '🌏' },
  { re: /저소득|기초생활|수급|차상위/, label: '저소득', emoji: '🤝' },
  { re: /실업|실직|구직|재취업|일자리|고용/, label: '구직·고용', emoji: '💼' },
  { re: /보훈|국가유공|참전|유공자/, label: '보훈', emoji: '🎖️' },
  { re: /농어민|농업인|어업인|농가/, label: '농어민', emoji: '🌾' },
]

/**
 * 연령 조건 파싱 — '만 19~34세', '만 65세 이상', '8세 미만', '만 0~1세'.
 * 범위 > 이상 > 미만/이하 순으로 첫 매칭을 채택한다.
 */
export function parseAgeCondition(doc: string): string | null {
  const t = doc || ''
  let m = t.match(/만?\s*(\d{1,3})\s*[~∼\-–]\s*(\d{1,3})\s*세/)
  if (m) return `만 ${m[1]}~${m[2]}세`
  m = t.match(/만?\s*(\d{1,3})\s*세\s*이상/)
  if (m) return `만 ${m[1]}세 이상`
  m = t.match(/(\d{1,3})\s*세\s*(미만|이하)/)
  if (m) return `${m[1]}세 ${m[2]}`
  return null
}

/**
 * 소득 조건 라벨 — '원문에 보이는 숫자 그대로'를 표시한다.
 * (엔진 incomeCeiling 은 하위%→중위등가%로 환산한 '비교값'이라 표시용으로 쓰면 숫자가 틀린다.)
 * 부모·부양의무자 소득요건은 본인 조건이 아니므로 제거하고 신청자 조건만 뽑는다(incomeCeiling과 동일 취지).
 */
export function parseIncomeCondition(doc: string): string | null {
  const d = (doc || '')
    .replace(/부모\s*(?:의\s*)?(?:소득|재산|중위)[^,，、;.·()（）]*?[0-9]{2,3}\s*%\s*(?:이하|미만)?/g, ' ')
    .replace(/부양의무자[^,，、;.·()（）]*?[0-9]{2,3}\s*%\s*(?:이하|미만)?/g, ' ')
  let m = d.match(/중위(?:소득)?\s*([0-9]{2,3})\s*%/)
  if (m) return `중위소득 ${m[1]}% 이하`
  m = d.match(/하위\s*([0-9]{2,3})\s*%/)
  if (m) return `소득 하위 ${m[1]}% 이하`
  // %가 안 적힌 자산심사형 — '우대/우선'(하드조건 아님)은 제외하고 판정
  const noPref = (doc || '')
    .replace(/\([^)]*(?:우선|우대)[^)]*\)/g, '')
    .replace(/(?:수급자?|차상위)\s*(?:우선|우대)/g, '')
    .replace(/미수급[가-힣]*/g, '')
  if (/차상위/.test(noPref)) return '차상위 이하'
  if (/기초생활|생계급여|기초수급|수급자|수급\s*가구|급여\s*수급/.test(noPref)) return '기초생활수급'
  return null
}

/** 정책 → 자격 조건 칩 목록(연령·소득·대상군·지역, 중복 제거) */
export function eligibilityConditions(policy: Policy): Condition[] {
  const doc = `${policy.eligibility || ''} ${policy.target || ''} ${policy.name || ''}`
  const out: Condition[] = []
  const seen = new Set<string>()
  const push = (c: Condition) => {
    const k = `${c.type}:${c.label}`
    if (!seen.has(k)) { seen.add(k); out.push(c) }
  }

  // 지역(지자체 LOC target 접두 "[시도 시군구] …")
  const region = (policy.target || '').match(/^\[([^\]]+)\]/)
  if (region) {
    const parts = region[1].trim().split(/\s+/)
    push({ type: 'region', label: parts[parts.length - 1] || parts[0], emoji: '📍' })
  }

  // 연령
  const age = parseAgeCondition(doc)
  if (age) push({ type: 'age', label: age, emoji: '🎂' })

  // 소득(원문 숫자 그대로 표시 — 부모/부양의무자 요건 제외)
  const income = parseIncomeCondition(doc)
  if (income) push({ type: 'income', label: income, emoji: '💰' })

  // 대상군
  for (const g of TARGET_GROUPS) if (g.re.test(doc)) push({ type: 'target', label: g.label, emoji: g.emoji })

  return out
}

/** 조건 칩을 한 줄 텍스트로(공유·복사용) */
export function conditionsToText(conds: Condition[]): string {
  return conds.map((c) => c.label).join(' · ')
}
