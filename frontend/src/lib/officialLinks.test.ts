import { describe, it, expect } from 'vitest'
import { applyLink, docLink, isRpaSupported, isApplyAutomatable } from './officialLinks'

describe('applyLink', () => {
  it('복지로 상세 딥링크(application이 URL)면 그 URL 그대로 연결', () => {
    const deep = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000123'
    const r = applyLink(deep)
    expect(r.url).toBe(deep)
    expect(r.label).toContain('복지로')
  })
  it('고용24 URL은 고용24 라벨', () => {
    expect(applyLink('https://www.work24.go.kr/x').label).toContain('고용24')
  })
  it('정부24 URL은 정부24 라벨', () => {
    expect(applyLink('https://www.gov.kr/abc').label).toContain('정부24')
  })
  it('한글 채널 설명(복지로)은 홈으로 폴백', () => {
    expect(applyLink('복지로 또는 주민센터 방문 신청').url).toBe('https://www.bokjiro.go.kr')
  })
  it('빈 값은 복지로 홈 기본값', () => {
    expect(applyLink('').url).toBe('https://www.bokjiro.go.kr')
  })
})

describe('docLink', () => {
  it('주민등록등본 → 정부24 + RPA 지원', () => {
    const r = docLink('주민등록등본')
    expect(r.url).toContain('gov.kr')
    expect(r.rpa).toBe(true)
  })
  it('건강보험 자격득실 → 건보 + RPA', () => {
    expect(docLink('건강보험 자격득실확인서').url).toContain('nhis')
  })
  it('미지정 서류는 정부24 검색으로 폴백', () => {
    expect(docLink('희귀서류명').url).toContain('gov.kr/search')
  })
})

describe('RPA/자동신청 지원 판별', () => {
  it('지원 서류 식별', () => {
    expect(isRpaSupported('주민등록등본')).toBe(true)
    expect(isRpaSupported('통장사본')).toBe(false)
  })
  it('자동신청 가능 서비스 식별', () => {
    expect(isApplyAutomatable('기초연금')).toBe(true)
    expect(isApplyAutomatable('산림복지서비스이용권')).toBe(false)
  })
})
