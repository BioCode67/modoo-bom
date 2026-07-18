import type { Policy } from '@/data/policies'
import { issuableCanonical } from '@/lib/docAliases'
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
  const r = renewal || ''
  // '1회·사용·유효기한·이내' 등 기간/1회성 표현은 매년 갱신이 아님 — '1회 (출생 후 1년 이내 사용)'을 '1년' 부분매칭으로 오판하던 문제 방지
  if (/1회|사용|유효|만기|소진|이내|일시/.test(r)) return false
  // '연간 재선정/재신청/운영' 등 실제 매년 재신청형이 누락되던 것 보강 — '연간'·'재선정' 추가(감사).
  //   위 1회성 가드를 이미 통과한 문구만 이르므로 1회성 오판은 없음.
  return /매년|연간|연\s*1회|1년\s*(?:마다|단위|주기)|재확인|재산정|재판정|재선정/.test(r)
}

export function monitorItem(item: TrackedItem, policy: Policy | undefined, globalDocDone: Record<string, number> = {}): ItemMonitor {
  const required = policy?.required_docs ?? []
  // 서류는 정책 단위 체크(checkedDocs) 또는 서류 도우미의 '발급 완료' 기억(docDone, 공백 제거 정규명)이면 준비된 것
  // 표기 변형('자녀 주민등록등본')은 정식 발급명(docDone 키)으로도 대조 — 서류 도우미의 정규화 발급
  // 기억이 모니터링 준비도에 그대로 반영되게(발급했는데 '미비'로 남던 갭).
  const prepared = (d: string) => item.checkedDocs.includes(d) || !!globalDocDone[d.replace(/\s/g, '')]
    || !!globalDocDone[(issuableCanonical(d, 'local') ?? d).replace(/\s/g, '')]
  const docDone = required.filter(prepared).length
  const docMissing = required.filter((d) => !prepared(d))
  // appliedAt이 없는 레거시/동기화 항목(2026-06 이전 신청분·클라우드 병합)은 savedAt으로 폴백 — null로 떨어져 '신청 0일째' 고정·재점검 미알림 방지
  const daysApplied = item.status === 'applied' || item.status === 'done' ? daysSince(item.appliedAt ?? item.savedAt) : null
  const sinceChecked = daysSince(item.lastChecked)
  // 신청 직후 당일부터 '점검할 때'라고 재촉하지 않도록 — 신청 후 최소 7일 지난 뒤 첫 재점검을 권한다(심사 보통 2~4주).
  const reCheckDue = item.status === 'applied' && (daysApplied ?? 0) >= 7 && (sinceChecked === null || sinceChecked >= 7)

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
    case 'applied': {
      // 심사 상한(보통 2~4주)을 한참 지난 신청 건에 '보통 2~4주 걸려요'를 반복하면 모순 안내가 된다
      // (예: 신청 366일째 카드 — 실화면 스위프에서 확인). 45일(4주+유예)을 넘으면 정직하게 격상:
      // 결과를 이미 받았는데 상태를 안 바꾼 경우가 대부분이라 상태 변경 권유 + 기관 확인 안내.
      const staleReview = (daysApplied ?? 0) > 45
      if (staleReview) {
        nextAction = `심사 기간(보통 2~4주)을 한참 지났어요 (신청 ${daysApplied}일째) — 결과를 받으셨다면 카드 상태를 바꿔주시고, 소식이 없다면 담당 기관에 확인해 보세요.`
        alerts.push({ level: 'high', kind: 'recheck', text: '심사 기간을 훌쩍 지났어요 — 공식 사이트나 담당 기관에서 진행 상황을 꼭 확인해 보세요.' })
      } else {
        nextAction = `심사 진행 중 (신청 ${daysApplied ?? 0}일째). 보통 2~4주 정도 걸려요.`
        if (reCheckDue) {
          alerts.push({ level: 'medium', kind: 'recheck', text: '진행상황을 점검할 때예요. 공식 사이트에서 확인해 보세요.' })
        }
      }
      break
    }
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
