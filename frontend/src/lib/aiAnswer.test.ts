import { describe, it, expect } from 'vitest'
import { buildAiAnswer } from './aiAnswer'

describe('buildAiAnswer', () => {
  it('빈 목록은 빈 문자열', () => {
    expect(buildAiAnswer([], '노인 지원')).toBe('')
  })

  it('한국어 질의: 언어 안내 없이 대표 복지 나열', () => {
    const s = buildAiAnswer(
      [
        { name: '기초연금', benefit: '월 최대 35만원' },
        { name: '장애인연금', benefit: '월 최대 40만원' },
        { name: '한부모 양육비', benefit: '월 23만원' },
        { name: '기타서비스', benefit: '' },
      ],
      '노인인데 돈이 없어요',
    )
    expect(s).toContain('이런 복지가 가장 잘 맞아요: 기초연금, 장애인연금, 한부모 양육비')
    expect(s).not.toContain('문장을 이해했어요')
  })

  it('영어 질의: 영어로 답변(질의 언어 응답) + 통역 129 안내', () => {
    const s = buildAiAnswer([{ name: '기초연금', benefit: '월 최대 35만원' }], 'I am an elderly person living alone')
    expect(s).toMatch(/match you best/)
    expect(s).toContain('129')
    expect(s).toContain('기초연금') // 정책명은 한국어 유지(실제 신청 시스템)
  })

  it('베트남어 질의: 베트남어로 답변', () => {
    const s = buildAiAnswer([{ name: '기초연금', benefit: '' }], 'Tôi là người già sống một mình, không có tiền')
    expect(s).toMatch(/phúc lợi phù hợp/)
  })

  it('대표 복지 이름 중복 제거', () => {
    const s = buildAiAnswer(
      [
        { name: '발달재활서비스', benefit: '' },
        { name: '발달재활서비스', benefit: '' },
        { name: '기초연금', benefit: '' },
      ],
      '아이 돌봄',
    )
    expect((s.match(/발달재활서비스/g) || []).length).toBe(1)
    expect(s).toContain('기초연금')
  })

  it('현금성 금액이 있으면 금액 안내 포함', () => {
    const s = buildAiAnswer([{ name: '긴급복지', benefit: '월 최대 162만원' }], '위기 상황')
    expect(s).toContain('현금성 지원은 월 최대')
  })

  it('현금성 금액이 없으면 금액 안내 없음', () => {
    const s = buildAiAnswer([{ name: '돌봄서비스', benefit: '방문 돌봄 제공' }], '돌봄 필요')
    expect(s).not.toContain('현금성 지원')
  })

  it('감사 회귀: 비현금(재가급여 서비스 한도·바우처)은 "현금성 최대"에 넣지 않음', () => {
    // 노인 장기요양 재가급여 월 한도는 서비스 이용상한(현금 아님) → 현금성 금액으로 과장 금지
    const s = buildAiAnswer([
      { name: '노인 장기요양 재가급여', benefit: '1등급 월 2,069,900원 한도' },
      { name: '노인돌봄 바우처', benefit: '월 27만원 바우처' },
    ], '돌봄이 필요한 노인')
    expect(s).not.toContain('현금성 지원') // 현금성 항목이 없으므로 금액 문구 자체가 없어야
    expect(s).not.toContain('207만원')
  })
  it('감사 회귀: 현금·비현금 섞이면 현금성만 최대로 계산', () => {
    const s = buildAiAnswer([
      { name: '노인 장기요양 재가급여', benefit: '월 2,069,900원 한도' }, // 비현금
      { name: '기초연금', benefit: '월 최대 34만원' }, // 현금
    ], '어르신 지원')
    expect(s).toContain('현금성 지원은 월 최대 34만원') // 재가급여(207만)가 아니라 기초연금(34만)
  })
})
