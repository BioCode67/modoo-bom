import { describe, it, expect } from 'vitest'
import { speedTagOf, triageCrises } from './crisisTriage'
import type { TriageGuideHint } from './crisisTriage'
import type { Policy } from '@/data/policies'

// 최소 Policy 팩토리(테스트마다 필요한 필드만 덮어쓴다) — deadline.test.ts 패턴 재사용.
const mk = (over: Partial<Policy>): Policy =>
  ({
    id: 'T',
    name: '',
    category: '',
    target: '',
    benefit: '',
    eligibility: '',
    application: '',
    required_docs: [],
    department: '',
    renewal: '',
    ...over,
  } as Policy)

describe('speedTagOf — 텍스트 도달속도 신호', () => {
  it("'선지원' 문구 → 선지원(now 계열)", () => {
    expect(speedTagOf(mk({ benefit: '요건이 되면 선지원 후 심사' }))).toBe('선지원')
    expect(speedTagOf(mk({ name: '긴급 선지급 제도' }))).toBe('선지원')
  })

  it("'즉시/신속 + 지급' → 선지원", () => {
    expect(speedTagOf(mk({ benefit: '위기 시 즉시 지급' }))).toBe('선지원')
    expect(speedTagOf(mk({ eligibility: '신속 지원 대상' }))).toBe('선지원')
  })

  it("바른 오탐 방지: 맨 '즉시'(임신 확인 즉시)는 선지원이 아님(정직성)", () => {
    // '임신 확인 즉시'처럼 지원·지급과 무관한 '즉시'를 긴급 선지원으로 과장하지 않는다.
    const tag = speedTagOf(mk({ eligibility: '건강보험 가입 임산부 (임신 확인 즉시)', application: '복지로 온라인 신청' }))
    expect(tag).not.toBe('선지원')
    expect(tag).toBe('심사후')
  })

  it("'129·신고전화' → 즉시전화(today)", () => {
    expect(speedTagOf(mk({ application: '주민센터 또는 129 복지콜센터' }))).toBe('즉시전화')
    expect(speedTagOf(mk({ application: '긴급복지 신고전화 129' }))).toBe('즉시전화')
    expect(speedTagOf(mk({ application: '여성긴급전화 1366 또는 상담소' }))).toBe('즉시전화')
  })

  it("'주민센터 방문' → 방문(week)", () => {
    expect(speedTagOf(mk({ application: '주민센터 방문 신청' }))).toBe('방문')
    expect(speedTagOf(mk({ application: '행정복지센터 방문' }))).toBe('방문')
  })

  it('아무 신호 없으면 심사후(기본)', () => {
    expect(speedTagOf(mk({ name: '온라인 지원금', application: '복지로 온라인 신청' }))).toBe('심사후')
  })

  it('우선순위: 선지원 > 즉시전화 > 방문 (겹치면 가장 빠른 것)', () => {
    // 방문·전화·선지원 모두 있으면 선지원
    expect(speedTagOf(mk({ application: '주민센터 방문 또는 129 전화', benefit: '선지원 후 심사' }))).toBe('선지원')
    // 방문·전화만 있으면 즉시전화
    expect(speedTagOf(mk({ application: '주민센터 방문 또는 129 신고전화' }))).toBe('즉시전화')
  })
})

describe('triageCrises — 사다리 재정렬', () => {
  const nowP = mk({ id: 'N', name: '선지원 제도', benefit: '선지원 후 심사' })
  const todayP = mk({ id: 'C', name: '긴급복지', application: '주민센터 또는 129 신고전화' })
  const weekP = mk({ id: 'V', name: '방문형 지원', application: '주민센터 방문 신청' })
  const monthP = mk({ id: 'R', name: '온라인 급여', application: '복지로 온라인 신청' })

  it('빈 입력 → rungs 빈 배열, fastestAction null', () => {
    const r = triageCrises([])
    expect(r.rungs).toEqual([])
    expect(r.fastestAction).toBeNull()
  })

  it('speedTag → when 버킷 매핑 + 사다리 순서(now→today→week→month)', () => {
    // 일부러 역순으로 넣어도 사다리 순서로 정렬돼야 한다.
    const r = triageCrises([monthP, weekP, todayP, nowP])
    expect(r.rungs.map((x) => x.when)).toEqual(['now', 'today', 'week', 'month'])
    expect(r.rungs.map((x) => x.items[0].policy.id)).toEqual(['N', 'C', 'V', 'R'])
  })

  it('빈 버킷은 rung 에서 제외(비어있지 않은 것만)', () => {
    const r = triageCrises([todayP, monthP])
    expect(r.rungs.map((x) => x.when)).toEqual(['today', 'month'])
  })

  it('fastestAction = 가장 빠른 rung 의 첫 항목', () => {
    const r = triageCrises([monthP, todayP]) // 가장 빠른 건 today
    expect(r.fastestAction?.policy.id).toBe('C')
    expect(r.fastestAction?.speedTag).toBe('즉시전화')
  })

  it('각 rung 에 label·urgencyNote 채워짐 + 정직성 라벨(추정) 포함', () => {
    const r = triageCrises([nowP, todayP, weekP, monthP])
    for (const rung of r.rungs) {
      expect(rung.label.length).toBeGreaterThan(0)
      expect(rung.urgencyNote).toMatch(/추정/)
    }
    // now/month 는 공식 확인 권장까지 명시
    const now = r.rungs.find((x) => x.when === 'now')
    expect(now?.urgencyNote).toMatch(/공식 확인 권장/)
  })

  it("모든 timeHint 는 '추정' 라벨을 포함(시간 표기 정직성)", () => {
    const r = triageCrises([nowP, todayP, weekP, monthP])
    const hints = r.rungs.flatMap((x) => x.items.map((i) => i.timeHint))
    expect(hints.length).toBe(4)
    for (const h of hints) expect(h).toMatch(/추정/)
  })
})

