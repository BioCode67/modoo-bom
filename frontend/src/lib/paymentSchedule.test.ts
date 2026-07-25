import { describe, it, expect } from 'vitest'
import {
  paymentDay, nextPaymentDate, buildPaymentSchedule, dDayLabel, formatPayDate,
} from './paymentSchedule'
import type { Policy } from '@/data/policies'

const P = (name: string): Policy =>
  ({ id: 'X', name, category: '', target: '', eligibility: '', benefit: '', summary: '',
     how: '', link: '', deadline: '', agency: '', required_docs: [] } as unknown as Policy)

describe('paymentDay — 정책명 → 지급일', () => {
  it('주요 급여 지급일을 매핑(기초연금·아동수당 25일, 장애인연금·생계급여 20일)', () => {
    expect(paymentDay(P('기초연금'))).toBe(25)
    expect(paymentDay(P('아동수당'))).toBe(25)
    expect(paymentDay(P('부모급여(영아수당)'))).toBe(25)
    expect(paymentDay(P('장애인연금'))).toBe(20)
    expect(paymentDay(P('생계급여'))).toBe(20)
    expect(paymentDay(P('주거급여'))).toBe(20)
  })
  it('매핑 안 된 정책은 null(오배정·과장 방지)', () => {
    expect(paymentDay(P('청년월세 특별지원'))).toBeNull()
    expect(paymentDay(P('국민취업지원제도'))).toBeNull()
  })
})

describe('nextPaymentDate — 다음 입금 예정일(주말 보정)', () => {
  it('이번 달 지급일이 아직이면 이번 달 — 2026-07-25(토)는 금요일 7/24로 당김', () => {
    const d = nextPaymentDate(25, new Date(2026, 6, 10)) // 7월 10일 기준
    expect(d.getMonth()).toBe(6)      // 7월
    expect(d.getDate()).toBe(24)      // 25일(토) → 24일(금)
    expect(d.getDay()).toBe(5)        // 금요일
  })
  it('지급일이 지났으면 다음 달 — 7/26 기준 25일은 8/25(화)', () => {
    const d = nextPaymentDate(25, new Date(2026, 6, 26))
    expect(d.getMonth()).toBe(7)      // 8월
    expect(d.getDate()).toBe(25)
    expect(d.getDay()).toBe(2)        // 화요일(주말 아님 → 보정 없음)
  })
  it('평일 지급일은 그대로 — 2026-07-20(월)', () => {
    const d = nextPaymentDate(20, new Date(2026, 6, 10))
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(20)
    expect(d.getDay()).toBe(1)        // 월요일
  })
  it('주말 보정 결과는 절대 토/일이 아니다', () => {
    for (let day = 1; day <= 28; day++) {
      const d = nextPaymentDate(day, new Date(2026, 6, 1))
      expect(d.getDay()).not.toBe(0)
      expect(d.getDay()).not.toBe(6)
    }
  })
})

describe('buildPaymentSchedule — 가까운 순 정렬 + D-day', () => {
  it('매핑 정책만 남기고 가까운 지급일 순으로', () => {
    const list = buildPaymentSchedule(
      [P('기초연금'), P('생계급여'), P('청년월세 특별지원')], // 마지막은 매핑 없음 → 제외
      new Date(2026, 6, 10),
    )
    expect(list.length).toBe(2)
    expect(list[0].policy.name).toBe('생계급여') // 7/20 (dDay 10)
    expect(list[0].dDay).toBe(10)
    expect(list[1].policy.name).toBe('기초연금') // 7/24 (dDay 14)
    expect(list[1].dDay).toBe(14)
    expect(list[1].weekendAdjusted).toBe(true)
  })
  it('오늘이 지급일이면 dDay 0', () => {
    const list = buildPaymentSchedule([P('생계급여')], new Date(2026, 6, 20)) // 7/20 = 지급일(월)
    expect(list[0].dDay).toBe(0)
  })
})

describe('표시 문구', () => {
  it('dDayLabel', () => {
    expect(dDayLabel(0)).toBe('오늘 지급')
    expect(dDayLabel(1)).toBe('내일 지급')
    expect(dDayLabel(14)).toBe('14일 뒤')
  })
  it('formatPayDate — M월 D일(요일)', () => {
    expect(formatPayDate(new Date(2026, 6, 24))).toBe('7월 24일(금)')
  })
})
