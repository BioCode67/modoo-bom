import type { AnalysisResult, UserProfile } from '@/lib/welfare-engine'
import { formatWon, sumCashMonthly, isCashBenefit, parseMonthly } from '@/lib/format'
import { applyTiming } from '@/lib/applyTiming'
import { getInsights } from '@/lib/insights'
import { quickWins } from '@/lib/quickWins'
import { rankPolicies, DIFFICULTY_LABEL } from '@/lib/priority'
import { buildPaymentSchedule, dDayLabel, formatPayDate } from '@/lib/paymentSchedule'

/**
 * 복지 리포트 생성 — 분석 결과를 '복사·저장·전달 가능한 한 덩이 텍스트'로 만든다(순수 함수).
 * 이미지 카드·인쇄와 달리 카카오톡에 붙여넣거나 사회복지사에게 메일로 보내기 좋은 플레인 텍스트.
 *
 * 정직성: 금액은 화면/음성과 같은 '보수 합산'(강력추천 현금성) + 한정어, 이론최대 금지.
 * 최종 자격·금액은 심사 확정임을 푸터에 명시. 날짜는 순수성 위해 인자로 주입(Date 미사용).
 */
export function buildWelfareReport(
  profile: UserProfile | null,
  result: AnalysisResult | null,
  opts: { dateLabel?: string; includeName?: boolean; now?: Date } = {},
): string {
  const eligible = result?.eligible_policies ?? []
  const lines: string[] = ['■ 모두봄 복지 리포트']
  if (opts.dateLabel) lines.push(`작성일: ${opts.dateLabel}`)
  if (profile) {
    const who = [
      opts.includeName && profile.name ? `${profile.name}님` : '',
      profile.age > 0 ? `${profile.age}세` : '',
      profile.household_type || '',
    ].filter(Boolean).join(' · ')
    if (who) lines.push(`대상: ${who}`)
  }
  lines.push('')

  if (!eligible.length) {
    lines.push('· 지금 조건에 딱 맞는 복지를 찾지 못했어요. 조건을 바꿔 다시 분석하거나 주민센터에 문의해 보세요.')
  } else {
    const primary = eligible.filter((p) => /^POL-/.test(p.id))
    // 정밀추천(POL-) 0건이면 저신뢰 '관련 복지'(GOV-/LOC- 추론·PRV- 심사선발형)만 남은 폴백 상태 —
    // 화면(ResultsView '살펴볼 관련 복지')과 같은 구분 표기로, '받을 수 있는'으로 승격하지 않는다(정직성).
    const fallback = primary.length === 0
    const base = fallback ? eligible : primary
    lines.push(
      fallback
        ? `● 살펴볼 관련 복지: ${base.length}개 (자격은 상세 확인 필요)`
        : `● 받을 수 있는 복지: ${base.length}개`,
    )
    base.slice(0, 12).forEach((p, i) => {
      const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
      lines.push(`  ${i + 1}. ${p.name}${m > 0 ? ` (월 최대 ${formatWon(m)})` : ''}`)
      if (p.reason) lines.push(`     - ${p.reason}`)
    })

    // 현금 합산은 화면 헤더(ResultsView)·음성 브리핑(voiceBriefing)과 같은 기준 — 정밀추천(POL-)의
    // 강력추천 현금성만. 폴백 상태에서 저신뢰 관련복지 금액을 합산해 화면보다 강하게 말하지 않는다.
    const monthly = sumCashMonthly(primary.filter((p) => p.priority === 'high'))
    if (monthly > 0) {
      lines.push('')
      lines.push(`● 예상 현금지원(강력추천 현금성만 보수 합산): 월 ${formatWon(monthly)}`)
      lines.push('  ※ 상품권·서비스·중복불가 제외, 실제 조건에 따라 달라질 수 있어요.')
    }

    const docs = result?.required_docs ?? []
    if (docs.length) {
      lines.push('')
      lines.push(`● 필요 서류(통합 ${docs.length}종): ${docs.slice(0, 15).join(', ')}${docs.length > 15 ? ' 외' : ''}`)
    }

    const qw = quickWins(base)
    if (qw.length) {
      lines.push('')
      lines.push(`● 지금 바로 온라인으로 신청 가능: ${qw.length}개`)
      qw.slice(0, 5).forEach((w) => lines.push(`  ⚡ ${w.policy.name}${w.noDocs ? ' (서류 없이 바로)' : ''}`))
    }

    // 신청 순서 — 투명 점수(금액·시급성·확실성·편의) 기준 상위. '뭐부터 하지?'에 답한다.
    const ranked = rankPolicies(base)
    if (ranked.length >= 2) {
      lines.push('')
      lines.push('● 이 순서로 신청하면 좋아요(점수 기준 · 추정)')
      ranked.slice(0, 5).forEach((r, i) => {
        lines.push(`  ${i + 1}. ${r.policy.name} — 신청 ${DIFFICULTY_LABEL[r.difficulty]}${r.urgent ? ' · 마감 임박' : ''}`)
      })
    }

    // 다음 입금 예정일 — 지급일이 알려진 복지만(없는 건 지어내지 않음)
    if (opts.now) {
      const pays = buildPaymentSchedule(base, opts.now)
      if (pays.length) {
        lines.push('')
        lines.push('● 다음 입금 예정일(추정)')
        pays.slice(0, 5).forEach((p) => {
          lines.push(`  ${formatPayDate(p.nextDate)} ${p.policy.name} (${dDayLabel(p.dDay)})${p.weekendAdjusted ? ' · 주말/공휴일이면 앞당겨 지급' : ''}`)
        })
      }
    }

    const timing = profile ? applyTiming(profile, eligible) : []
    if (timing.length) {
      lines.push('')
      lines.push('● 신청 타이밍(서두를 것)')
      timing.slice(0, 3).forEach((t) => lines.push(`  - ${t.title}`))
    }

    const ins = getInsights(profile, eligible, { limit: 3 })
    if (ins.length) {
      lines.push('')
      lines.push('● 다음 할 일')
      ins.forEach((i) => lines.push(`  ${i.emoji} ${i.title}`))
    }
  }

  lines.push('')
  lines.push('※ 일반 안내이며 최종 자격·금액은 신청 후 행정 심사에서 확정돼요.')
  lines.push('※ 공식 신청: 복지로 bokjiro.go.kr · 서류 발급: 정부24 gov.kr')
  lines.push('— 모두봄에서 생성')
  return lines.join('\n')
}
