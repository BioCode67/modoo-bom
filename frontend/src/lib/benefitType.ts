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
  // ① 주거 현물·보증보험 우선분류 — '만원'·'지급'·'급여' 부분문자열로 현금/대출로 오분류되기 쉬워 먼저 서비스·현물로.
  //   (예: '전세임대주택'·'매입임대'는 집을 제공하는 현물, 'HUG 전세보증금 반환보증'은 사용자가 보증료를 내는 보증보험 → 현금 지원 아님)
  //   ⚠️ 광의 '임대주택'은 '임대주택 요금감면'·'임대주택 주거비 지원'·'임대보증금 무이자' 같은 감면/현금/융자 정책까지
  //      가로채므로 넣지 않는다 — 집을 '제공'하는 케이스는 정밀 토큰(전세임대·매입임대·기숙사형)으로만 잡는다.
  { type: 'service', re: /매입임대|전세임대|기숙사형|반환보증|보증보험/ },
  // ② '카드 발급수수료·수수료 지원'은 카드형(바우처)이 아니라 요금성 지원 → 바우처보다 먼저 감면으로.
  { type: 'discount', re: /발급수수료|수수료\s*(지원|감면|면제|경감)/ },
  // '보증'만으론 '보증금·보증료' 무상지원까지 대출로 오분류돼(그랜트를 빚으로 오인) 대출 맥락 복합신호로 좁힘.
  { type: 'loan', re: /대출|융자|보증부|신용보증|특례보증|햇살론|이차보전|상환|저리|무이자|전세자금|버팀목|디딤돌/ },
  // '카드\b'는 한글('드') 뒤에서 \b가 성립하지 않아 죽은 패턴 → '카드'로 교체(교통카드·드림카드 등 정상 매칭).
  { type: 'voucher', re: /바우처|이용권|쿠폰|포인트|카드|문화누리|온누리|지역화폐|상품권/ },
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
