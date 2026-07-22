import { describe, it, expect } from 'vitest'
import { planWebAgent, detectDoc, describeWebAgent } from './webAgent'

describe('detectDoc — 목표 문장에서 서류명 인식', () => {
  it('축약어를 정규 서류명으로', () => {
    expect(detectDoc('등본 떼줘')).toBe('주민등록등본')
    expect(detectDoc('초본 발급')).toBe('주민등록초본')
    expect(detectDoc('가족관계증명서 필요해')).toBe('가족관계증명서')
    expect(detectDoc('자격득실 확인서')).toBe('건강보험 자격득실확인서')
  })
  it('더 구체적인 서류를 광범위 규칙보다 먼저', () => {
    expect(detectDoc('지방세 세목별 과세증명서')).toBe('지방세 세목별 과세증명서')
    expect(detectDoc('지방세 납세증명서 발급')).toBe('지방세 납세증명서')
  })
  it('서류가 없으면 undefined', () => {
    expect(detectDoc('안녕하세요')).toBeUndefined()
    expect(detectDoc('')).toBeUndefined()
  })
})

describe('planWebAgent — 목표를 구조화 계획으로', () => {
  it('아는 서류 발급 → 결정적 빠른경로(route)', () => {
    const p = planWebAgent('주민등록등본 발급해줘')
    expect(p.kind).toBe('issue_doc')
    expect(p.engine).toBe('deterministic')
    expect(p.status).toBe('route')
    expect(p.docHint).toBe('주민등록등본')
    expect(p.automatable).toBe(true)
    expect(p.fallbackUrl).toContain('gov.kr')
  })

  it('서류명만 말해도(동사 없이) 발급 의도로', () => {
    const p = planWebAgent('가족관계증명서')
    expect(p.kind).toBe('issue_doc')
    expect(p.docHint).toBe('가족관계증명서')
  })

  it('처음 보는 서류 발급 → 에이전트 경로(agent)', () => {
    const p = planWebAgent('무슨무슨 희한한증명서 발급')
    expect(p.kind).toBe('issue_doc')
    expect(p.engine).toBe('agent')
    expect(p.status).toBe('agent')
    expect(p.docHint).toBeUndefined()
    expect(p.automatable).toBe(true)
  })

  it('복지 신청 → apply_welfare', () => {
    const p = planWebAgent('청년월세 신청하고 싶어')
    expect(p.kind).toBe('apply_welfare')
    expect(p.fallbackUrl).toMatch(/bokjiro|gov\.kr/)
  })

  it('자동화 지원 복지 신청은 automatable', () => {
    const p = planWebAgent('기초연금 신청')
    expect(p.kind).toBe('apply_welfare')
    expect(p.automatable).toBe(true)
    expect(p.engine).toBe('agent')
  })

  it('분류 불가 → 정직한 폴백', () => {
    const p = planWebAgent('오늘 날씨 어때')
    expect(p.kind).toBe('unknown')
    expect(p.engine).toBe('none')
    expect(p.status).toBe('fallback')
    expect(p.automatable).toBe(false)
  })

  it('빈 목표 → 폴백 + 안내', () => {
    const p = planWebAgent('   ')
    expect(p.kind).toBe('unknown')
    expect(p.status).toBe('fallback')
    expect(p.fallbackUrl).toContain('gov.kr')
    expect(p.message.length).toBeGreaterThan(0)
  })

  it('모든 계획은 fallbackUrl 을 항상 채운다(정직 안내)', () => {
    for (const g of ['등본 발급', '기초연금 신청', '희한한거 발급', '아무말']) {
      expect(planWebAgent(g).fallbackUrl).toMatch(/^https?:\/\//)
    }
  })
})

describe('describeWebAgent — 백엔드 연결여부 게이팅(정직성)', () => {
  it('자동화 목표 + 백엔드 연결 → 즉시 진행 안내', () => {
    const p = planWebAgent('주민등록등본 발급')
    expect(describeWebAgent(p, true)).toContain('자동으로 진행')
  })
  it('자동화 목표 + 미연결 → 공식 링크 안내(거짓 자동 약속 금지)', () => {
    const p = planWebAgent('주민등록등본 발급')
    const msg = describeWebAgent(p, false)
    expect(msg).toContain('데스크탑')
    expect(msg).toContain('공식')
  })
  it('자동화 불가 목표는 연결여부와 무관하게 원안내', () => {
    const p = planWebAgent('오늘 날씨 어때')
    expect(describeWebAgent(p, true)).toBe(p.message)
    expect(describeWebAgent(p, false)).toBe(p.message)
  })
})
