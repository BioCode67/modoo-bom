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
  it('표기 변형 서류도 정식명 docDone(정규화 발급 기억)으로 준비 인정된다', () => {
    // 정책이 '자녀 주민등록등본'을 요구 — 서류 도우미는 정식명 '주민등록등본'으로 발급·기억한다
    const p2: Policy = { ...policy, required_docs: ['자녀 주민등록등본', '통장사본'] }
    const m = monitorItem(mk({ status: 'tracking', checkedDocs: [] }), p2, { 주민등록등본: Date.now() })
    expect(m.docDone).toBe(1)
    expect(m.docMissing).toEqual(['통장사본'])
  })
  it('applied + 점검 7일 경과 → reCheckDue', () => {
    const m = monitorItem(mk({ status: 'applied', appliedAt: Date.now() - 10 * DAY, lastChecked: Date.now() - 8 * DAY }), policy)
    expect(m.reCheckDue).toBe(true)
    expect(m.daysApplied).toBe(10)
  })
  it('applied 45일 이내 → 통상 심사 안내(2~4주 문구)', () => {
    const m = monitorItem(mk({ status: 'applied', appliedAt: Date.now() - 20 * DAY }), policy)
    expect(m.nextAction).toContain('보통 2~4주')
    expect(m.alerts.some((a) => a.level === 'high' && a.kind === 'recheck')).toBe(false)
  })
  it('applied 45일 초과 → 모순된 2~4주 반복 대신 기관 확인 격상(high recheck)', () => {
    // 실화면 스위프에서 발견: 신청 366일째 카드에 '보통 2~4주 걸려요'가 그대로 반복되던 문제
    const m = monitorItem(mk({ status: 'applied', appliedAt: Date.now() - 366 * DAY }), policy)
    expect(m.nextAction).toContain('한참 지났어요')
    expect(m.nextAction).toContain('366일째')
    expect(m.nextAction).not.toMatch(/걸려요\.$/)
    expect(m.alerts.some((a) => a.level === 'high' && a.kind === 'recheck')).toBe(true)
  })
  it('done + 매년 갱신 + 330일 경과 → 갱신 경고(high)', () => {
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), policy)
    expect(m.alerts.some((a) => a.kind === 'renew')).toBe(true)
  })
  it('1회성 바우처(1년 이내 사용)는 매년 갱신 오알림 없음 — "1년" 부분매칭 회귀', () => {
    const onceVoucher: Policy = { ...policy, name: '첫만남이용권', renewal: '1회 (출생 후 1년 이내 사용)' }
    const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), onceVoucher)
    expect(m.alerts.some((a) => a.kind === 'renew')).toBe(false)
  })
  it("'연간 재선정/재신청'형 매년 갱신도 알림 — 감사(연간·재선정 누락 보강)", () => {
    for (const renewal of ['연간 재선정', '연간 재신청', '연간 이용 신청']) {
      const p: Policy = { ...policy, renewal }
      const m = monitorItem(mk({ status: 'done', appliedAt: Date.now() - 340 * DAY }), p)
      expect(m.alerts.some((a) => a.kind === 'renew')).toBe(true)
    }
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
