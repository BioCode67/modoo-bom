/**
 * 가구 구성 → 가구유형 자동 판별.
 *
 * 복지는 대부분 '가구 단위'라 household_type(한부모·다자녀·노인가구 등)이 매칭에 중요한데,
 * 사용자는 자기 가구가 어떤 유형인지 헷갈려 한다. 구성원(관계·나이)만으로 유형을 추론해
 * 프로필 선택을 도와준다(수동 드롭다운의 마찰 감소).
 *
 * 순수 함수라 테스트 가능하고 전부 브라우저 안에서 계산된다. '다문화·조손'처럼 구성원 관계만으론
 * 확정 못 하는 유형은 추측하지 않는다(다문화는 명시 입력 필요, 과장 금지).
 */

export type HouseholdType = '1인가구' | '한부모가족' | '다자녀가구' | '노인가구' | '다문화가족' | '일반가구'

export interface HHMember {
  relation: string  // 본인·배우자·자녀·부모·조부모·형제자매
  age: number
}

export interface HHClassification {
  type: HouseholdType
  reasons: string[]   // 왜 이 유형인지
  flags: string[]     // 부가 특성(영유아·청년·노인·다자녀·한부모 등) — 유형과 별개 신호
}

const MINOR = 19        // 만 19세 미만 = 미성년(자녀 카운트 기준)
const SENIOR = 65       // 노인 기준
const MULTI_CHILD = 2   // 다자녀 기준(2026 완화 추세, 통상 2명 — 정책별 3명도 있음)

/** 구성원·다문화 여부로 가구유형을 판별 */
export function classifyHousehold(members: HHMember[], opts: { multicultural?: boolean } = {}): HHClassification {
  const ms = (members || []).filter((m) => m && typeof m.age === 'number')
  const kids = ms.filter((m) => m.relation === '자녀' && m.age < MINOR)
  const hasSpouse = ms.some((m) => m.relation === '배우자')
  const allSenior = ms.length >= 2 && ms.every((m) => m.age >= SENIOR)

  // 부가 특성(유형과 독립적으로 수집)
  const flags: string[] = []
  if (ms.some((m) => m.age <= 5)) flags.push('영유아')
  if (kids.some((m) => m.age >= 6 && m.age <= 18)) flags.push('학령기아동')
  if (ms.some((m) => m.age >= 19 && m.age <= 34)) flags.push('청년')
  if (ms.some((m) => m.age >= SENIOR)) flags.push('노인')
  if (kids.length >= MULTI_CHILD) flags.push('다자녀')
  if (kids.length >= 1 && !hasSpouse) flags.push('한부모')

  // 유형 판별(우선순위)
  let type: HouseholdType
  const reasons: string[] = []
  if (opts.multicultural) {
    type = '다문화가족'
    reasons.push('다문화 가구로 표시됨')
  } else if (ms.length <= 1) {
    type = '1인가구'
    reasons.push('구성원이 1명')
    if (ms[0] && ms[0].age >= SENIOR) reasons.push('만 65세 이상 (노인 1인가구)')
  } else if (kids.length >= 1 && !hasSpouse) {
    type = '한부모가족'
    reasons.push(`배우자 없이 미성년 자녀 ${kids.length}명 양육`)
  } else if (allSenior) {
    type = '노인가구'
    reasons.push('구성원 모두 만 65세 이상')
  } else if (kids.length >= MULTI_CHILD) {
    type = '다자녀가구'
    reasons.push(`미성년 자녀 ${kids.length}명`)
  } else {
    type = '일반가구'
    reasons.push('일반 가구 구성')
  }

  return { type, reasons, flags }
}

/** 판별된 유형을 한 줄 안내로 */
export function classificationHint(c: HHClassification): string {
  const flagText = c.flags.length > 0 ? ` · 특성: ${c.flags.join('·')}` : ''
  return `${c.type} (${c.reasons[0]})${flagText}`
}
