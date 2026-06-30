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
const PATTERNS: { re: RegExp; label: (m: RegExpMatchArray) => string; urgent: boolean }[] = [
  { re: /(출생|출산)\s*후\s*(\d+)\s*일\s*(?:이내|내|안)/, label: (m) => `${m[1]} 후 ${m[2]}일 내 신청`, urgent: true },
  { re: /(출생|출산)\s*후\s*(\d+)\s*(개월|년)\s*(?:이내|내)/, label: (m) => `${m[1]} 후 ${m[2]}${m[3]} 내 신청`, urgent: false },
  { re: /(퇴직|이직|실직|퇴사)\s*후\s*(\d+)\s*(일|개월|년)\s*(?:이내|내)?/, label: (m) => `${m[1]} 후 ${m[2]}${m[3]} 내 신청`, urgent: true },
  { re: /(\d+)\s*일\s*(?:이내|내|안)\s*(?:신청|신고|접수)/, label: (m) => `${m[1]}일 내 신청`, urgent: true },
  { re: /(\d+)\s*일\s*이내/, label: (m) => `${m[1]}일 내 신청`, urgent: true },
  { re: /한시\s*(?:사업|지원|운영|적용)?/, label: () => '한시 사업 (기간 한정)', urgent: true },
  { re: /(신청|접수|모집)\s*기간|기간\s*내\s*신청|마감/, label: () => '신청 기간 한정', urgent: false },
]

/** 정책의 신청 기한 힌트(없으면 null). name·eligibility·benefit·application을 스캔. */
export function deadlineHint(policy: Policy | EligiblePolicy): DeadlineHint | null {
  const text = `${policy.name} ${policy.eligibility || ''} ${policy.benefit || ''} ${policy.application || ''}`
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (m) return { label: p.label(m), urgent: p.urgent }
  }
  return null
}
