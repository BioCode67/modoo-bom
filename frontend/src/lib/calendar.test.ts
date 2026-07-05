import { describe, it, expect } from 'vitest'
import { buildEvents, toICS, futureEvents } from './calendar'
import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'

const DAY = 86400000
const policy: Policy = {
  id: 'POL-001', name: '기초연금', category: '노인', target: '만 65세', benefit: '월 34만원',
  eligibility: '만 65세', required_docs: ['신분증'], application: '복지로', department: '보건복지부', renewal: '매년 재확인',
}
const map = { 'POL-001': policy }
const mk = (over: Partial<TrackedItem>): TrackedItem => ({
  policyId: 'POL-001', name: '기초연금', category: '노인', status: 'idle', savedAt: Date.now(), checkedDocs: [], ...over,
})

describe('buildEvents', () => {
  it('tracking → 신청 준비 일정', () => {
    const ev = buildEvents([mk({ status: 'tracking' })], map)
    expect(ev.some((e) => e.kind === 'prepare')).toBe(true)
  })
  it('applied → 진행 점검 일정(신청+14일)', () => {
    const ev = buildEvents([mk({ status: 'applied', appliedAt: Date.now() })], map)
    expect(ev.some((e) => e.kind === 'check')).toBe(true)
  })
  it('done + 매년 → 갱신 일정', () => {
    const ev = buildEvents([mk({ status: 'done', appliedAt: Date.now() - 100 * DAY })], map)
    expect(ev.some((e) => e.kind === 'renew')).toBe(true)
  })
  it('날짜 오름차순 정렬', () => {
    const ev = buildEvents([mk({ status: 'applied', appliedAt: Date.now() }), mk({ policyId: 'POL-001', status: 'tracking' })], map)
    for (let i = 1; i < ev.length; i++) expect(ev[i].date).toBeGreaterThanOrEqual(ev[i - 1].date)
  })
})

describe('buildEvents — 준비 일정 savedAt 앵커 (D-3 고정 버그 회귀 방지)', () => {
  // savedAt+준비일이 미래여야 앵커 그대로 유지된다(과거면 '내일'로 클램프돼 죽은 알림 방지 — 아래 별도 테스트).
  it('준비 이벤트 = savedAt + 3일 (Date.now()가 아닌 저장 시점 기준 → 실제 카운트다운)', () => {
    const saved = Date.now() + 30 * DAY
    const prep = buildEvents([mk({ status: 'tracking', savedAt: saved })], map).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBe(saved + 3 * DAY)
  })
  it('긴급 기한(일 단위) 정책은 준비를 하루 앞당기고(savedAt+1일) 기한 텍스트를 노트에 노출', () => {
    const saved = Date.now() + 30 * DAY
    const urgent: Policy = { ...policy, benefit: '출생 후 60일 이내 신청' }
    const prep = buildEvents([mk({ status: 'tracking', savedAt: saved })], { 'POL-001': urgent }).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBe(saved + 1 * DAY)
    expect(prep.note).toContain('기한:')
  })
  it('서로 다른 시점에 담은 항목은 준비 날짜가 서로 다름(더 이상 전부 D-3 아님)', () => {
    const a = mk({ status: 'tracking', savedAt: Date.now() + 30 * DAY })
    const b = mk({ status: 'tracking', savedAt: Date.now() + 35 * DAY })
    const dates = buildEvents([a, b], map).filter((e) => e.kind === 'prepare').map((e) => e.date)
    expect(new Set(dates).size).toBe(2)
  })
  it('buildEvents는 라이브 UI용이라 실제 앵커 유지(과거일 클램프 안 함 — 영원히 D-1 버그 방지)', () => {
    const old = mk({ status: 'tracking', savedAt: Date.now() - 100 * DAY })
    const prep = buildEvents([old], map).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBeLessThan(Date.now()) // 지난 날짜 그대로(화면에선 '지남'으로 표시)
  })
})

describe('futureEvents — .ics 내보내기용 과거 이벤트 제외', () => {
  it('지난 이벤트는 빼고 오늘 이후만 남긴다', () => {
    const past = buildEvents([mk({ status: 'tracking', savedAt: Date.now() - 100 * DAY })], map)
    expect(past.length).toBeGreaterThan(0) // buildEvents엔 있지만
    expect(futureEvents(past).length).toBe(0) // 내보내기에선 제외
  })
  it('미래 이벤트는 유지', () => {
    const future = buildEvents([mk({ status: 'tracking', savedAt: Date.now() + 30 * DAY })], map)
    expect(futureEvents(future).length).toBe(future.length)
  })
})

describe('toICS', () => {
  it('유효한 VCALENDAR/VEVENT 생성', () => {
    const ics = toICS(buildEvents([mk({ status: 'tracking' })], map))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:')
    expect(ics).toContain('END:VCALENDAR')
  })
})
