import { describe, it, expect } from 'vitest'
import { buildResultText } from './share'

describe('buildResultText — 카톡용 요약 글(정직성)', () => {
  const POLS = [
    { name: '기초연금', benefit: '월 최대 34만원', category: '노인', priority: 'high' },
    { name: '주거급여', benefit: '월 32만원', category: '주거', priority: 'high' },
    { name: '에너지바우처', benefit: '연 30만원 바우처', category: '에너지', priority: 'medium' },
  ]
  it('개수·상위 목록·현금 합계(화면 헤드라인 값 그대로)·링크 포함', () => {
    const t = buildResultText(POLS, '64만원')
    expect(t).toContain('복지 3개')
    expect(t).toContain('기초연금')
    expect(t).toContain('월 최대 64만원')
    expect(t).toContain('중복수급 미반영') // 과장 방지 단서
    expect(t).toContain('biocode67.github.io/modoo-bom')
  })
  it('이름 등 개인정보 미포함 + 합계 없으면 금액 줄 생략', () => {
    const t = buildResultText(POLS, '')
    expect(t).not.toContain('핵심 현금지원')
  })
  it('5개 초과는 …외 N개로 접기', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `정책${i}`, benefit: '', category: '' }))
    const t = buildResultText(many, '')
    expect(t).toContain('외 3개')
  })
})
