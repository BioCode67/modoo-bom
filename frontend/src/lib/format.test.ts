import { describe, it, expect } from 'vitest'
import { formatWon, formatWonIntl, parseMonthly, categoryMeta, isCashBenefit, isNonCashKind, sumCashMonthly } from './format'

describe('parseMonthly', () => {
  it('원 단위(전체 숫자) 매칭', () => {
    expect(parseMonthly('월 최대 349,700원 지급')).toBe(349700)
    expect(parseMonthly('0세 월 584,000원')).toBe(584000)
  })
  it('만원 단위 환산', () => {
    expect(parseMonthly('자녀 1인당 월 23만원')).toBe(230000)
    expect(parseMonthly('0세 월 100만원')).toBe(1000000)
    expect(parseMonthly('공익활동형 월 29만원')).toBe(290000)
  })
  it('소수 만원(63.4만원) 환산', () => {
    expect(parseMonthly('사회서비스형 월 63.4만원')).toBe(634000)
  })
  it('원-우선: 납입한도(70만원)가 아니라 실제 혜택(33,000원)을 잡음', () => {
    expect(parseMonthly('월 최대 70만원 납입, 정부기여금 월 최대 33,000원')).toBe(33000)
  })
  it('월 표기 없거나 금액 없으면 0', () => {
    expect(parseMonthly('치료비 전액 지원')).toBe(0)
    expect(parseMonthly('연 13만원 문화 바우처')).toBe(0) // 월이 아닌 연 단위
  })
  it('범위 표기는 상한(최댓값) 채택 — 배지 과소표시 방지', () => {
    expect(parseMonthly('월 4만~18.7만원')).toBe(187000)
    expect(parseMonthly('월 10~30만원')).toBe(300000)
    expect(parseMonthly('월 14만원~22만원')).toBe(220000)
    // 범위가 아닌 단일 표기는 그대로
    expect(parseMonthly('월 30만원 (2024년 기준)')).toBe(300000)
  })
})

describe('isCashBenefit / sumCashMonthly', () => {
  it('현금성: 월 정기 현금은 true', () => {
    expect(isCashBenefit('월 최대 349,700원 지급')).toBe(true)
    expect(isCashBenefit('자녀 1인당 월 23만원')).toBe(true)
  })
  it('현물·바우처·대출·본인부담은 현금성 아님(false)', () => {
    expect(isCashBenefit('월 14만원~22만원 바우처 (소득수준별 차등)')).toBe(false)
    expect(isCashBenefit('보증금 2억원 이내 저금리 대출')).toBe(false)
    expect(isCashBenefit('건강보험 본인부담금 경감')).toBe(false)
    expect(isCashBenefit('치료비 전액 지원')).toBe(false)
  })
  it('서비스 한도액·감면·고용주지원은 개인 현금소득 아님(false)', () => {
    expect(isCashBenefit('노인 장기요양보험 재가급여 월 2,069,900원 한도')).toBe(false)
    expect(isCashBenefit('저소득층 통신요금 월 26,000원 감면')).toBe(false)
    expect(isCashBenefit('고령자 고용장려금 월 30만원 (사업주 지원)')).toBe(false)
  })
  it('금액만 있고 종류는 정책명에 있는 서비스도 context로 제외', () => {
    // benefit 문구엔 금액만, 정책명에 '장기요양/재가급여'가 있는 경우
    expect(isCashBenefit('월 최대 2,069,900원 한도', '노인 장기요양보험 (재가급여)')).toBe(false)
    expect(sumCashMonthly([{ benefit: '월 최대 2,069,900원 한도', name: '노인 장기요양보험 (재가급여)' }])).toBe(0)
  })
  it('월 금액 없으면 false', () => {
    expect(isCashBenefit('재가급여 등급별 월 한도액 이내')).toBe(false)
  })
  it('합계는 현금성만 더함(바우처·현물 제외)', () => {
    const items = [
      { benefit: '월 최대 349,700원 지급' }, // 35만 (현금)
      { benefit: '자녀 1인당 월 23만원' }, // 23만 (현금)
      { benefit: '월 14만원 바우처' }, // 제외
      { benefit: '치료비 전액 지원' }, // 제외(월 금액 없음)
    ]
    expect(sumCashMonthly(items)).toBe(349700 + 230000)
  })
})

describe('formatWon', () => {
  it('0/음수 → -', () => {
    expect(formatWon(0)).toBe('-')
    expect(formatWon(-5)).toBe('-')
  })
  it('만원/원/억원 단위', () => {
    expect(formatWon(230000)).toBe('23만원')
    expect(formatWon(5000)).toBe('5,000원')
    expect(formatWon(100000000)).toBe('1억원')
    expect(formatWon(150000000)).toBe('1.5억원')
  })
})

