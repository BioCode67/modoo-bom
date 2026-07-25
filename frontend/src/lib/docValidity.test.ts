import { describe, it, expect } from 'vitest'
import {
  evaluateDoc, validityRule, freshnessLabel, freshnessTone,
  DEFAULT_VALIDITY_DAYS, EXPIRING_SOON_DAYS,
} from './docValidity'

const DAY = 86400000
const NOW = 1_800_000_000_000 // 고정 기준 시각(테스트 결정성)

/** issuedAt = NOW 로부터 daysAgo 일 전 */
const issued = (daysAgo: number) => NOW - daysAgo * DAY

describe('validityRule — 서류별 유효기간 규칙', () => {
  it('일반 발급 증명서는 표준 90일', () => {
    expect(validityRule('주민등록등본').days).toBe(DEFAULT_VALIDITY_DAYS)
    expect(validityRule('가족관계증명서').days).toBe(90)
    expect(validityRule('건강보험 자격득실확인서').days).toBe(90)
  })
  it('장애인증명서는 상태기반 → 만료 없음(days 0)', () => {
    const r = validityRule('장애인증명서')
    expect(r.days).toBe(0)
    expect(r.note).toMatch(/상태/)
  })
  it('납세증명서는 90일이되 서류 인쇄 유효기간 우선 안내(note)', () => {
    expect(validityRule('지방세 납세증명서').days).toBe(90)
    expect(validityRule('지방세 납세증명서').note).toMatch(/유효기간/)
    expect(validityRule('국세 납세증명서').note).toMatch(/유효기간/)
  })
  it('소득금액증명은 과세연도 주의 문구', () => {
    expect(validityRule('소득금액증명').note).toMatch(/과세연도|연도/)
  })
  it('발급 증명서가 아닌 서류(신분증·계약서·통장사본)는 만료 개념 없음(days 0, 거짓 경보 방지)', () => {
    expect(validityRule('신분증').days).toBe(0)
    expect(validityRule('임대차계약서').days).toBe(0)
    expect(validityRule('통장 사본').days).toBe(0)
    expect(validityRule('근로소득원천징수영수증').days).toBe(0) // 발급형 증명서 목록 밖
  })
  it('표기 변형도 정식명으로 해석해 규칙 적용(자녀 주민등록등본 → 등본 90일)', () => {
    expect(validityRule('자녀 주민등록등본').days).toBe(90)
  })
})

describe('evaluateDoc — 발급일 기준 만료 판정', () => {
  it('갓 발급 → fresh, 남은 일수 ≈ 유효기간', () => {
    const v = evaluateDoc('주민등록등본', issued(0), NOW)
    expect(v.freshness).toBe('fresh')
    expect(v.validityDays).toBe(90)
    expect(v.daysLeft).toBe(90)
    expect(v.expiresAt).toBe(issued(0) + 90 * DAY)
  })
  it('만료 임박(경계 안쪽) → expiring', () => {
    // 90일 유효, 발급 후 80일 → 10일 남음(≤14) → expiring
    const v = evaluateDoc('주민등록등본', issued(80), NOW)
    expect(v.freshness).toBe('expiring')
    expect(v.daysLeft).toBe(10)
  })
  it('임계 경계: 정확히 EXPIRING_SOON_DAYS 남으면 expiring', () => {
    const v = evaluateDoc('주민등록등본', issued(90 - EXPIRING_SOON_DAYS), NOW)
    expect(v.daysLeft).toBe(EXPIRING_SOON_DAYS)
    expect(v.freshness).toBe('expiring')
  })
  it('임계 바로 밖(15일 남음)은 아직 fresh', () => {
    const v = evaluateDoc('주민등록등본', issued(90 - (EXPIRING_SOON_DAYS + 1)), NOW)
    expect(v.daysLeft).toBe(EXPIRING_SOON_DAYS + 1)
    expect(v.freshness).toBe('fresh')
  })
  it('유효기간 초과 → expired, daysLeft 음수(지난 일수)', () => {
    const v = evaluateDoc('주민등록등본', issued(100), NOW) // 90일 유효인데 100일 지남
    expect(v.freshness).toBe('expired')
    expect(v.daysLeft).toBe(-10)
  })
  it('정확히 만료일(90일째)은 만료로 본다(경계)', () => {
    const v = evaluateDoc('주민등록등본', issued(90), NOW)
    expect(v.freshness).toBe('expired')
    expect(v.daysLeft).toBe(0)
  })
  it('반나절 남은 경우 올림으로 1일 남음(fresh/expiring 경계 안정)', () => {
    const v = evaluateDoc('주민등록등본', NOW - (90 * DAY - DAY / 2), NOW)
    expect(v.daysLeft).toBe(1)
    expect(v.freshness).toBe('expiring')
  })
  it('상태기반(장애인증명서)은 permanent — 아무리 오래돼도 만료 아님', () => {
    const v = evaluateDoc('장애인증명서', issued(400), NOW)
    expect(v.freshness).toBe('permanent')
    expect(v.expiresAt).toBeNull()
    expect(v.daysLeft).toBeNull()
    expect(v.validityDays).toBe(0)
  })
  it('비발급 서류(신분증)도 permanent(만료 경보 없음)', () => {
    expect(evaluateDoc('신분증', issued(500), NOW).freshness).toBe('permanent')
  })
  it('표시명은 정식명으로 정규화된다(자녀 주민등록등본 → 주민등록등본)', () => {
    expect(evaluateDoc('자녀 주민등록등본', issued(0), NOW).name).toBe('주민등록등본')
  })
})

describe('freshnessLabel — 표시 문구', () => {
  it('상태별 문구가 남은/지난 일수를 정확히 담는다', () => {
    expect(freshnessLabel(evaluateDoc('주민등록등본', issued(0), NOW))).toBe('유효 · 90일 남음')
    expect(freshnessLabel(evaluateDoc('주민등록등본', issued(80), NOW))).toBe('만료 임박 · 10일 남음')
    expect(freshnessLabel(evaluateDoc('주민등록등본', issued(100), NOW))).toBe('만료됨 · 10일 지남')
    expect(freshnessLabel(evaluateDoc('장애인증명서', issued(0), NOW))).toBe('기간 제한 없음')
  })
})

describe('freshnessTone — 상태별 색조', () => {
  it('만료는 rose, 임박은 amber, 유효는 sprout, permanent는 muted', () => {
    expect(freshnessTone('expired').badge).toMatch(/rose/)
    expect(freshnessTone('expiring').badge).toMatch(/amber/)
    expect(freshnessTone('fresh').badge).toMatch(/sprout/)
    expect(freshnessTone('permanent').badge).toMatch(/muted/)
  })
})
