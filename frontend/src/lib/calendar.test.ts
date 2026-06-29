import { describe, it, expect } from 'vitest'
import { buildEvents, toICS } from './calendar'
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

describe('toICS', () => {
  it('유효한 VCALENDAR/VEVENT 생성', () => {
    const ics = toICS(buildEvents([mk({ status: 'tracking' })], map))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:')
    expect(ics).toContain('END:VCALENDAR')
  })
})
