import { describe, it, expect } from 'vitest'
import {
  crisisDocsFor,
  crisisEvidence,
  CRISIS_EVIDENCE,
  type EvidenceDoc,
  type EvidenceSource,
  type EvidenceEffort,
} from './crisisEvidence'

const SOURCES: EvidenceSource[] = ['정부24', '병원', '직장', '경찰·소방', '주민센터', '금융기관']
const EFFORTS: EvidenceEffort[] = ['바로발급', '요청필요']
// 앱의 위기 분류(lib/emergency.ts CRISES)와 동일한 key
const KEYS = ['joblost', 'sick', 'death', 'business', 'disaster', 'housing', 'violence', 'birth']

describe('CRISIS_EVIDENCE 매핑', () => {
  it('앱 위기 key(CRISES와 동일)가 모두 label과 함께 존재', () => {
    for (const k of KEYS) {
      expect(CRISIS_EVIDENCE[k]).toBeTruthy()
      expect(CRISIS_EVIDENCE[k].label.length).toBeGreaterThan(0)
    }
  })

  it('각 위기는 2~4개의 대표 입증서류를 가진다', () => {
    for (const k of KEYS) {
      const n = CRISIS_EVIDENCE[k].docs.length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(4)
    }
  })
})

describe('crisisDocsFor', () => {
  it('알려진 key는 유효한 구조의 서류 목록을 반환(source/effort 유니온·불리언 필드)', () => {
    const docs = crisisDocsFor('joblost')
    expect(docs.length).toBeGreaterThanOrEqual(2)
    for (const d of docs) {
      expect(SOURCES).toContain(d.source)
      expect(EFFORTS).toContain(d.effort)
      expect(typeof d.deferrable).toBe('boolean')
      expect(typeof d.issuedAlready).toBe('boolean')
      expect(d.name.length).toBeGreaterThan(0)
      expect(d.proves.length).toBeGreaterThan(0)
    }
  })

  it('issuedAlready는 기본 false로 반환(대조 전엔 발급됨을 단정하지 않음)', () => {
    for (const k of KEYS) {
      for (const d of crisisDocsFor(k)) expect(d.issuedAlready).toBe(false)
    }
  })

  it('알 수 없는 key는 빈 배열(조용히 스킵)', () => {
    expect(crisisDocsFor('unknown')).toEqual([])
    expect(crisisDocsFor('')).toEqual([])
  })

  it('반환값은 사본이라 변형해도 상수 원본이 오염되지 않는다', () => {
    const first = crisisDocsFor('sick')
    first[0].issuedAlready = true
    first[0].name = 'MUTATED'
    const second = crisisDocsFor('sick')
    expect(second[0].issuedAlready).toBe(false)
    expect(second[0].name).not.toBe('MUTATED')
  })
})

describe('crisisEvidence — 그룹 구성', () => {
  it('선택한 위기마다 label 포함 Crisis와 서류 그룹을 만든다', () => {
    const plan = crisisEvidence(['joblost', 'death'])
    expect(plan.groups.map((g) => g.crisis.key)).toEqual(['joblost', 'death'])
    expect(plan.groups[0].crisis.label).toBe(CRISIS_EVIDENCE.joblost.label)
    expect(plan.groups[1].docs.length).toBeGreaterThan(0)
  })

  it('순서를 보존하고 중복 key는 한 번만 그룹화', () => {
    const plan = crisisEvidence(['business', 'joblost', 'business'])
    expect(plan.groups.map((g) => g.crisis.key)).toEqual(['business', 'joblost'])
  })

  it('알 수 없는 key는 조용히 건너뛰고 알려진 것만 남긴다', () => {
    const plan = crisisEvidence(['nope', 'housing', 'ghost'])
    expect(plan.groups.map((g) => g.crisis.key)).toEqual(['housing'])
  })

  it('빈 입력·전부 미지 key면 groups는 비지만 deferNote는 유지', () => {
    expect(crisisEvidence([]).groups).toEqual([])
    const plan = crisisEvidence(['x', 'y'])
    expect(plan.groups).toEqual([])
    expect(plan.deferNote.length).toBeGreaterThan(0)
  })

  it('opts 미지정이어도 동작하고 issuedAlready는 모두 false', () => {
    const plan = crisisEvidence(['sick'])
    for (const d of plan.groups[0].docs) expect(d.issuedAlready).toBe(false)
  })
})

