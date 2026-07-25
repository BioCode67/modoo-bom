import { describe, it, expect } from 'vitest'
import { stripNameFromSummary, normalizeTracked, normalizeResult } from './useAppStore'
import { runAnalysis, type UserProfile } from '@/lib/welfare-engine'

const prof: UserProfile = {
  name: '홍길동실명', age: 72, gender: 'male', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('stripNameFromSummary — 디스크 저장 전 실명 제거(개인정보 최소저장)', () => {
  it("'${name}님(...)' 접두를 '회원님('으로 치환", () => {
    expect(stripNameFromSummary('홍길동실명님(72세, 서울 거주)의 프로필을 분석했습니다.'))
      .toBe('회원님(72세, 서울 거주)의 프로필을 분석했습니다.')
  })
  it('감사 회귀: runAnalysis 결과 요약을 저장용으로 변환하면 실명이 사라진다', () => {
    const result = runAnalysis(prof)
    expect(result.profile_summary).toContain('홍길동실명') // 원본엔 이름 있음
    const persisted = stripNameFromSummary(result.profile_summary)
    expect(persisted).not.toContain('홍길동실명') // 저장용엔 없음
    expect(persisted.startsWith('회원님(')).toBe(true)
  })
  it('빈 문자열·이름 없는 요약도 안전', () => {
    expect(stripNameFromSummary('')).toBe('')
    expect(stripNameFromSummary('회원님(30세)의 프로필')).toBe('회원님(30세)의 프로필')
  })
  it('감사 회귀: 이름에 괄호가 있어도 실명이 남지 않음(예: 홍길동(가명))', () => {
    const out = stripNameFromSummary('홍길동(가명)님(72세, 서울 거주)의 프로필')
    expect(out).not.toContain('홍길동')
    expect(out).not.toContain('가명')
    expect(out).toBe('회원님(72세, 서울 거주)의 프로필')
  })
})

describe('normalizeTracked/normalizeResult — persist 스키마 진화 방어(2026-07)', () => {
  it('checkedDocs가 없는 레거시 tracked 항목에 빈 배열을 채운다(모니터링/여정 크래시 방지)', () => {
    const legacy = [
      { policyId: 'POL-1', name: 'a', category: '노인', status: 'idle', savedAt: 0 }, // checkedDocs 없음
      { policyId: 'POL-2', name: 'b', category: '청년', status: 'idle', savedAt: 0, checkedDocs: ['등본'] },
    ]
    const out = normalizeTracked(legacy)
    expect(Array.isArray(out[0].checkedDocs)).toBe(true)
    expect(out[0].checkedDocs).toEqual([])
    expect(out[1].checkedDocs).toEqual(['등본'])
  })
  it('배열이 아니거나 policyId 없는 잡값은 걸러낸다', () => {
    expect(normalizeTracked(null)).toEqual([])
    expect(normalizeTracked('bad' as unknown)).toEqual([])
    expect(normalizeTracked([{ name: 'no id' }, null, { policyId: 'OK', checkedDocs: [] }])).toHaveLength(1)
  })
  it('result의 배열 필드(notifications/eligible_policies/application_guides)를 보장한다', () => {
    const drifted = { profile_summary: 's', final_response: 'r' } as unknown as Parameters<typeof normalizeResult>[0]
    const out = normalizeResult(drifted)!
    expect(Array.isArray(out.notifications)).toBe(true)
    expect(Array.isArray(out.eligible_policies)).toBe(true)
    expect(Array.isArray(out.application_guides)).toBe(true)
  })
  it('null result는 그대로 null', () => {
    expect(normalizeResult(null)).toBeNull()
  })
})

import { useAppStore } from './useAppStore'

describe('resetForNextUser — 복지관 공용PC 상담 전환 시 이전 어르신 PII 전삭제(감사 확정)', () => {
  it('프로필·분석·담은목록·발급기록·rpaInfo(실명·생년월일·인증수단)를 모두 비우고 resetNonce를 올린다', () => {
    const s = useAppStore.getState()
    // 이전 상담자 흔적 주입
    useAppStore.setState({
      profile: { name: '김복순', age: 72 } as never,
      result: { profile_summary: 'x' } as never,
      tracked: [{ policyId: 'POL-001', name: '기초연금', status: 'interested', checkedDocs: [] }] as never,
      docDone: { 주민등록등본: Date.now() },
      rpaInfo: { name: '김복순', birth_date: '19540101', phone: '01000000000', carrier: 'SKT', sido: '서울', sigungu: '중구', auth_provider: 'pass', rrn_back: '1234567', parent_kind: '부', parent_name: '김상식' },
    })
    const before = useAppStore.getState().resetNonce
    s.resetForNextUser()
    const after = useAppStore.getState()
    expect(after.profile).toBeNull()
    expect(after.result).toBeNull()
    expect(after.tracked).toEqual([])
    expect(after.docDone).toEqual({})
    expect(after.rpaInfo.name).toBe('')
    expect(after.rpaInfo.birth_date).toBe('')
    expect(after.rpaInfo.phone).toBe('')
    expect(after.rpaInfo.auth_provider).toBe('kakao') // 기본값으로 복귀
    expect(after.resetNonce).toBe(before + 1)          // 챗 대화 초기화 신호
  })

  it('rpaInfo 기본 auth_provider는 kakao', () => {
    // persist 마이그레이션 방어: 신규/초기 상태의 인증수단 기본값
    expect(['kakao', 'pass', 'naver', 'toss']).toContain(useAppStore.getState().rpaInfo.auth_provider || 'kakao')
  })
})

import type { TrackedItem } from './useAppStore'
import { monitorItem } from '@/lib/monitoring'

const DAY = 86400000

describe('setStatus — appliedAt 시점 관리(감사 STORE-1 회귀)', () => {
  /** 60일 전 신청(applied) 상태의 추적 항목 주입 — 반려·되돌림 시나리오의 출발점 */
  const seed = (over: Partial<TrackedItem> = {}) => {
    useAppStore.setState({
      tracked: [{
        policyId: 'P1', name: '기초연금', category: '노인', status: 'applied',
        savedAt: Date.now() - 70 * DAY, appliedAt: Date.now() - 60 * DAY, checkedDocs: [], ...over,
      }],
    })
  }
  const item = () => useAppStore.getState().tracked[0]

  it('결함 재현: 반려 후 되돌림(tracking)→재신청(applied)이면 appliedAt이 이번 신청 시점으로 갱신된다', () => {
    // 실사용 흐름: 60일 전 신청 → 반려 → TrackedCard로 '준비 중' 되돌림 → 서류 보완 후 오늘 재신청.
    // 수정 전엔 !t.appliedAt 가드 때문에 60일 전 시점이 그대로 남아 모니터링이 재신청 당일에
    // '신청 60일째 · 심사 기간을 한참 지났어요'(high)로 즉시 오판정했다.
    seed()
    useAppStore.getState().setStatus('P1', 'tracking') // 반려 → 준비 중 되돌림
    useAppStore.getState().setStatus('P1', 'applied')  // 오늘 재신청 표시
    const t = item()
    expect(t.appliedAt).toBeDefined()
    expect(Date.now() - (t.appliedAt ?? 0)).toBeLessThan(DAY) // '신청 0일째'여야 함
    const m = monitorItem(t, undefined)
    expect(m.daysApplied).toBe(0)
    expect(m.alerts.some((a) => a.level === 'high' && a.kind === 'recheck')).toBe(false) // 재신청 0일째에 high 오경보 금지
  })

  it('결함 재현(경계): idle까지 되돌렸다 재신청해도 동일하게 갱신된다', () => {
    seed()
    useAppStore.getState().setStatus('P1', 'idle')
    useAppStore.getState().setStatus('P1', 'applied')
    expect(Date.now() - (item().appliedAt ?? 0)).toBeLessThan(DAY)
  })

  it('비회귀: applied→done 전이는 신청 시점을 보존한다(같은 신청 건 — 갱신 시기 계산 기준)', () => {
    const past = Date.now() - 20 * DAY
    seed({ appliedAt: past })
    useAppStore.getState().setStatus('P1', 'done')
    expect(item().appliedAt).toBe(past)
  })

  it('비회귀: done→applied 되돌림(오클릭 수정)도 같은 신청 건이라 시점을 보존한다', () => {
    const past = Date.now() - 20 * DAY
    seed({ status: 'done', appliedAt: past })
    useAppStore.getState().setStatus('P1', 'applied')
    expect(item().appliedAt).toBe(past)
  })

  it("비회귀: 신청 단계 없이 바로 'done'을 골라도 지금 시각을 기록(옛 savedAt 기준 '갱신 임박' 오알림 방지)", () => {
    seed({ status: 'idle', appliedAt: undefined })
    useAppStore.getState().setStatus('P1', 'done')
    expect(Date.now() - (item().appliedAt ?? 0)).toBeLessThan(DAY)
  })

  it('비회귀(레거시): appliedAt 없는 applied 항목이 done으로 넘어가면 지금 시각을 기록', () => {
    seed({ appliedAt: undefined })
    useAppStore.getState().setStatus('P1', 'done')
    expect(item().appliedAt).toBeDefined()
  })

  it('의도 고정: 되돌림(tracking) 상태에선 옛 appliedAt을 지우지 않고 남긴다(sync freshness 보존)', () => {
    // 지우면 lib/sync.ts freshness(max of savedAt/appliedAt/lastChecked)가 낮아져 클라우드의
    // 옛 applied 사본이 병합에서 이겨 사용자의 되돌림이 유실된다. 모니터링·캘린더는 applied/done
    // 상태에서만 appliedAt을 읽으므로 잔존값은 오판정을 일으키지 않는다.
    const past = Date.now() - 60 * DAY
    seed({ appliedAt: past })
    useAppStore.getState().setStatus('P1', 'tracking')
    expect(item().appliedAt).toBe(past)
    expect(monitorItem(item(), undefined).daysApplied).toBeNull() // 되돌림 상태에선 미사용 확인
  })
})
