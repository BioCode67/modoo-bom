import type { EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 수급 조합 관계 안내 — "함께 받을 수 있는 것 / 하나만 골라야 하는 것 / 감액될 수 있는 것".
 *
 * 왜: 복지로·기존 앱 어디에도 '무엇을 같이 받고 무엇을 골라야 하는가'를 알려주는 기능이 없다(사각지대의 실제 고통).
 * 정직성 원칙: 금액을 재계산하지 않는다(과장 위험) — 공식 출처가 확인된 '관계'만 사실 그대로 안내한다.
 * 각 규칙은 보건복지부·복지로 공식 안내로 실측 검증(2026-07). 검증 안 된 관계는 넣지 않는다.
 */
export type ComboKind = 'exclusive' | 'reduction' | 'compatible'

export interface ComboRule {
  a: string // policy id
  b: string
  kind: ComboKind
  note: string
  source: string
}

// ⚠️ 시드(POL-) 한정. 전부 공식 출처 실측 확인된 관계만.
export const COMBO_RULES: ComboRule[] = [
  {
    a: 'POL-001', b: 'POL-003', kind: 'exclusive', // 기초연금 ↔ 장애인연금(기초급여)
    note: '기초연금과 장애인연금의 기초급여는 성격이 같아 동시에 받을 수 없어요. 만 65세가 되면 장애인연금 기초급여가 기초연금으로 바뀝니다(부가급여는 이후에도 계속).',
    source: '보건복지부 장애인연금 안내(mohw.go.kr)',
  },
  {
    a: 'POL-001', b: 'POL-002', kind: 'reduction', // 기초연금 → 생계급여 소득산입
    note: '기초생활 생계급여를 받는 어르신은 기초연금이 소득으로 잡혀 생계급여가 그만큼 줄 수 있어요(이른바 "줬다 뺏는 연금"). 둘 다 신청은 가능하지만 합산액이 기대보다 적을 수 있어요.',
    source: '보건복지부 국민기초생활보장 사업안내(2026)',
  },
  {
    a: 'POL-004', b: 'POL-005', kind: 'compatible', // 아동수당 + 부모급여
    note: '아동수당과 부모급여는 별개라 함께 받을 수 있어요(각각 신청).',
    source: '복지로 부모급여 안내(bokjiro.go.kr)',
  },
  {
    a: 'POL-005', b: 'POL-038', kind: 'reduction', // 부모급여 ↔ 보육료(어린이집)
    note: '어린이집을 이용하면 보육료(바우처)가 먼저 지원되고, 부모급여에서 그만큼을 뺀 차액만 현금으로 받아요(둘을 온전히 다 받는 건 아니에요).',
    source: '복지로 부모급여·보육료 안내(bokjiro.go.kr)',
  },
  {
    a: 'POL-004', b: 'POL-038', kind: 'compatible', // 아동수당 + 보육료
    note: '아동수당은 어린이집 이용·소득과 무관하게 전액 현금으로 나와요 — 보육료와 함께 받을 수 있어요.',
    source: '복지로 아동수당 안내(bokjiro.go.kr)',
  },
]

const RULE_INDEX: Record<string, ComboRule[]> = (() => {
  const idx: Record<string, ComboRule[]> = {}
  for (const r of COMBO_RULES) {
    ;(idx[r.a] ||= []).push(r)
    ;(idx[r.b] ||= []).push(r)
  }
  return idx
})()

export interface ComboResult {
  exclusive: { rule: ComboRule; a: EligiblePolicy; b: EligiblePolicy }[]
  reduction: { rule: ComboRule; a: EligiblePolicy; b: EligiblePolicy }[]
  compatible: { rule: ComboRule; a: EligiblePolicy; b: EligiblePolicy }[]
}

/**
 * 자격 판정된 정책 집합에서 시드(POL-) 간의 알려진 수급 관계를 찾아 분류.
 * 엔진 판정 결과를 '입력으로만' 사용 — 엔진은 건드리지 않는다.
 */
export function analyzeCombos(eligible: EligiblePolicy[]): ComboResult {
  const byId: Record<string, EligiblePolicy> = {}
  for (const p of eligible) if (/^POL-/.test(p.id)) byId[p.id] = p
  const out: ComboResult = { exclusive: [], reduction: [], compatible: [] }
  const seen = new Set<string>()
  for (const id of Object.keys(byId)) {
    for (const rule of RULE_INDEX[id] || []) {
      const key = [rule.a, rule.b].sort().join('|')
      if (seen.has(key)) continue
      const a = byId[rule.a]
      const b = byId[rule.b]
      if (!a || !b) continue // 둘 다 자격일 때만 관계가 의미 있음
      seen.add(key)
      out[rule.kind].push({ rule, a, b })
    }
  }
  return out
}

export function hasCombos(r: ComboResult): boolean {
  return r.exclusive.length + r.reduction.length + r.compatible.length > 0
}
