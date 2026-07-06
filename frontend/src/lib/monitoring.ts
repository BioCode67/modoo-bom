import type { Policy } from '@/data/policies'
import type { TrackedItem, AppStatus } from '@/store/useAppStore'

const DAY = 86400000

export interface Alert {
  level: 'high' | 'medium' | 'info'
  kind: 'docs' | 'submit' | 'recheck' | 'renew'
  text: string
}

export interface ItemMonitor {
  stepIndex: number // 0 idle, 1 tracking, 2 applied, 3 done
  docTotal: number
  docDone: number
  docMissing: string[]
  nextAction: string
  alerts: Alert[]
  reCheckDue: boolean
  daysApplied: number | null
  statusCheck: { label: string; url: string }
}

const STEP: Record<AppStatus, number> = { idle: 0, tracking: 1, applied: 2, done: 3 }

function daysSince(ts?: number): number | null {
  if (!ts) return null
  return Math.floor((Date.now() - ts) / DAY)
}

/** 신청 상태를 어디서 확인하는지 — 기관별 공식 조회 링크 */
export function statusCheckLink(policy: Policy | undefined): { label: string; url: string } {
  const a = (policy?.application || '') + (policy?.department || '')
  if (a.includes('고용') || a.includes('work')) return { label: '고용24 신청현황', url: 'https://www.work24.go.kr' }
  if (a.includes('건강보험') || a.includes('건보') || a.includes('국민건강')) return { label: '건강보험공단 민원조회', url: 'https://www.nhis.or.kr' }
  if (a.includes('주택') || a.includes('LH') || a.includes('전세')) return { label: '마이홈 신청조회', url: 'https://www.myhome.go.kr' }
  return { label: '복지로 신청내역 조회', url: 'https://www.bokjiro.go.kr/ssis-teu/twatba/mypage/movMyPage.do' }
}

/** 갱신 주기가 '매년' 류인지 — 연 1회 재확인 알림 대상 */
function isAnnualRenewal(renewal: string): boolean {
  return /매년|연\s*1회|1년|재확인/.test(renewal || '')
}

export function monitorItem(item: TrackedItem, policy: Policy | undefined, globalDocDone: Record<string, number> = {}): ItemMonitor {
  const required = policy?.required_docs ?? []
  // 서류는 정책 단위 체크(checkedDocs) 또는 서류 도우미의 '발급 완료' 기억(docDone, 공백 제거 정규명)이면 준비된 것
  const prepared = (d: string) => item.checkedDocs.includes(d) || !!globalDocDone[d.replace(/\s/g, '')]
  const docDone = required.filter(prepared).length
  const docMissing = required.filter((d) => !prepared(d))
  const daysApplied = item.status === 'applied' || item.status === 'done' ? daysSince(item.appliedAt) : null
  const sinceChecked = daysSince(item.lastChecked)
  const reCheckDue = item.status === 'applied' && (sinceChecked === null || sinceChecked >= 7)

  const alerts: Alert[] = []
  let nextAction = ''

  switch (item.status) {
    case 'idle':
      nextAction = required.length > 0 ? '필요 서류를 확인하고 준비를 시작하세요.' : '상세 정보를 확인하고 신청을 준비하세요.'
      if (required.length > 0) alerts.push({ level: 'info', kind: 'docs', text: `서류 ${required.length}종 준비가 필요해요.` })
      break
    case 'tracking':
      if (required.length === 0) {
        // 필요 서류를 앱이 모르는 정책(공공데이터 요약본·정책 미로드)은 '준비 완료'를 단정하지 않는다(과장 금지).
        nextAction = '필요 서류는 상세·공식 페이지에서 확인한 뒤 신청하세요.'
        alerts.push({ level: 'medium', kind: 'submit', text: '신청 준비 중 — 필요 서류를 공식 페이지에서 확인하세요.' })
      } else if (docMissing.length > 0) {
        nextAction = `남은 서류 ${docMissing.length}건을 준비하세요: ${docMissing.slice(0, 2).join(', ')}${docMissing.length > 2 ? ' 외' : ''}`
        alerts.push({ level: 'medium', kind: 'docs', text: `서류 ${docDone}/${required.length} 준비됨 — ${docMissing.length}건 남음` })
      } else {
        nextAction = '서류 준비 완료! 이제 신청하세요. 신청 후 "신청 완료"로 표시해 주세요.'
        alerts.push({ level: 'high', kind: 'submit', text: '신청할 준비가 끝났어요. 지금 신청하세요.' })
      }
      break
    case 'applied':
      nextAction = `심사 진행 중 (신청 ${daysApplied ?? 0}일째). 보통 2~4주 정도 걸려요.`
      if (reCheckDue) {
        alerts.push({ level: 'medium', kind: 'recheck', text: '진행상황을 점검할 때예요. 공식 사이트에서 확인해 보세요.' })
      }
      break
    case 'done':
      nextAction = policy?.renewal ? `수급 중이에요 🎉 갱신: ${policy.renewal}` : '수급 중이에요 🎉'
      if (policy && isAnnualRenewal(policy.renewal)) {
        const base = item.appliedAt || item.savedAt
        const d = daysSince(base)
        if (d !== null && d >= 330) alerts.push({ level: 'high', kind: 'renew', text: '갱신(재확인) 시기가 다가왔어요. 자격 재확인이 필요할 수 있어요.' })
        else alerts.push({ level: 'info', kind: 'renew', text: '매년 자격 재확인이 필요한 혜택이에요. 갱신 시기를 챙겨드릴게요.' })
      }
      break
  }

  return {
    stepIndex: STEP[item.status],
    docTotal: required.length,
    docDone,
    docMissing,
    nextAction,
    alerts,
    reCheckDue,
    daysApplied,
    statusCheck: statusCheckLink(policy),
  }
}

export interface FeedEntry { item: TrackedItem; policy: Policy | undefined; alert: Alert; monitor: ItemMonitor }

const LEVEL_RANK: Record<Alert['level'], number> = { high: 0, medium: 1, info: 2 }

/** 전체 추적 항목에서 '오늘의 할 일/알림'을 우선순위로 모음 */
export function buildActionFeed(tracked: TrackedItem[], policyMap: Record<string, Policy>, globalDocDone: Record<string, number> = {}): FeedEntry[] {
  const feed: FeedEntry[] = []
  for (const item of tracked) {
    const policy = policyMap[item.policyId]
    const monitor = monitorItem(item, policy, globalDocDone)
    for (const alert of monitor.alerts) feed.push({ item, policy, alert, monitor })
  }
  feed.sort((a, b) => LEVEL_RANK[a.alert.level] - LEVEL_RANK[b.alert.level])
  return feed
}
