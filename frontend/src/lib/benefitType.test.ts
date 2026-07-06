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
  it('감사 회귀: 한글 뒤 "카드"도 voucher(죽은 \\b 패턴 교체) — 교통카드·드림카드', () => {
    expect(benefitTypeOf(P('버스공영제 무료이용 교통카드 지원', ''))).toBe('voucher')
    expect(benefitTypeOf(P('청소년드림카드 지원', ''))).toBe('voucher')
  })
  it('감사 회귀: "보증금·보증료" 무상지원은 loan 아님(그랜트를 빚으로 오분류 금지)', () => {
    expect(benefitTypeOf(P('전세보증금반환보증 보증료 지원', '보증료 지원'))).not.toBe('loan')
    expect(benefitTypeOf(P('저소득 중증장애인 전세주택 지원', '무상으로 전세보증금을 지원'))).not.toBe('loan')
    // 실제 대출보증 상품은 loan 유지
    expect(benefitTypeOf(P('청년창업 특례보증부 대출', '특례보증 융자'))).toBe('loan')
  })
  it('2차 회귀 방지: 임대주택·반환보증(보증보험)은 cash 아님(현금배지 오인 방지)', () => {
    // 사용자가 보증료를 '내는' 보증보험, 집을 '제공'하는 임대주택에 💵현금 배지가 붙으면 안 됨
    expect(benefitTypeOf(P('HUG 전세보증금 반환보증', '보증금을 대신 지급'))).not.toBe('cash')
    expect(benefitTypeOf(P('청년 전세임대주택', '보증금 월 임대료 만원'))).not.toBe('cash')
    expect(benefitTypeOf(P('기숙사형 매입임대', '월 임대료 지원'))).not.toBe('cash')
  })
  it('2차 회귀 방지: 카드 발급수수료 지원은 voucher 아님(요금성 지원)', () => {
    expect(benefitTypeOf(P('장애인통합복지카드 발급수수료 지원', '발급수수료 지원'))).not.toBe('voucher')
  })
  it('3차 회귀 방지: 광의 "임대주택"은 감면/현금/융자를 service로 가로채지 않음(정밀토큰만 유지)', () => {
    // '임대주택' 부분문자열이 요금감면·주거비현금·무이자보증금 정책을 service로 오분류하던 회귀
    expect(benefitTypeOf(P('공공임대주택 공동전기료 감면', '전기료를 감면'))).toBe('discount')
    expect(benefitTypeOf(P('저소득계층 임대보증금 지원 사업', '임대보증금 무이자 융자'))).toBe('loan')
    // 집을 '제공'하는 정밀 케이스는 여전히 service 유지
    expect(benefitTypeOf(P('청년 전세임대주택', '보증금 월 임대료 만원'))).toBe('service')
    expect(benefitTypeOf(P('기숙사형 매입임대', '월 임대료 지원'))).toBe('service')
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

describe('3차 감사 수정 회귀 — 의료급여류는 현물/서비스(현금 아님)', () => {
  it('의료급여·요양급여·장기요양은 cash 아님', () => {
    const mk = (name: string, benefit: string) => ({ id: 'T', name, category: '의료', target: '', benefit, eligibility: '', required_docs: [], application: '', department: '', renewal: '' })
    expect(benefitTypeOf(mk('의료급여 1종', '입원·외래 본인부담 경감'))).not.toBe('cash')
    expect(benefitTypeOf(mk('노인 장기요양보험', '재가급여·시설급여'))).not.toBe('cash')
  })
})
