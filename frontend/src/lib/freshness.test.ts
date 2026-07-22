import { describe, it, expect } from 'vitest'
import type { Policy } from '@/data/policies'
import { assessRecord, summarizeFreshness } from './freshness'

// 최소 Policy 픽스처 헬퍼 — 오버라이드만 지정
const mk = (over: Partial<Policy>): Policy =>
  ({
    id: 'T',
    name: '',
    category: '',
    target: '',
    benefit: '',
    eligibility: '',
    required_docs: [],
    application: '',
    department: '',
    renewal: '',
    ...over,
  }) as Policy

// 고정 '현재' — 날짜 로직은 now 주입으로 결정적 테스트
const NOW = new Date('2026-07-22T00:00:00Z')

// 상세형(POL) — 검증금액·서류·별도 요건·2026 연도
const detailed = mk({
  id: 'POL-001',
  name: '청년월세지원',
  category: '주거',
  target: '만 19~34세 청년',
  benefit: '월 최대 30만원 지원 (2026년 기준)',
  eligibility: '만 19~34세 청년, 소득 하위 50% 이하 무주택 가구 (2026년 기준 중위소득 50%)',
  required_docs: ['신분증', '주민등록등본', '임대차계약서'],
  application: '복지로 온라인 신청',
})

// 요약형(GOV) — 설명형 benefit, 별도 장문 요건, 서류/금액 없음
const summaryLike = mk({
  id: 'GOV-WLF00000072',
  name: '에너지바우처',
  category: '저소득',
  target: '저소득',
  benefit: '에너지취약계층에게 바우처를 지급하여 이용 비용을 지원합니다.',
  eligibility: '만 19~39세 청년으로 기준 중위소득 100% 이하이며 무주택 세대구성원 (자세한 요건 별도 확인)',
  required_docs: [],
  application: '복지로 신청',
})

// 희소형(LOC) — benefit==eligibility 복제, 서류/금액/연락처 없음, 방문 신청, 연도 없음
const sparse = mk({
  id: 'LOC-WLF00006549',
  name: '출산장려금',
  category: '아동',
  target: '[서울특별시 강남구] 출산 가정 지원',
  benefit: '출산 가정에 지원합니다',
  eligibility: '출산 가정에 지원합니다',
  required_docs: [],
  application: '방문',
})

describe('assessRecord — 완결성 레벨', () => {
  it('상세형은 detailed(≥65)이며 검증금액이 잡힌다', () => {
    const r = assessRecord(detailed, NOW)
    expect(r.level).toBe('detailed')
    expect(r.completeness).toBeGreaterThanOrEqual(65)
    expect(r.flags.some((f) => f.kind === 'no_amount')).toBe(false)
  })

  it('설명형·별도 요건만 있으면 summary(35~64)', () => {
    const r = assessRecord(summaryLike, NOW)
    expect(r.level).toBe('summary')
    expect(r.completeness).toBeGreaterThanOrEqual(35)
    expect(r.completeness).toBeLessThan(65)
  })

  it('요건이 benefit 복제이고 서류/금액이 없으면 sparse(<35)', () => {
    const r = assessRecord(sparse, NOW)
    expect(r.level).toBe('sparse')
    expect(r.completeness).toBeLessThan(35)
    expect(r.flags.some((f) => f.kind === 'no_amount')).toBe(true)
    expect(r.flags.some((f) => f.kind === 'no_docs')).toBe(true)
  })

  it('completeness는 0~100 정수로 클램프된다', () => {
    for (const p of [detailed, summaryLike, sparse]) {
      const c = assessRecord(p, NOW).completeness
      expect(Number.isInteger(c)).toBe(true)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(100)
    }
  })
})

describe('assessRecord — 신선도', () => {
  it('현재연도 표기는 current, yearSeen=최댓값', () => {
    const r = assessRecord(mk({ benefit: '월 5만원 (2022년 도입, 2026년 기준 인상)' }), NOW)
    expect(r.yearSeen).toBe(2026) // 최댓값 채택
    expect(r.freshness).toBe('current')
  })

  it('오래된 연도는 possibly_stale + stale_year 플래그/권고', () => {
    const r = assessRecord(mk({ id: 'GOV-X', benefit: '월 5만원 (2021년 기준)', eligibility: '저소득 가구 (2021년)' }), NOW)
    expect(r.yearSeen).toBe(2021)
    expect(r.freshness).toBe('possibly_stale')
    expect(r.flags.some((f) => f.kind === 'stale_year' && f.text.includes('2021'))).toBe(true)
    expect(r.advisories.some((a) => a.includes('최신 기준'))).toBe(true)
  })

  it('잠정 표현(예정)은 provisional로 우선 판정(연도 있어도)', () => {
    const r = assessRecord(mk({ benefit: '청년 지원 (2026년 하반기 도입 예정)' }), NOW)
    expect(r.freshness).toBe('provisional')
    expect(r.flags.some((f) => f.kind === 'provisional')).toBe(true)
  })

  it('연도 토큰이 없으면 unknown(날조 금지, yearSeen=null)', () => {
    const r = assessRecord(sparse, NOW)
    expect(r.yearSeen).toBeNull()
    expect(r.freshness).toBe('unknown')
  })

  it('application URL의 숫자(52011M·wlfareInfoId 등)를 연도로 오탐하지 않는다', () => {
    const r = assessRecord(
      mk({
        name: '어떤복지',
        target: '대상',
        benefit: '지원합니다',
        eligibility: '대상 가구',
        application:
          'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52025M.do?wlfareInfoId=WLF00002026&x=2027',
      }),
      NOW,
    )
    expect(r.yearSeen).toBeNull() // application은 스캔 대상 아님 → 2025/2026/2027 무시
    expect(r.freshness).toBe('unknown')
  })

  it('긴 숫자열에 박힌 연도 부분매칭도 무시(경계 검사)', () => {
    // '520261'처럼 숫자열 안의 2026은 잡지 않는다
    const r = assessRecord(mk({ benefit: '코드 520261 관련 지원' }), NOW)
    expect(r.yearSeen).toBeNull()
  })

  it('now 주입에 따라 같은 레코드의 신선도가 달라진다', () => {
    const rec = mk({ benefit: '월 3만원 (2026년 기준)' })
    expect(assessRecord(rec, new Date('2026-06-01')).freshness).toBe('current')
    expect(assessRecord(rec, new Date('2030-06-01')).freshness).toBe('possibly_stale')
  })
})

