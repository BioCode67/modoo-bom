import { describe, it, expect } from 'vitest'
import { docCoverage, coverageLabel } from './docCoverage'
import type { Policy } from '@/data/policies'

const P = (docs: string[]): Pick<Policy, 'required_docs'> => ({ required_docs: docs })

describe('docCoverage — 자동발급 커버리지', () => {
  it('자동발급 서류와 직접 준비 서류를 분리 카운트', () => {
    const c = docCoverage(P(['주민등록등본', '소득금액증명', '통장 사본', '신분증']))
    expect(c.total).toBe(4)
    expect(c.issuable).toBe(2)        // 등본·소득금액증명
    expect(c.manual).toBe(2)          // 통장사본·신분증
    expect(c.issuableDocs).toContain('주민등록등본')
    expect(c.manualDocs).toContain('통장 사본')
    expect(c.ratio).toBeCloseTo(0.5)
  })

  it('전부 자동발급 대상', () => {
    const c = docCoverage(P(['주민등록등본', '가족관계증명서']))
    expect(c.issuable).toBe(2)
    expect(c.manual).toBe(0)
    expect(c.ratio).toBe(1)
  })

  it('자동발급 대상 없음', () => {
    const c = docCoverage(P(['통장 사본', '임대차계약서']))
    expect(c.issuable).toBe(0)
    expect(c.ratio).toBe(0)
  })

  it('표기 변형(자녀 주민등록등본)도 정식명으로 자동발급 인식', () => {
    const c = docCoverage(P(['자녀 주민등록등본']))
    expect(c.issuable).toBe(1)
    expect(c.issuableDocs[0]).toBe('주민등록등본')
  })

  it('빈 서류 목록은 total 0, ratio 0(0 나눗셈 방어)', () => {
    const c = docCoverage(P([]))
    expect(c.total).toBe(0)
    expect(c.ratio).toBe(0)
  })
})

describe('coverageLabel — 요약 문구', () => {
  it('상황별 문구', () => {
    expect(coverageLabel(docCoverage(P([])))).toMatch(/정보 없음/)
    expect(coverageLabel(docCoverage(P(['통장 사본'])))).toMatch(/대상 서류 없음/)
    expect(coverageLabel(docCoverage(P(['주민등록등본', '가족관계증명서'])))).toMatch(/전부 자동발급/)
    expect(coverageLabel(docCoverage(P(['주민등록등본', '통장 사본'])))).toMatch(/2종 중 1종/)
  })
})
