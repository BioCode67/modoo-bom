import type { Policy } from '@/data/policies'

/**
 * 지원형태 추론 — 정책의 '무엇을 주는지'를 규칙으로 분류(현금/바우처·카드/요금감면/현물·서비스/융자·대출).
 *
 * 왜: 지자체 4,598건은 benefit이 사업목적 서술이라 금액 파싱(parseMonthly)이 0 → 현금성 필터에서 전멸한다.
 * 정책명/혜택 문구의 신호로 형태를 태깅해 탐색 파셋 필터·카드 배지로 활용(사용자편의성).
 * 정직성: 데이터를 만들지 않고 텍스트에서 추론만 한다. 신호가 없으면 태그 없음(억지 분류 금지).
 */
export type BenefitType = 'cash' | 'voucher' | 'discount' | 'service' | 'loan'

export const BENEFIT_TYPE_META: Record<BenefitType, { label: string; emoji: string }> = {
  cash: { label: '현금 지원', emoji: '💵' },
  voucher: { label: '바우처·카드', emoji: '🎟️' },
  discount: { label: '요금 감면', emoji: '🏷️' },
  service: { label: '서비스·현물', emoji: '🤝' },
  loan: { label: '융자·대출', emoji: '🏦' },
}

// 순서 = 우선순위(먼저 매칭되면 그 형태). 대출·감면·바우처는 명시 신호가 강해 먼저 본다.
const RULES: { type: BenefitType; re: RegExp }[] = [
  { type: 'loan', re: /대출|융자|보증|이차보전|상환|저리|무이자|전세자금|버팀목|디딤돌/ },
  { type: 'voucher', re: /바우처|이용권|쿠폰|포인트|카드\b|국민행복카드|문화누리|온누리|지역화폐|상품권/ },
  { type: 'discount', re: /감면|할인|경감|면제|지원금리|요금\s*(감면|경감|할인)|세금\s*감면|전기요금|가스요금|통신비\s*감면/ },
  { type: 'cash', re: /현금|지급|수당|연금|급여|장려금|지원금|보조금|월\s*\d|만원|천원|정착금|축하금|장려|양육비|생계비/ },
  { type: 'service', re: /지원(?!금)|서비스|돌봄|상담|교육|바로|파견|방문|제공|이용|입소|치료|재활|검진|프로그램|일자리|훈련/ },
]

/** 정책의 지원형태(없으면 null). name+benefit를 본다. */
export function benefitTypeOf(p: Policy): BenefitType | null {
  const text = `${p.name || ''} ${p.benefit || ''}`
  for (const r of RULES) if (r.re.test(text)) return r.type
  return null
}
