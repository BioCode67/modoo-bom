import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { applyTiming } from '@/lib/applyTiming'
import { matchMyths } from '@/lib/misconceptions'
import { scanProfileGaps } from '@/lib/profileGaps'
import { summarizeFreshness } from '@/lib/freshness'
import { formatWon } from '@/lib/format'

/**
 * 인사이트 아그리게이터 — 흩어진 '스마트 인사이트' 엔진(신청 타이밍·오해 진단·숨은 자격·데이터 신선도)을
 * 하나의 우선순위 목록으로 합친다. UI·챗·통화가 "내 상황 종합 조언"을 같은 계약으로 소비한다.
 *
 * 각 엔진이 이미 정직성을 지키므로(추정 라벨·구조 규칙·자격 재판정 없음) 여기선 합치고 정렬만 한다.
 * 새 규칙·수치를 만들지 않는다(중복·환각 없음).
 */

export type InsightKind = 'timing' | 'misconception' | 'gap' | 'freshness'

export interface Insight {
  kind: InsightKind
  priority: number   // 낮을수록 먼저(급한 것 우선)
  title: string
  detail: string
  emoji: string
}

/**
 * 프로필+적격결과에서 상위 인사이트를 뽑아 우선순위로 정렬한다.
 * 우선순위: 급한 타이밍(0) > 포기 유발 오해(1) > 숨은 자격(2) > 사전신청(3) > 과소수급 오해(4) >
 *           데이터 확인 권장(5) > 인지성 오해(6).
 */
export function getInsights(
  profile: UserProfile | null,
  eligible: EligiblePolicy[] = [],
  opts: { limit?: number } = {},
): Insight[] {
  const elig = eligible || []
  const out: Insight[] = []

  if (profile) {
    for (const a of applyTiming(profile, elig)) {
      out.push({
        kind: 'timing',
        priority: a.urgency === 'high' ? 0 : 3,
        title: a.title,
        detail: a.lossRisk,
        emoji: a.urgency === 'high' ? '⏰' : '📅',
      })
    }
    for (const m of matchMyths(profile, elig)) {
      const priority = m.severity === 'blocks' ? 1 : m.severity === 'reduces' ? 4 : 6
      out.push({ kind: 'misconception', priority, title: m.belief, detail: m.truth, emoji: '💡' })
    }
    for (const g of scanProfileGaps(profile, { limit: 2 })) {
      const money = g.monthlyDelta > 0 ? `, 월 최대 +${formatWon(g.monthlyDelta)}` : ''
      out.push({ kind: 'gap', priority: 2, title: g.question, detail: `해당되면 +${g.newCount}개${money} (추정)`, emoji: '🔍' })
    }
  }

  const f = summarizeFreshness(elig)
  if (f.verifyCount > 0) {
    out.push({ kind: 'freshness', priority: 5, title: '데이터 확인 권장', detail: f.note, emoji: 'ℹ️' })
  }

  out.sort((a, b) => a.priority - b.priority)
  return out.slice(0, opts.limit ?? 5)
}
