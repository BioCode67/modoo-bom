import { describe, it, expect, vi, beforeEach } from 'vitest'

// 카탈로그 교차참조(③ borrow)는 빈 배열로 목킹 — β 오버레이(③.5) 경로를 고립 검증
vi.mock('@/data/catalog', () => ({ getCatalog: vi.fn(() => []) }))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
})

import { addApplyExtra, applyExtraUrl, removeApplyExtra, isApplyExtra, isValidBokjiroDeepLink } from './applyExtra'
import { bestApplyUrl, isBokjiroApplyable } from './quickApply'

const DEEP = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF77777777'

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
})

describe('isValidBokjiroDeepLink — β 등재 게이트(백엔드 복지로 URL 검증과 같은 취지)', () => {
  it('복지로 https + wlfareInfoId 딥링크만 허용', () => {
    expect(isValidBokjiroDeepLink(DEEP)).toBe(true)
    expect(isValidBokjiroDeepLink('http://www.bokjiro.go.kr/x?wlfareInfoId=WLF1')).toBe(false) // http 금지
    expect(isValidBokjiroDeepLink('https://evil.example.com/?wlfareInfoId=WLF1')).toBe(false) // 타 호스트 금지
    expect(isValidBokjiroDeepLink('https://www.bokjiro.go.kr/')).toBe(false) // 홈(딥링크 아님)
    expect(isValidBokjiroDeepLink('복지로에서 신청')).toBe(false)
  })
})

describe('applyExtra — 실측 β 매핑의 로컬 기억', () => {
  it('유효 딥링크만 등록·조회·해제', () => {
    expect(addApplyExtra('테스트정책', { url: DEEP, wlfareInfoId: 'WLF77777777' })).toBe(true)
    expect(applyExtraUrl('테스트정책')).toBe(DEEP)
    expect(isApplyExtra('테스트정책')).toBe(true)
    removeApplyExtra('테스트정책')
    expect(applyExtraUrl('테스트정책')).toBeUndefined()
  })
  it('비복지로·비딥링크는 거부(저장 자체가 안 됨 — 오염 차단)', () => {
    expect(addApplyExtra('나쁜정책', { url: 'https://evil.example.com/?wlfareInfoId=WLF1', wlfareInfoId: 'WLF1' })).toBe(false)
    expect(isApplyExtra('나쁜정책')).toBe(false)
  })
  it('저장소 손상(비JSON)이어도 조용히 빈 상태로 동작·복구', () => {
    store['modoobom-apply-extra'] = '{{{'
    expect(applyExtraUrl('아무거나')).toBeUndefined()
    expect(addApplyExtra('복구정책', { url: DEEP, wlfareInfoId: 'WLF77777777' })).toBe(true)
    expect(applyExtraUrl('복구정책')).toBe(DEEP)
  })
})

describe('bestApplyUrl ③.5 — β 오버레이 통합(자동신청 버튼 노출 기준까지)', () => {
  it('일반 홈 착지 + β 등록 → 딥링크로 승격되고 자동신청 가능 판정', () => {
    addApplyExtra('β전용정책', { url: DEEP, wlfareInfoId: 'WLF77777777' })
    expect(bestApplyUrl('복지로 온라인 신청', 'β전용정책', 'GOV-B24-1')).toBe(DEEP)
    expect(isBokjiroApplyable('복지로 온라인 신청', 'β전용정책', 'GOV-B24-1')).toBe(true)
  })
  it('내장 검증 딥링크(KNOWN)가 β보다 항상 우선', () => {
    addApplyExtra('기초연금', { url: DEEP, wlfareInfoId: 'WLF77777777' })
    const u = bestApplyUrl('복지로 온라인 신청', '기초연금', 'POL-001')
    expect(u).not.toBe(DEEP)
    expect(u).toContain('wlfareInfoId=WLF00001164') // 내장 실측 검증값 유지
  })
  it('지자체(LOC-)는 β 오버레이 미적용 — 동명 국가사업 오연결 금지 규칙 유지', () => {
    addApplyExtra('장수수당', { url: DEEP, wlfareInfoId: 'WLF77777777' })
    expect(bestApplyUrl('주민센터 방문 신청', '장수수당', 'LOC-11-001')).not.toBe(DEEP)
    expect(isBokjiroApplyable('주민센터 방문 신청', '장수수당', 'LOC-11-001')).toBe(false)
  })
})
