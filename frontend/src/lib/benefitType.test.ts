import { describe, it, expect } from 'vitest'
import { benefitTypeOf, BENEFIT_TYPE_META } from './benefitType'
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'

const P = (name: string, benefit: string): Policy =>
  ({ id: 'T', name, category: '', target: '', eligibility: '', benefit, required_docs: [], application: '', department: '', renewal: '' } as Policy)

describe('benefitType — 지원형태 규칙 태깅', () => {
  it('대출/융자 → loan', () => {
    expect(benefitTypeOf(P('햇살론유스', '생활안정자금 대출 최대 1200만원'))).toBe('loan')
    expect(benefitTypeOf(P('전세자금 버팀목', '전세자금 융자'))).toBe('loan')
  })
  it('바우처·카드 → voucher', () => {
    expect(benefitTypeOf(P('문화누리카드', '문화 이용권 지원'))).toBe('voucher')
    expect(benefitTypeOf(P('에너지바우처', '난방 바우처 지급'))).toBe('voucher')
  })
  it('요금 감면 → discount', () => {
    expect(benefitTypeOf(P('다자녀 전기요금 감면', '전기요금 감면'))).toBe('discount')
  })
  it('현금·수당·연금 → cash', () => {
    expect(benefitTypeOf(P('기초연금', '월 최대 34만원 지급'))).toBe('cash')
    expect(benefitTypeOf(P('아동수당', '월 10만원'))).toBe('cash')
  })
  it('돌봄·서비스 → service', () => {
    expect(benefitTypeOf(P('노인맞춤돌봄서비스', '방문 돌봄 서비스 제공'))).toBe('service')
  })
  it('신호 없으면 null(억지 분류 안 함)', () => {
    expect(benefitTypeOf(P('무슨사업', ''))).toBeNull()
  })
  it('실카탈로그: 상당수 정책에 형태가 태깅된다(지자체 현금필터 보완)', () => {
    const cat = getCatalog()
    const tagged = cat.filter((p) => benefitTypeOf(p) !== null)
    // 최소 40% 이상은 형태 신호를 가진다(요약형 LOC도 명칭 신호로 상당수 복구)
    expect(tagged.length / cat.length).toBeGreaterThan(0.4)
    // 메타는 모든 타입에 라벨·이모지
    for (const k of Object.keys(BENEFIT_TYPE_META)) {
      expect(BENEFIT_TYPE_META[k as keyof typeof BENEFIT_TYPE_META].label).toBeTruthy()
    }
  })
})