describe('triageCrises — estimated_days 정밀화(과정 기반 태그만)', () => {
  const monthP = mk({ id: 'R', name: '온라인 급여', application: '복지로 온라인 신청' }) // 심사후
  const nowP = mk({ id: 'N', name: '선지원 제도', benefit: '선지원 후 심사' }) // 선지원

  it('심사후 + 45일 → recovery, timeHint 에 실제 일수 반영', () => {
    const guides: TriageGuideHint[] = [{ policyId: 'R', estimated_days: 45 }]
    const r = triageCrises([monthP], { guides })
    expect(r.rungs.map((x) => x.when)).toEqual(['recovery'])
    expect(r.rungs[0].items[0].timeHint).toBe('약 45일 내(추정)')
  })

  it('심사후 + 5일 → week 로 앞당김', () => {
    const guides: TriageGuideHint[] = [{ policyId: 'R', estimated_days: 5 }]
    const r = triageCrises([monthP], { guides })
    expect(r.rungs.map((x) => x.when)).toEqual(['week'])
  })

  it('policyName 으로도 소요일 매칭', () => {
    const guides: TriageGuideHint[] = [{ policyName: '온라인 급여', estimated_days: 40 }]
    const r = triageCrises([monthP], { guides })
    expect(r.rungs[0].when).toBe('recovery')
  })

  it('심사후 소요일 경계: 7→week, 8~30→month, 31↑→recovery (경계 정밀 고정)', () => {
    const bucketAt = (days: number) =>
      triageCrises([monthP], { guides: [{ policyId: 'R', estimated_days: days }] }).rungs[0].when
    expect(bucketAt(7)).toBe('week') // 경계값 7 이하는 이번 주
    expect(bucketAt(8)).toBe('month') // 8일부터 이번 달(중간 버킷)
    expect(bucketAt(30)).toBe('month') // 30일까지 이번 달
    expect(bucketAt(31)).toBe('recovery') // 30 초과는 회복 준비
  })

  it('심사후 중간 버킷(month)도 timeHint 에 실제 일수 반영', () => {
    const guides: TriageGuideHint[] = [{ policyId: 'R', estimated_days: 20 }]
    const r = triageCrises([monthP], { guides })
    expect(r.rungs[0].when).toBe('month')
    expect(r.rungs[0].items[0].timeHint).toBe('약 20일 내(추정)')
  })

  it('즉시성 태그(선지원=now)는 소요일이 커도 상단 유지(강등 안 함)', () => {
    const guides: TriageGuideHint[] = [{ policyId: 'N', estimated_days: 99 }]
    const r = triageCrises([nowP], { guides })
    expect(r.rungs[0].when).toBe('now')
    // now 는 즉시 행동이 요점이라 timeHint 도 정성 문구(일수 표기 아님)
    expect(r.rungs[0].items[0].timeHint).toBe('접수 즉시(추정)')
  })
})

describe('triageCrises — oneShot 추론 & 금액 불변(정직성)', () => {
  it('첫만남이용권류 → oneShot true', () => {
    const p = mk({ id: 'P7', name: '첫만남이용권', benefit: '첫째 200만원 바우처', renewal: '1회' })
    const r = triageCrises([p])
    expect(r.rungs[0].items[0].oneShot).toBe(true)
  })

  it('월 지급 프로그램(renewal 1회여도 월 반복)은 oneShot false', () => {
    // 국민취업지원제도: renewal 1회지만 '월 60만원 × 6개월' 월지급 → 일시금 아님
    const p = mk({ id: 'P8', name: '국민취업지원제도', benefit: '구직촉진수당 월 60만원 × 6개월', renewal: '1회' })
    const r = triageCrises([p])
    expect(r.rungs[0].items[0].oneShot).toBe(false)
  })

  it('상시 월지급(기초연금)은 oneShot false', () => {
    const p = mk({ id: 'P1', name: '기초연금', benefit: '월 최대 349,700원 지급', renewal: '매년 재확인' })
    expect(triageCrises([p]).rungs[0].items[0].oneShot).toBe(false)
  })

  it('Policy 원본을 그대로 담는다(금액·문구 재계산 없음)', () => {
    const p = mk({ id: 'X', name: '테스트 급여', benefit: '월 최대 82만원', application: '주민센터 방문' })
    const item = triageCrises([p]).rungs[0].items[0]
    expect(item.policy).toBe(p) // 동일 참조
    expect(item.policy.benefit).toBe('월 최대 82만원') // 문구 불변
  })
})