describe('assessRecord — 금액 유무는 parseMonthly로만 판단(재계산 아님)', () => {
  it("'월' 없는 금액(축하금 50만원)은 검증금액으로 보지 않는다", () => {
    const r = assessRecord(mk({ benefit: '검정고시 합격 축하금 50만원' }), NOW)
    expect(r.flags.some((f) => f.kind === 'no_amount')).toBe(true)
  })

  it("'월 N만원'은 검증금액으로 인정(no_amount 플래그 없음)", () => {
    const r = assessRecord(mk({ benefit: '월 20만원 지원' }), NOW)
    expect(r.flags.some((f) => f.kind === 'no_amount')).toBe(false)
  })
})

describe('assessRecord — 출처·정직 라벨', () => {
  it('출처 등급은 trustInfo(id)를 반영', () => {
    expect(assessRecord(detailed, NOW).source).toMatch(/보건복지부/)
    expect(assessRecord(sparse, NOW).source).toMatch(/지자체/)
    expect(assessRecord(summaryLike, NOW).source).toMatch(/중앙부처|공공데이터/)
  })

  it('첫 advisory는 항상 휴리스틱 추정임을 명시(권위적 단정 아님)', () => {
    for (const p of [detailed, summaryLike, sparse]) {
      expect(assessRecord(p, NOW).advisories[0]).toMatch(/휴리스틱 추정/)
    }
  })

  it('요약/미검증 레코드에는 공식 확인 권장 문구가 포함', () => {
    const r = assessRecord(sparse, NOW)
    expect(r.advisories.some((a) => a.includes('공식'))).toBe(true)
    expect(r.flags.some((f) => f.kind === 'unverified_source')).toBe(true)
  })

  it('검증된 상세형(POL)에는 미검증 플래그가 없다', () => {
    expect(assessRecord(detailed, NOW).flags.some((f) => f.kind === 'unverified_source')).toBe(false)
  })
})

describe('assessRecord — 방어적 접근', () => {
  it('required_docs/contact가 undefined여도 예외 없이 처리', () => {
    const bad = { ...detailed, required_docs: undefined, contact: undefined } as unknown as Policy
    const r = assessRecord(bad, NOW)
    expect(r.flags.some((f) => f.kind === 'no_docs')).toBe(true)
    expect(r.completeness).toBeGreaterThanOrEqual(0)
  })
})

describe('summarizeFreshness — 추천 묶음 집계', () => {
  const staleGov = mk({ id: 'GOV-STALE', benefit: '월 5만원 (2021년 기준)', eligibility: '저소득 가구 (2021년)', application: '복지로' })

  it("total/verifyCount/summaryCount/staleCount와 정직 note", () => {
    const s = summarizeFreshness([detailed, sparse, staleGov], NOW)
    expect(s.total).toBe(3)
    expect(s.summaryCount).toBe(2) // sparse(LOC) + staleGov(요약형)
    expect(s.staleCount).toBe(1) // staleGov
    expect(s.verifyCount).toBe(2) // detailed(POL·검증·current) 제외
    expect(s.note).toMatch(/추천 3개 중 2개/)
    expect(s.note).toMatch(/공식 확인/)
  })

  it('빈 배열은 total 0 + 안내 note', () => {
    const s = summarizeFreshness([], NOW)
    expect(s.total).toBe(0)
    expect(s.verifyCount).toBe(0)
    expect(s.summaryCount).toBe(0)
    expect(s.staleCount).toBe(0)
    expect(s.note).toBe('점검할 추천이 없어요.')
  })

  it('비배열 입력도 방어(빈 요약)', () => {
    const s = summarizeFreshness(undefined as unknown as Policy[], NOW)
    expect(s.total).toBe(0)
  })
})
