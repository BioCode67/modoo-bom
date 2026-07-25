import { describe, it, expect } from 'vitest'
import { docGuide, guideSummary, METHOD_LABEL } from './docGuide'

describe('docGuide — 발급 방법 매핑', () => {
  it('주민등록등본: 정부24·무인발급기·주민센터, 무료', () => {
    const g = docGuide('주민등록등본')!
    expect(g.fee).toBe('free')
    expect(g.channels.map((c) => c.label)).toContain('정부24')
    expect(g.channels.some((c) => c.method === 'kiosk')).toBe(true)
    expect(g.channels[0].url).toMatch(/gov\.kr/)
  })

  it('등본과 초본을 구분해서 매칭(둘 다 주민등록 포함이어도)', () => {
    expect(docGuide('주민등록등본')!.name).toBe('주민등록등본')
    expect(docGuide('주민등록초본')!.name).toBe('주민등록초본')
  })

  it('소득금액증명은 홈택스가 첫 채널', () => {
    const g = docGuide('소득금액증명')!
    expect(g.channels[0].label).toBe('홈택스')
    expect(g.channels[0].url).toMatch(/hometax/)
  })

  it('지방세 납세증명서는 위택스', () => {
    expect(docGuide('지방세 납세증명서')!.channels[0].label).toBe('위택스')
  })

  it('건강보험 자격득실확인서는 앱·건보·정부24 포함', () => {
    const labels = docGuide('건강보험 자격득실확인서')!.channels.map((c) => c.label)
    expect(labels.some((l) => /건강보험/.test(l))).toBe(true)
    expect(labels).toContain('정부24')
  })

  it('고용보험 이력내역서는 고용24', () => {
    expect(docGuide('고용보험 피보험자격 이력내역서')!.channels[0].label).toBe('고용24')
  })

  it('가족관계증명서는 대법원 전자가족관계등록', () => {
    expect(docGuide('가족관계증명서')!.channels[0].label).toMatch(/대법원/)
  })

  it('통장 사본은 은행 앱/창구 + 안내 note', () => {
    const g = docGuide('통장 사본')!
    expect(g.channels.some((c) => c.method === 'bank' || c.method === 'app')).toBe(true)
    expect(g.note).toMatch(/계좌/)
  })

  it('신분증은 주민센터·본인 소지', () => {
    const g = docGuide('신분증')!
    expect(g.channels.some((c) => c.method === 'visit')).toBe(true)
    expect(g.channels.some((c) => c.method === 'self')).toBe(true)
  })

  it('임대차계약서는 본인 보관(발급 대상 아님)', () => {
    expect(docGuide('임대차계약서')!.channels.some((c) => c.method === 'self')).toBe(true)
  })

  it('원천징수영수증은 직장·홈택스', () => {
    const labels = docGuide('근로소득원천징수영수증')!.channels.map((c) => c.label)
    expect(labels.some((l) => /직장|회사/.test(l))).toBe(true)
  })

  it('표기 변형(자녀 주민등록등본)도 정식명으로 매칭', () => {
    expect(docGuide('자녀 주민등록등본')?.name).toBe('주민등록등본')
  })

  it('알 수 없는 서류는 null(과장 안내 금지)', () => {
    expect(docGuide('무슨무슨 특수서류')).toBeNull()
    expect(docGuide('')).toBeNull()
  })
})

describe('guideSummary · METHOD_LABEL', () => {
  it('채널 라벨을 · 로 이어붙인다', () => {
    expect(guideSummary(docGuide('주민등록등본')!)).toMatch(/정부24/)
    expect(guideSummary(docGuide('주민등록등본')!)).toContain('·')
  })
  it('발급 수단 라벨이 모두 존재', () => {
    expect(METHOD_LABEL.online).toBe('온라인')
    expect(METHOD_LABEL.self).toBe('본인 보관')
    expect(METHOD_LABEL.bank).toBe('은행')
  })
})
