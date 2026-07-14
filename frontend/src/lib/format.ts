/** 표시용 포맷/메타 헬퍼 */

export function formatWon(n: number): string {
  if (!n || n <= 0) return '-'
  if (n >= 100000000) return `${(n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1)}억원`
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`
  return `${n.toLocaleString()}원`
}

/** 외국어 답변용 원화 표기 — '만원' 단위는 비한국어 사용자에게 불명확하므로 ₩+천단위 구분. 예) ₩1,990,000 */
export function formatWonIntl(n: number): string {
  if (!n || n <= 0) return ''
  return `₩${Math.round(n).toLocaleString('en-US')}`
}

export const PRIORITY_META: Record<'high' | 'medium' | 'low', { label: string; cls: string; emoji: string }> = {
  high: { label: '강력 추천', cls: 'priority-high', emoji: '🔥' },
  medium: { label: '추천', cls: 'priority-medium', emoji: '👍' },
  low: { label: '검토', cls: 'priority-low', emoji: '🌱' },
}

/** 카테고리별 이모지/색 (탐색기·카드 표시용). 미지정 카테고리는 기본값. */
export function categoryMeta(category: string): { emoji: string; cls: string } {
  const c = category || ''
  if (c.includes('민간')) return { emoji: '💝', cls: 'bg-rose-50 text-rose-600' } // 민간재단(장학·의료·위기) — 정부와 구분
  if (c.includes('노인')) return { emoji: '👵', cls: 'bg-amber-100 text-amber-700' }
  if (c.includes('아동') || c.includes('영유아') || c.includes('보육')) return { emoji: '👶', cls: 'bg-pink-100 text-pink-700' }
  if (c.includes('청년')) return { emoji: '🧑', cls: 'bg-sky2-100 text-sky2-700' }
  if (c.includes('장애')) return { emoji: '♿', cls: 'bg-indigo-100 text-indigo-700' }
  if (c.includes('임신') || c.includes('출산') || c.includes('임산부') || c.includes('산모') || c.includes('모성')) return { emoji: '🤰', cls: 'bg-rose-100 text-rose-600' }
  if (c.includes('저소득') || c.includes('생계') || c.includes('기초')) return { emoji: '🤝', cls: 'bg-emerald-100 text-emerald-700' }
  if (c.includes('주거')) return { emoji: '🏠', cls: 'bg-orange-100 text-orange-700' }
  if (c.includes('의료') || c.includes('건강')) return { emoji: '🏥', cls: 'bg-red-100 text-red-600' }
  if (c.includes('고용') || c.includes('취업') || c.includes('일자리')) return { emoji: '💼', cls: 'bg-blue-100 text-blue-700' }
  if (c.includes('교육') || c.includes('학')) return { emoji: '📚', cls: 'bg-violet-100 text-violet-700' }
  if (c.includes('문화')) return { emoji: '🎨', cls: 'bg-fuchsia-100 text-fuchsia-700' }
  if (c.includes('한부모') || c.includes('가족') || c.includes('다문화')) return { emoji: '👨‍👩‍👧', cls: 'bg-teal-100 text-teal-700' }
  // 이하: 기존 제네릭(🌼)으로 떨어지던 카테고리에 의미 아이콘 부여(스캔성) — 반드시 위 구체 분기 다음(예 '농어촌출산'은 출산 우선)
  if (c.includes('긴급')) return { emoji: '🆘', cls: 'bg-rose-100 text-rose-700' }
  if (c.includes('산재')) return { emoji: '🦺', cls: 'bg-amber-100 text-amber-700' }
  if (c.includes('다자녀')) return { emoji: '👨‍👩‍👧‍👦', cls: 'bg-teal-100 text-teal-700' }
  if (c.includes('농어')) return { emoji: '🌾', cls: 'bg-lime-100 text-lime-700' }
  if (c.includes('보훈')) return { emoji: '🎖️', cls: 'bg-amber-100 text-amber-800' }
  if (c.includes('탈북')) return { emoji: '🕊️', cls: 'bg-sky2-100 text-sky2-700' }
  if (c.includes('외국인')) return { emoji: '🌏', cls: 'bg-blue-100 text-blue-700' }
  if (c.includes('청소년')) return { emoji: '🧑', cls: 'bg-sky2-100 text-sky2-700' }
  if (c.includes('여성')) return { emoji: '👩', cls: 'bg-pink-100 text-pink-700' }
  return { emoji: '🌼', cls: 'bg-sprout-100 text-sprout-700' }
}

/** 혜택 문구에서 월 금액 추정(엔진과 동일 규칙) — 카드 배지용.
 *  '원' 단위(예: 349,700원)를 우선 매칭하고, 없으면 '만원' 단위(예: 23만원, 63.4만원)를 환산.
 *  원-우선이라 "월 최대 70만원 납입 … 월 최대 33,000원"은 실제 혜택 33,000원으로 잡힌다. */
export function parseMonthly(benefit: string): number {
  const won = benefit.match(/월\s*(?:최대\s*)?([0-9,]+)\s*원/)
  if (won) return parseInt(won[1].replace(/,/g, ''), 10)
  // 범위 표기(예: "월 4만~18.7만원", "월 10~30만원")는 상한을 채택 — 단일 만원 매칭이 하한만
  // 잡거나 0이 되어 배지가 과소표시되던 것을 방지(현금성 판정 후에만 배지로 쓰임).
  const range = benefit.match(/월\s*(?:최대\s*)?[0-9]+(?:\.[0-9]+)?\s*만?\s*원?\s*[~〜\-–—]\s*([0-9]+(?:\.[0-9]+)?)\s*만\s*원/)
  if (range) return Math.round(parseFloat(range[1]) * 10000)
  const man = benefit.match(/월\s*(?:최대\s*)?([0-9]+(?:\.[0-9]+)?)\s*만\s*원/)
  if (man) return Math.round(parseFloat(man[1]) * 10000)
  return 0
}

/**
 * 혜택이 '현금성'(매월 현금처럼 받는 지원)인지. 바우처·이용권·대출·현물(전액지원/본인부담)은 제외.
 * 결과 요약의 합계가 현물·서비스 가치까지 더해 과장되지 않도록 하는 게 목적.
 */
export function isCashBenefit(benefit: string, context = ''): boolean {
  const b = benefit || ''
  if (parseMonthly(b) <= 0) return false
  // 서비스 한도액은 benefit 문구엔 금액만 있고 종류는 정책명에 있는 경우가 많아 이름·분류(context)도 함께 검사
  return !isNonCashKind(`${b} ${context}`)
}

/**
 * 혜택 '종류'가 현금이 아님(바우처·이용권·대출·현물·서비스한도·자산형성·장려금·감면)을 텍스트로 판별.
 * 월 반복(isCashBenefit)·일시금(현금흐름) 양쪽이 같은 정직성 기준을 공유하도록 분리했다.
 * 월 금액 유무는 보지 않으므로 일시금(첫만남이용권 등 바우처 배제)에도 그대로 쓸 수 있다.
 */
export function isNonCashKind(text: string): boolean {
  const t = text || ''
  // '현금 지급/현금으로'가 명시되면 바우처 언급이 조건부 설명이어도 현금성으로 본다
  // (예: 부모급여 "0세 월 100만원 … 어린이집 이용 시 바우처, 차액 현금 지급" — 기본은 현금)
  const explicitCash = /현금\s*지급|현금으로|차액\s*현금/.test(t)
  // 바우처·이용권·상품권·대출·현물(전액지원/본인부담)
  if (!explicitCash && /바우처|이용권|상품권|대출|융자|상당|본인부담|전액\s*지원|현물/.test(t)) return true
  if (/대출|본인부담|전액\s*지원/.test(t)) return true
  // 서비스 한도액(장기요양·재가/시설급여·활동지원·돌봄·간병)·감면·고용주 지원(장려금)은 개인 현금소득이 아님
  if (/장기요양|재가급여|시설급여|요양급여|활동지원|돌봄|간병|감면|장려금|치료관리|치료비/.test(t)) return true
  // 현물(물품·식품 꾸러미 등)은 가치가 있어도 매월 쓰는 가처분 현금이 아님(예: 임산부 친환경 농산물 꾸러미)
  if (/꾸러미|농산물|양곡|먹거리|분유|기저귀|생필품|물품\s*지원|현물\s*지원|식품\s*지원/.test(t)) return true
  // 유아학비·누리과정 수업료는 유치원(기관)에 직접 지급되는 학비 — 개인 가처분 현금이 아님(보육료와 동일 성격, 감사 확정).
  // 훈련·교육 '전액 무료'(수강료·훈련비 면제·환급)도 개인 현금소득이 아니다 — 예: 청년 취업사관학교는 무료 교육이며
  // '월 50만원'은 국민취업지원제도(별도 제도) 대상자만 받는 조건부 금액이라 이 사업의 현금으로 표기하면 과장(감사 확정).
  if (/유아학비|누리과정|유치원비|수업료|수강료|훈련비|전액\s*무료/.test(t)) return true
  // 자산형성(적금·저축계좌·매칭 기여금)은 만기까지 잠겨 매월 가처분 현금이 아님 — 대출과 동일하게 합산 제외
  if (/적금|저축계좌|기여금|디딤씨앗|내일저축|도약계좌|미래적금|자산형성/.test(t)) return true
  return false
}

/**
 * 임금 대체성 급여(육아휴직급여·출산전후휴가급여 등) — 부모 한 명이 '일을 그만두고(무급 휴직)' 받는 임금 대체금이라,
 * 부모급여·아동수당 같은 '순증' 복지와 나란히 더하면 '핵심 현금지원 월 최대'가 실제 순증의 몇 배로 부풀려진다(감사 확정).
 * 개별 정책 카드의 금액 배지는 그대로 두되(값 자체는 사실), sumCashMonthly '합산'에서만 제외해 헤드라인 과장을 막는다.
 */
export function isWageReplacement(text: string): boolean {
  return /육아휴직|출산\s*전후\s*휴가|육아기\s*근로시간\s*단축/.test(text || '')
}

/** 현금성 혜택의 월 합계(최대치). 중복지원 제한은 반영하지 않으므로 '최대'로만 안내해야 함. 임금대체는 순증 아님 → 제외. */
export function sumCashMonthly(items: { benefit: string; name?: string; category?: string }[]): number {
  return items.reduce((s, p) => {
    const ctx = `${p.name || ''} ${p.category || ''}`
    if (isWageReplacement(`${p.benefit} ${ctx}`)) return s // 임금대체(육아휴직·출산휴가)는 '순증 합산'에서 제외(개별 카드엔 표시)
    return s + (isCashBenefit(p.benefit, ctx) ? parseMonthly(p.benefit) : 0)
  }, 0)
}
