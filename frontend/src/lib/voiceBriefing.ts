import type { AnalysisResult, EligiblePolicy } from '@/lib/welfare-engine'
import { formatWon, sumCashMonthly } from '@/lib/format'

/**
 * 📞 결과 음성 브리핑 — 분석 결과를 '전화로 설명받는' 한 덩이 안내문 생성(순수 함수).
 *
 * 원칙:
 * - 금액은 결과 화면 헤더와 '같은 보수 합산'(정밀추천 POL- 강력추천의 현금성만) + 한정어 —
 *   이론최대(portfolio_summary.total_monthly)를 읽어주지 않는다(#142와 동일 정직성 기준).
 * - top3는 화면 목록과 같은 순서(정밀추천 우선) — 말과 화면이 다른 걸 가리키지 않게.
 * - 이어지는 대화를 위해 top3 정책을 함께 반환 → 통화에서 "첫번째 담아줘"가 바로 성립.
 */
export function buildResultBriefing(result: AnalysisResult): { text: string; policies: EligiblePolicy[] } | null {
  const eligible = result?.eligible_policies ?? []
  if (!eligible.length) return null
  const primary = eligible.filter((p) => /^POL-/.test(p.id))
  const base = primary.length ? primary : eligible
  const high = base.filter((p) => p.priority === 'high')
  const top = base.slice(0, 3)
  const monthly = sumCashMonthly(primary.filter((p) => p.priority === 'high'))
  const docs = result.required_docs ?? []

  const lines: string[] = [
    `분석 결과를 전화로 짚어드릴게요. 맞춤 복지가 ${base.length}개, 그중 강력 추천이 ${high.length}개예요.`,
  ]
  top.forEach((p, i) => {
    lines.push(`${i + 1}번, ${p.name}${p.reason ? ` — ${p.reason}` : ''}`)
  })
  if (monthly > 0) {
    lines.push(`핵심 현금지원만 적게 잡아 더하면 월 ${formatWon(monthly)} 정도예요 — 실제 조건·중복수급에 따라 달라질 수 있어요.`)
  }
  if (docs.length > 0) {
    lines.push(`서류는 모두 합쳐 ${docs.length}종이 필요해요 — 서류 준비는 나의 복지에서 제가 챙겨드릴게요.`)
  }
  lines.push(`마음에 드는 게 있으면 지금 "첫번째 담아줘"처럼 말씀하셔도 되고, 더 궁금한 것도 편하게 물어보세요.`)
  return { text: lines.join('\n'), policies: top }
}
