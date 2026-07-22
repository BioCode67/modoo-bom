import { describe, it, expect } from 'vitest'
import {
  classifyDoc,
  classifyDocSharing,
  SHAREABLE_DOCS,
  type Sharable,
} from './sharedDocInfo'
import type { Policy } from '@/data/policies'
import { WELFARE_POLICIES } from '@/data/policies'

// 결정적 테스트용 Policy 팩토리 — required_docs만 지정하고 나머지는 채운다.
const P = (docs: string[]): Policy =>
  ({
    id: 'T',
    name: 'T',
    category: '',
    target: '',
    benefit: '',
    eligibility: '',
    required_docs: docs,
    application: '',
    department: '',
    renewal: '',
  }) as Policy

describe('classifyDoc — 공동이용 대상 서류는 yes', () => {
  it('등본·초본·가족관계·소득금액증명 → yes', () => {
    expect(classifyDoc('주민등록등본')).toBe('yes')
    expect(classifyDoc('주민등록초본')).toBe('yes')
    expect(classifyDoc('가족관계증명서')).toBe('yes')
    expect(classifyDoc('소득금액증명')).toBe('yes')
  })

  it('건강보험료 납부확인서/영수증·장애인증명/등록 → yes', () => {
    expect(classifyDoc('건강보험료 납부확인서')).toBe('yes')
    expect(classifyDoc('건강보험료 납부영수증')).toBe('yes') // '영수증'이 들어가도 보험료 납부는 공동이용
    expect(classifyDoc('장애인증명서')).toBe('yes')
    expect(classifyDoc('장애인등록증')).toBe('yes')
  })

  it('수급자·한부모 확인서 → yes', () => {
    expect(classifyDoc('수급자 확인서')).toBe('yes')
    expect(classifyDoc('한부모 확인서')).toBe('yes')
  })

  it('잡음이 섞인 문자열 안에 공동이용 키워드가 있으면 yes', () => {
    expect(classifyDoc('소득 확인서류(소득금액증명 등)')).toBe('yes')
  })
})

describe('classifyDoc — 본인 제출 서류는 단정 no', () => {
  it('통장·신분증·증명사진 → no', () => {
    expect(classifyDoc('통장 사본')).toBe('no')
    expect(classifyDoc('아동 명의 통장')).toBe('no')
    expect(classifyDoc('신분증')).toBe('no')
    expect(classifyDoc('증명사진')).toBe('no')
  })

  it('임대차/근로 계약서 → no', () => {
    expect(classifyDoc('임대차계약서')).toBe('no')
    expect(classifyDoc('근로계약서')).toBe('no')
  })

  it('동의서·본인서명 → no', () => {
    expect(classifyDoc('금융정보 제공 동의서')).toBe('no')
    expect(classifyDoc('본인서명 확인서')).toBe('no')
  })

  it('본인 작성(신고서·계획서)·병원 발급(진단서·소견서) → no', () => {
    expect(classifyDoc('소득·재산 신고서')).toBe('no')
    expect(classifyDoc('사업계획서')).toBe('no')
    expect(classifyDoc('진단서')).toBe('no')
    expect(classifyDoc('의사소견서')).toBe('no')
  })

  it('월세 이체확인증 → no', () => {
    expect(classifyDoc('월세 이체확인증(최근 3개월)')).toBe('no')
  })
})

describe('classifyDoc — 애매하면 보수적으로 maybe', () => {
  it('건강보험증(카드)·재학증명서·소득 증빙·취업경험 확인서류 → maybe', () => {
    expect(classifyDoc('건강보험증')).toBe('maybe')
    expect(classifyDoc('재학증명서')).toBe('maybe')
    expect(classifyDoc('소득 증빙')).toBe('maybe')
    expect(classifyDoc('취업경험 확인서류')).toBe('maybe')
  })

  it('빈 값/공백은 판단 보류(maybe) — 무가드 접근 방지', () => {
    expect(classifyDoc('')).toBe('maybe')
    expect(classifyDoc('   ')).toBe('maybe')
  })

  it('NO 키가 SHAREABLE보다 우선 — 등본이라도 신분증이 함께면 no(false yes 방지)', () => {
    expect(classifyDoc('주민등록등본 및 신분증')).toBe('no')
  })
})