describe('crisisEvidence — issuedDocs 대조(공백무시, 넘겨받은 것만)', () => {
  const findDoc = (plan: ReturnType<typeof crisisEvidence>, key: string, part: string): EvidenceDoc => {
    const g = plan.groups.find((x) => x.crisis.key === key)!
    return g.docs.find((d) => d.name.includes(part))!
  }

  it('발급한 서류는 issuedAlready=true로 대조된다', () => {
    const plan = crisisEvidence(['death'], { issuedDocs: ['가족관계증명서', '기본증명서'] })
    expect(findDoc(plan, 'death', '가족관계증명서').issuedAlready).toBe(true)
    expect(findDoc(plan, 'death', '기본증명서').issuedAlready).toBe(true)
  })

  it('띄어쓰기가 달라도(공백무시) 매칭된다', () => {
    const plan = crisisEvidence(['death'], { issuedDocs: ['가족관계 증명서', '기본 증명서'] })
    expect(findDoc(plan, 'death', '가족관계증명서').issuedAlready).toBe(true)
    expect(findDoc(plan, 'death', '기본증명서').issuedAlready).toBe(true)
  })

  it('발급하지 않은 서류는 false로 남는다(상상 금지)', () => {
    const plan = crisisEvidence(['death'], { issuedDocs: ['운전면허증'] })
    for (const d of plan.groups[0].docs) expect(d.issuedAlready).toBe(false)
    // 폐업·사업 서류는 정부24 등본을 넣어도 오탐되지 않는다
    const biz = crisisEvidence(['business'], { issuedDocs: ['주민등록등본'] })
    for (const d of biz.groups[0].docs) expect(d.issuedAlready).toBe(false)
  })

  it("부분 포함으로 다른 서류를 오탐하지 않는다('진단서'≠'사망진단서')", () => {
    // 질병으로 '진단서'를 발급했다고 사망 그룹의 '사망진단서'까지 발급됨으로 번지면 안 된다(상상 금지)
    const plan = crisisEvidence(['sick', 'death'], { issuedDocs: ['진단서'] })
    const sick = plan.groups.find((g) => g.crisis.key === 'sick')!
    const death = plan.groups.find((g) => g.crisis.key === 'death')!
    expect(sick.docs.find((d) => d.name === '진단서')!.issuedAlready).toBe(true)
    // 사망진단서는 '진단서'를 부분 포함하지만 다른 서류 → false 유지
    expect(death.docs.find((d) => d.name.includes('사망진단서'))!.issuedAlready).toBe(false)
  })

  it('대조로 true가 되어도 상수 원본·후속 호출을 오염시키지 않는다', () => {
    const matched = crisisEvidence(['death'], { issuedDocs: ['가족관계증명서', '기본증명서'] })
    expect(matched.groups[0].docs.some((d) => d.issuedAlready)).toBe(true)
    // 공유 상수 CRISIS_EVIDENCE는 항상 false(대조 결과가 상수로 새지 않음)
    for (const d of CRISIS_EVIDENCE.death.docs) expect(d.issuedAlready).toBe(false)
    // issuedDocs 없는 후속 호출도 전부 false
    for (const d of crisisEvidence(['death']).groups[0].docs) expect(d.issuedAlready).toBe(false)
  })
})

describe('정직성 — deferNote(선지원 후심사·129·주민센터·골든타임)', () => {
  it('deferNote가 골든타임 우선 원칙을 명시한다', () => {
    const note = crisisEvidence(['joblost']).deferNote
    expect(note).toMatch(/선지원\s*후심사/)
    expect(note).toContain('129')
    expect(note).toContain('주민센터')
    expect(note).toContain('골든타임')
  })

  it('조건부 서류는 proves에 (해당) 라벨을 담아 과장하지 않는다', () => {
    // 폭력·학대 그룹의 보호시설 입소확인서는 조건부('해당 시')
    const violence = crisisEvidence(['violence']).groups[0].docs
    const conditional = violence.filter((d) => /해당/.test(d.proves))
    expect(conditional.length).toBeGreaterThan(0)
  })
})

describe('데이터셋 커버리지', () => {
  it('발급처 유니온(정부24·병원·직장·경찰·소방·주민센터·금융기관)이 모두 실제로 사용된다', () => {
    const used = new Set<EvidenceSource>()
    for (const k of KEYS) for (const d of crisisDocsFor(k)) used.add(d.source)
    for (const s of SOURCES) expect(used.has(s)).toBe(true)
  })

  it('바로발급·요청필요 두 난이도가 데이터에 함께 존재한다', () => {
    const efforts = new Set<EvidenceEffort>()
    for (const k of KEYS) for (const d of crisisDocsFor(k)) efforts.add(d.effort)
    expect(efforts.has('바로발급')).toBe(true)
    expect(efforts.has('요청필요')).toBe(true)
  })
})
