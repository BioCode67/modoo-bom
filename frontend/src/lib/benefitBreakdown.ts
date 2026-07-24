import { parseMonthly } from '@/lib/format'

/**
 * 혜택 금액 구성 분해 — "기초급여 349,700 + 부가급여 90,000 = 439,700"처럼 합쳐진 금액을
 * 구성 요소로 풀어 보여준다. 사용자는 '월 최대 43만원'만 보는데, 무엇이 얼마씩 합쳐진 건지
 * 알면 이해와 신뢰가 올라간다(기초연금·장애인연금 등 합산형 급여에 특히 유용).
 *
 * 순수 파싱(외부 상수 없음). 합산 구조('A + B = C' 또는 'A원 + B원')가 있을 때만 분해하고,
 * 단일 금액·범위·'가구별 차등'처럼 분해할 게 없으면 hasBreakdown=false 로 조용히 넘어간다.
 * 금액 합계는 기존 parseMonthly 를 재사용해 카드·계산기와 동일 기준을 유지한다.
 */

export interface BenefitPart { label: string; won: number }

export interface BenefitBreakdown {
  parts: BenefitPart[]   // 구성 요소(2개 이상일 때만 의미)
  total: number          // 합계(원)
  hasBreakdown: boolean  // 분해가 성립했는가
}

/**
 * 세그먼트 금액 추출 — parseMonthly 는 '월' 접두가 있어야 잡지만, '+'로 이어진 구성요소는
 * ('+ 부가급여 9만원'처럼) '월'을 반복하지 않는 경우가 많다. 여기선 '월' 없이도 만원/원을 읽는다.
 */
function segWon(seg: string): number {
  const s = seg || ''
  const man = s.match(/([0-9]+(?:\.[0-9]+)?)\s*만\s*원/)
  if (man) return Math.round(parseFloat(man[1]) * 10000)
  const won = s.match(/([0-9][0-9,]*)\s*원/)
  if (won) return parseInt(won[1].replace(/,/g, ''), 10)
  return 0
}

/** 세그먼트에서 라벨만 추출 — 금액·필러·괄호 제거 후 남는 한글 명사 */
function labelOf(seg: string): string {
  return (seg || '')
    .replace(/[（(][^)）]*[)）]/g, '')            // 괄호 주석 제거
    .replace(/[\d,]+\s*(?:만)?\s*원/g, '')        // 금액 제거
    .replace(/월\s*최대|매월|월|최대|최소|약|까지|지급|1인당|가구당|인당/g, '') // 필러
    .replace(/[~∼\-–:·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function benefitBreakdown(benefit: string): BenefitBreakdown {
  const b = benefit || ''
  const total = parseMonthly(b)

  // '=' 앞을 구성요소, 뒤를 합계로 본다(합계는 parseMonthly로 정확히).
  const eq = b.indexOf('=')
  const left = eq >= 0 ? b.slice(0, eq) : b
  const totalStr = eq >= 0 ? b.slice(eq + 1) : ''

  // '+' 로 나뉜 금액 세그먼트만 구성요소 후보
  if (left.indexOf('+') < 0) return { parts: [], total, hasBreakdown: false }

  const parts: BenefitPart[] = []
  for (const seg of left.split('+')) {
    const won = segWon(seg)
    if (won <= 0) continue
    const label = labelOf(seg) || '지원금'
    parts.push({ label, won })
  }
  if (parts.length < 2) return { parts: [], total, hasBreakdown: false }

  // 합계: '=' 뒤 값이 있으면 그것, 없으면 구성요소 합
  const sum = parts.reduce((a, p) => a + p.won, 0)
  const resolvedTotal = eq >= 0 ? segWon(totalStr) || sum : sum
  return { parts, total: resolvedTotal, hasBreakdown: true }
}