describe('SHAREABLE_DOCS 상수', () => {
  it('비어있지 않은 문자열 배열이고 대표 항목을 포함한다', () => {
    expect(Array.isArray(SHAREABLE_DOCS)).toBe(true)
    expect(SHAREABLE_DOCS.length).toBeGreaterThan(0)
    expect(SHAREABLE_DOCS.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
    expect(SHAREABLE_DOCS).toContain('주민등록등본')
    expect(SHAREABLE_DOCS).toContain('가족관계증명서')
  })
})

describe('classifyDocSharing — 정책 단위 진단', () => {
  it('yes/no가 섞인 정책: skippableCount=yes 수, consentNeeded=true, rows 원문 보존', () => {
    const plan = classifyDocSharing(
      P(['신분증', '통장 사본', '금융정보 제공 동의서', '소득·재산 신고서', '주민등록등본']),
    )
    expect(plan.rows).toHaveLength(5)
    expect(plan.rows.map((r) => r.doc)).toEqual([
      '신분증',
      '통장 사본',
      '금융정보 제공 동의서',
      '소득·재산 신고서',
      '주민등록등본',
    ])
    expect(plan.skippableCount).toBe(1)
    expect(plan.consentNeeded).toBe(true)
    expect(plan.summary).toContain('5건 중 1건')
  })

  it('청년월세형(등본·가족관계·소득금액증명 3건 생략 가능)', () => {
    const plan = classifyDocSharing(
      P([
        '임대차계약서',
        '월세 이체확인증(최근 3개월)',
        '주민등록등본',
        '가족관계증명서',
        '소득금액증명',
        '통장 사본',
      ]),
    )
    expect(plan.skippableCount).toBe(3)
    expect(plan.consentNeeded).toBe(true)
  })

  it('공동이용 대상이 없으면 consentNeeded=false, skippableCount=0', () => {
    const plan = classifyDocSharing(P(['신분증', '진단서', '사업계획서']))
    expect(plan.skippableCount).toBe(0)
    expect(plan.consentNeeded).toBe(false)
    expect(plan.summary).toContain('직접 준비')
  })

  it('required_docs가 비면 rows=[], count=0, consent=false, 안전한 summary', () => {
    const plan = classifyDocSharing(P([]))
    expect(plan.rows).toHaveLength(0)
    expect(plan.skippableCount).toBe(0)
    expect(plan.consentNeeded).toBe(false)
    expect(plan.summary.length).toBeGreaterThan(0)
  })

  it('required_docs 필드가 없어도 던지지 않고 방어(무가드 접근 방지)', () => {
    // @ts-expect-error 런타임 방어 검증 — 의도적으로 필드 누락
    const plan = classifyDocSharing({ id: 'X', name: 'X' })
    expect(plan.rows).toHaveLength(0)
    expect(plan.skippableCount).toBe(0)
    expect(plan.consentNeeded).toBe(false)
  })

  it('skippableCount는 항상 rows 중 yes 수와 일치(불변식)', () => {
    for (const pol of WELFARE_POLICIES.slice(0, 40)) {
      const plan = classifyDocSharing(pol)
      const yesCount = plan.rows.filter((r) => r.sharable === 'yes').length
      expect(plan.rows).toHaveLength(pol.required_docs.length)
      expect(plan.skippableCount).toBe(yesCount)
      expect(plan.consentNeeded).toBe(yesCount > 0)
    }
  })
})

describe('정직성 라벨 — why/summary에 추정·접수처 확인 취지 포함', () => {
  it("yes 사유엔 '추정'과 '공동이용'·'접수처'가 들어간다(단정 회피)", () => {
    const plan = classifyDocSharing(P(['주민등록등본']))
    const why = plan.rows[0].why
    expect(why).toContain('추정')
    expect(why).toContain('공동이용')
    expect(why).toContain('접수처')
  })

  it("maybe 사유엔 '추정'과 '접수처'·'확인'이 들어간다", () => {
    const plan = classifyDocSharing(P(['소득 증빙']))
    const why = plan.rows[0].why
    expect(why).toContain('추정')
    expect(why).toContain('접수처')
    expect(why).toContain('확인')
  })

  it("생략 가능 건이 있으면 summary에 '추정'과 '공동이용 동의' 표기", () => {
    const plan = classifyDocSharing(P(['주민등록등본', '신분증']))
    expect(plan.summary).toContain('추정')
    expect(plan.summary).toContain('공동이용 동의')
  })
})

// 타입 스모크: Sharable 유니온이 export되는지(컴파일 타임)
const _sharableSmoke: Sharable = 'maybe'
void _sharableSmoke
