import type { Policy } from '@/data/policies'

/**
 * 복지 지급일(입금 예정일) 안내 — "돈이 언제 통장에 들어오나"에 답한다.
 *
 * 마감·갱신 캘린더(calendar/WelfareCalendar)와 다른 축: 그건 '신청 마감', 이건 '지급일'.
 * 어르신 사용자가 가장 궁금해하는 지점이라 별도로 챙긴다.
 *
 * 정직성: 지급일이 널리 알려진 주요 급여만 매핑하고, 그 외는 매핑하지 않는다(null·안내 확인).
 * 실제 지급일은 공휴일이면 앞당겨질 수 있고 기관별로 다를 수 있음을 명시한다. 주말은 직전
 * 영업일로 보정하되(공휴일은 데이터가 없어 보정하지 않음) 안내 문구로 알린다.
 */

const DAY = 86400000

// 널리 공지된 주요 급여 지급일(매월 N일). 이름 패턴으로만 보수적으로 매핑(오배정 방지).
const PAY_DAY: { day: number; kw: RegExp; label: string }[] = [
  { day: 25, kw: /기초연금/, label: '기초연금' },
  { day: 25, kw: /아동수당/, label: '아동수당' },
  { day: 25, kw: /부모급여|영아수당/, label: '부모급여' },
  { day: 25, kw: /양육수당/, label: '양육수당' },
  { day: 20, kw: /장애인연금/, label: '장애인연금' },
  { day: 20, kw: /장애(아동)?수당/, label: '장애수당' },
  { day: 20, kw: /생계급여/, label: '생계급여' },
  { day: 20, kw: /주거급여/, label: '주거급여' },
]

/** 정책명 → 매월 지급일(1~31). 매핑된 주요 급여만, 아니면 null. */
export function paymentDay(policy: Pick<Policy, 'name'>): number | null {
  const n = policy?.name || ''
  for (const p of PAY_DAY) if (p.kw.test(n)) return p.day
  return null
}

/** 날짜에서 시간 요소를 떼어 자정 기준으로 */
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 토/일이면 직전 금요일로 당김(평일은 그대로) */
function pullToWeekday(target: Date): Date {
  const dow = target.getDay()
  if (dow === 6) return new Date(target.getFullYear(), target.getMonth(), target.getDate() - 1)      // 토 → 금
  if (dow === 0) return new Date(target.getFullYear(), target.getMonth(), target.getDate() - 2)      // 일 → 금
  return target
}

/**
 * 지급일(day) 기준 '다음 입금 예정일'을 계산. now 이후 가장 가까운 지급일.
 * 주말이면 직전 금요일로 당긴다(공휴일은 데이터가 없어 미보정 — 실제로는 더 앞당겨질 수 있음).
 * 당긴 날짜가 오늘보다 과거면(예: 오늘이 주말 지급일 당일) 이미 지급된 회차 →
 * 다음 달 지급일로 넘긴다(그 회차도 같은 주말 보정 적용).
 */
export function nextPaymentDate(day: number, now: Date): Date {
  const todayMid = atMidnight(now).getTime()
  const y = now.getFullYear()
  const m = now.getMonth()
  // 이번 달 지급일이 오늘 이후(오늘 포함)면 이번 달, 지났으면 다음 달
  let base = day >= now.getDate() ? new Date(y, m, day) : new Date(y, m + 1, day)
  let target = pullToWeekday(base)
  // 주말 보정이 과거로 되돌린 회차는 지난 지급 — 다음 회차로(보정 재적용)
  while (target.getTime() < todayMid) {
    base = new Date(base.getFullYear(), base.getMonth() + 1, day)
    target = pullToWeekday(base)
  }
  return target
}

export interface PaymentEntry {
  policy: Policy
  day: number
  nextDate: Date
  dDay: number       // 오늘로부터 남은 일수(0 = 오늘)
  weekendAdjusted: boolean
}

/** 지급일이 매핑되는 정책들의 다음 입금 예정일을 가까운 순으로 */
export function buildPaymentSchedule(policies: Policy[], now: Date): PaymentEntry[] {
  const todayMid = atMidnight(now)
  const out: PaymentEntry[] = []
  for (const policy of policies) {
    const day = paymentDay(policy)
    if (day === null) continue
    const nextDate = nextPaymentDate(day, now)
    const dDay = Math.round((atMidnight(nextDate).getTime() - todayMid.getTime()) / DAY)
    out.push({ policy, day, nextDate, dDay, weekendAdjusted: nextDate.getDate() !== day })
  }
  out.sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime())
  return out
}

/** D-day를 사람이 읽는 문구로 */
export function dDayLabel(dDay: number): string {
  if (dDay === 0) return '오늘 지급'
  if (dDay === 1) return '내일 지급'
  return `${dDay}일 뒤`
}

/** 'M월 D일(요일)' 표기 */
const DOW = ['일', '월', '화', '수', '목', '금', '토']
export function formatPayDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`
}