describe('categoryMeta', () => {
  it('카테고리별 이모지 매핑', () => {
    expect(categoryMeta('노인').emoji).toBe('👵')
    expect(categoryMeta('장애인').emoji).toBe('♿')
    expect(categoryMeta('아동·영유아').emoji).toBe('👶')
    expect(categoryMeta('주거').emoji).toBe('🏠')
  })
  it('미지정 카테고리는 기본값 🌼', () => {
    expect(categoryMeta('처음보는분류').emoji).toBe('🌼')
    expect(categoryMeta('').emoji).toBe('🌼')
  })
  it('기존 제네릭이던 카테고리에 의미 아이콘 부여(2026-07)', () => {
    expect(categoryMeta('긴급복지').emoji).toBe('🆘')
    expect(categoryMeta('긴급돌봄').emoji).toBe('🆘')
    expect(categoryMeta('산재').emoji).toBe('🦺')
    expect(categoryMeta('다자녀').emoji).toBe('👨‍👩‍👧‍👦')
    expect(categoryMeta('농어민').emoji).toBe('🌾')
    expect(categoryMeta('보훈').emoji).toBe('🎖️')
    expect(categoryMeta('탈북민').emoji).toBe('🕊️')
    expect(categoryMeta('외국인근로자').emoji).toBe('🌏')
    expect(categoryMeta('청소년').emoji).toBe('🧑')
    expect(categoryMeta('여성복지').emoji).toBe('👩')
    // 농어촌출산은 '출산' 우선(임신부 아이콘) — 구체 분기가 앞
    expect(categoryMeta('농어촌출산').emoji).toBe('🤰')
  })
  it('한부모는 임신부(🤰)로 오매핑되지 않음 — 부분문자열 "모" 회귀', () => {
    expect(categoryMeta('한부모가족').emoji).toBe('👨‍👩‍👧') // 가족
    expect(categoryMeta('한부모주거').emoji).toBe('🏠')       // 주거가 더 앞 — 주거 아이콘이 적절
    expect(categoryMeta('한부모가족').emoji).not.toBe('🤰')
    // 실제 임신·출산·모성 카테고리는 여전히 🤰
    expect(categoryMeta('임신·출산').emoji).toBe('🤰')
    expect(categoryMeta('모성보호').emoji).toBe('🤰')
  })
})

describe('isCashBenefit 감사 수정 회귀 — 현물·자산형성 과장 방지(2026-07)', () => {
  it('현물(꾸러미·농산물)은 현금성 아님', () => {
    expect(isCashBenefit('월 48,000원 상당 친환경 농산물 꾸러미')).toBe(false)
    expect(isCashBenefit('분유·기저귀 지원', '영아 물품 지원')).toBe(false)
  })
  it('자산형성(적금·저축계좌·기여금)은 매월 가처분 현금 아님 → 제외', () => {
    expect(isCashBenefit('정부기여금 월 6만원', '청년미래적금')).toBe(false)
    expect(isCashBenefit('월 10만원 저축 시 매칭', '청년내일저축계좌')).toBe(false)
  })
  it('진짜 현금 지원은 그대로 현금성', () => {
    expect(isCashBenefit('월 30만원 현금 지급', '기초연금')).toBe(true)
  })
})

describe('isNonCashKind / 상품권·융자 제외(2026-07) — 월반복·일시금 공통 현금 기준', () => {
  it('상품권·융자는 현금성 아님(월 지원이어도)', () => {
    expect(isCashBenefit('월 20만원 온누리상품권')).toBe(false)
    expect(isCashBenefit('창업 융자 월 상환 지원 30만원')).toBe(false)
  })
  it('isNonCashKind — 바우처·이용권·상품권·대출·융자·현물·서비스한도·자산형성은 true', () => {
    expect(isNonCashKind('첫만남이용권 200만원 국민행복카드 바우처')).toBe(true) // 이용권·바우처
    expect(isNonCashKind('축하금 상품권 30만원')).toBe(true)                    // 상품권
    expect(isNonCashKind('정착금 500만원 융자')).toBe(true)                     // 융자
    expect(isNonCashKind('노인 장기요양 재가급여 한도')).toBe(true)            // 서비스 한도
    expect(isNonCashKind('청년내일저축계좌 정부기여금')).toBe(true)           // 자산형성
  })
  it('isNonCashKind — 순수 현금 일시금/월지원은 false(월액 유무와 무관)', () => {
    expect(isNonCashKind('해산급여 70만원 일시금')).toBe(false)
    expect(isNonCashKind('출산지원금 100만원 현금 지급')).toBe(false)
    expect(isNonCashKind('기초연금 월 34만원')).toBe(false)
  })
})

describe('formatWonIntl — 외국어용 원화 표기(2026-07)', () => {
  it('₩+천단위 구분(만원 단위 배제)', () => {
    expect(formatWonIntl(1990000)).toBe('₩1,990,000')
    expect(formatWonIntl(350000)).toBe('₩350,000')
    expect(formatWonIntl(0)).toBe('')
    expect(formatWonIntl(-5)).toBe('')
  })
})
