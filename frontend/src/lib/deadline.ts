import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 신청 기한 추출 — 복지를 놓치는 가장 큰 이유가 '신청 기한'이라, 정책 문구에서
 * 기한 신호를 뽑아 카드/상세에 경고 배지로 노출한다. (LLM 없이 고신뢰 패턴만)
 * 만기·사용기한 등 신청과 무관한 표현은 의도적으로 제외(오탐 방지).
 */
export interface DeadlineHint {
  label: string
  urgent: boolean // true면 단기(일 단위)·한시·마감 → 강조(빨강)
}

// [정규식, 라벨 생성, urgent]. 위에서부터 첫 매칭 사용(구체적인 것 우선).
// urgent는 boolean 또는 (매치)→boolean — 일수가 클수록(예: 180일=6개월) '급박'이 아니므로 임계로 판정.
const URGENT_DAYS = 45 // 이 일수 이하만 '기한 짧아요'(빨강). 그 이상은 안내(주황) — 180일을 급박으로 오표시하던 것 차단.
const PATTERNS: { re: RegExp; label: (m: RegExpMatchArray) => string; urgent: boolean | ((m: RegExpMatchArray) => boolean) }[] = [
  // 출생·퇴직 후 기한은 놓치면 급여를 잃는 대표 사례(첫만남 60일·실업급여 1년)라 의도적으로 항상 강조(urgent).
  { re: /(출생|출산)\s*후\s*(\d+)\s*일\s*(?:이내|내|안)/, label: (m) => `${m[1]} 후 ${m[2]}일 내 신청`, urgent: true },
  { re: /(출생|출산)\s*후\s*(\d+)\s*(개월|년)\s*(?:이내|내)/, label: (m) => `${m[1]} 후 ${m[2]}${m[3]} 내 신청`, urgent: false },
  { re: /(퇴직|이직|실직|퇴사)\s*후\s*(\d+)\s*(일|개월|년)\s*(?:이내|내)?/, label: (m) => `${m[1]} 후 ${m[2]}${m[3]} 내 신청`, urgent: true },
  { re: /(\d+)\s*일\s*(?:이내|내|안)\s*(?:신청|신고|접수)/, label: (m) => `${m[1]}일 내 신청`, urgent: (m) => parseInt(m[1], 10) <= URGENT_DAYS },
  // '개월 이내 신청'(퇴원 6개월 이내 신청 등 한시성). '신청/신고/접수' 앵커로 'N개월 이내 사용'(바우처)엔 오탐 안 남(감사 4차 #15)
  { re: /(\d+)\s*개월\s*이내\s*(?:신청|신고|접수)/, label: (m) => `${m[1]}개월 내 신청`, urgent: false },
  // 앵커 없는 'N일 이내'(예: '퇴원 180일 이내') — 사용/소진/지급/충전/환급류(바우처 사용기한)는 제외해 '신청'으로 오표기 안 함.
  //   180일=6개월 같은 긴 기한은 급박(빨강)이 아니라 안내(주황)로.
  { re: /(\d+)\s*일\s*이내(?!\s*(?:사용|소진|충전|지급|환급))/, label: (m) => `${m[1]}일 내 신청`, urgent: (m) => parseInt(m[1], 10) <= URGENT_DAYS },
  // '한시'는 사업성 접미어가 근접 필수('한시 긴급생활지원' 등) — 수사적 '한시적 약자…'를 긴급 배지로 오표기 금지(15차)
  { re: /한시(?!적)\s*(?:[가-힣]{0,6})?(?:사업|지원|운영|적용)/, label: () => '한시 사업 (기간 한정)', urgent: true },
  // '마감'도 신청 맥락 앵커 필수 — '인생을 마감' 등 무관 문구 오탐 방지(15차)
  { re: /(신청|접수|모집)\s*기간|기간\s*내\s*신청|(신청|접수|모집)\s*마감/, label: () => '신청 기간 한정', urgent: false },
]

/** 정책의 신청 기한 힌트(없으면 null). name·eligibility·benefit·application을 스캔. */
export function deadlineHint(policy: Policy | EligiblePolicy): DeadlineHint | null {
  const text = `${policy.name} ${policy.eligibility || ''} ${policy.benefit || ''} ${policy.application || ''}`
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (m) return { label: p.label(m), urgent: typeof p.urgent === 'function' ? p.urgent(m) : p.urgent }
  }
  return null
}
