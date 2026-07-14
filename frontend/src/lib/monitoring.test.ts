import { describe, it, expect } from 'vitest'
import { monitorItem, statusCheckLink, buildActionFeed } from './monitoring'
import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'

const DAY = 86400000
const policy: Policy = {
  id: 'POL-001', name: '기초연금', category: '노인', target: '만 65세', benefit: '월 34만원',
  eligibility: '만 65세 이상', required_docs: ['신분증', '통장사본'], application: '복지로', department: '보건복지부', renewal: '매년 재확인',
}
const mk = (over: Partial<TrackedItem>): TrackedItem => ({
  policyId: 'POL-001', name: '기초연금', category: '노인', status: 'idle', savedAt: Date.now(), checkedDocs: [], ...over,
})

describe('monitorItem', () => {
  it('idle → 서류 준비 안내', () => {
    const m = monitorItem(mk({ status: 'idle' }), policy)
    expect(m.stepIndex).toBe(0)
    expect(m.docTotal).toBe(2)
    expect(m.alerts.some((a) => a.kind === 'docs')).toBe(true)
  })
  it('tracking 서류 미완료 → submit 아님, docs 경고', () => {
    const m = monitorItem(mk({ status: 'tracking', checkedDocs: ['신분증'] }), policy)
    expect(m.docDone).toBe(1)
    expect(m.alerts.some((a) => a.kind === 'docs')).toBe(true)
  })
  it('tracking 서류 완료 → 신청 권유(submit)', () => {
    const m = monitorItem(mk({ status: 'tracking', checkedDocs: ['신분증', '통장사본'] }), policy)
    expect(m.alerts.some((a) => a.kind === 'submit')).toBe(true)
  })
  it('applied + 점검 7일 경과 → reCheckDue', () => {
    const m = monitorItem(mk({ status: 'applied', appliedAt: Date.now() - 10 * DAY, lastChecked: Date.now() - 8 * DAY }), policy)
    expect(m.reCheckDue).toBe(true)
    expect(m.daysApplied).toBe(10)
  })
  it('done + 매년 갱신 + 330일 경과 → 갱신 경고(high)', () => {
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), policy)
    expect(m.alerts.some((a) => a.kind === 'renew' && a.level === 'high')).toBe(true)
  })
  it('감사 회귀: 갱신 후 점검(lastChecked 최근)하면 갱신 경고가 리셋 — 영구 stale 방지', () => {
    // 첫 신청은 오래됐어도 최근에 점검(갱신 완료 표시)했으면 high 갱신 경고가 사라져야 함
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 400 * DAY, lastChecked: Date.now() - 5 * DAY }), policy)
    expect(m.alerts.some((a) => a.kind === 'renew' && a.level === 'high')).toBe(false)
    expect(m.alerts.some((a) => a.kind === 'renew' && a.level === 'info')).toBe(true) // 매년 재확인 안내는 유지
  })
  it('감사 회귀: "연간 재선정"도 매년 갱신으로 인식(자활근로 등)', () => {
    const reElect: Policy = { ...policy, name: '자활근로 사업', renewal: '연간 재선정' }
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), reElect)
    expect(m.alerts.some((a) => a.kind === 'renew')).toBe(true)
  })
  it('1회성 바우처(1년 이내 사용)는 매년 갱신 오알림 없음 — "1년" 부분매칭 회귀', () => {
    const onceVoucher: Policy = { ...policy, name: '첫만남이용권', renewal: '1회 (출생 후 1년 이내 사용)' }
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), onceVoucher)
    expect(m.alerts.some((a) => a.kind === 'renew')).toBe(false)
  })
  it('appliedAt 없는 레거시 applied 항목 → savedAt 폴백으로 일수 계산·재점검 동작', () => {
    // 2026-06 이전 신청분·클라우드 병합으로 appliedAt이 없어도 '신청 0일째' 고정되지 않아야 한다
    const m = monitorItem(mk({ status: 'applied', savedAt: Date.now() - 12 * DAY, lastChecked: Date.now() - 8 * DAY }), policy)
    expect(m.daysApplied).toBe(12)
    expect(m.reCheckDue).toBe(true)
  })
})

describe('statusCheckLink', () => {
  it('고용 관련 → 고용24', () => {
    expect(statusCheckLink({ ...policy, department: '고용노동부' }).url).toContain('work24')
  })
  it('기본 → 복지로', () => {
    expect(statusCheckLink(policy).url).toContain('bokjiro')
  })
})

describe('buildActionFeed', () => {
  it('우선순위(high>medium>info) 정렬', () => {
    const tracked = [mk({ policyId: 'POL-001', status: 'tracking', checkedDocs: ['신분증', '통장사본'] })]
    const feed = buildActionFeed(tracked, { 'POL-001': policy })
    expect(feed.length).toBeGreaterThan(0)
    expect(feed[0].alert.level).toBe('high')
  })
})
