import type { Policy } from '@/data/policies'
import type { UserProfile } from '@/lib/welfare-engine'
import { checkPolicy, demographicMismatch, incomeCeiling } from '@/lib/welfare-engine'
import { getCatalog } from '@/data/catalog'

export interface NearMiss {
  policy: Policy
  reason: string   // 왜 아깝게 놓쳤는지(구체적 조건)
  gap: number      // 얼마나 가까운지(작을수록 아까움) — 정렬용
}

/**
 * '아깝게 놓친 복지' — 딱 한 조건(주로 소득)만 살짝 벗어나 탈락한 정밀(POL) 정책을 찾는다.
 * 에이전트가 "봤고, 이건 이래서 아깝게 안 돼요"라고 근거를 대는 것 → 규칙 엔진이 '추론'처럼 보인다.
 * + 소득/상황이 바뀌면 열리는 후보라 사후 모니터링과도 연결(선제 안내).
 *
 * 원칙: 인구통계가 아예 다른 정책(예: 비장애인에게 장애 정책)은 '놓친 것'이 아니므로 제외.
 *       소득 상한을 '조금(≤25%p)' 넘고, 소득만 낮추면 자격이 되는 경우만 '아깝다'고 본다(과장 금지).
 */
export function getNearMisses(p: UserProfile, opts: { margin?: number; limit?: number } = {}): NearMiss[] {
  const margin = opts.margin ?? 25
  const limit = opts.limit ?? 5
  const out: NearMiss[] = []
  // 소득 미입력(자연어에 소득신호 없음)이면 기본값 80%를 근거로 '당신은 N%라 아깝게 놓침'이라 오통보하지 않는다(감사 확정).
  if (p.income_known === false) return out
  for (const policy of getCatalog()) {
    if (!/^POL-/.test(policy.id)) continue // 정밀 자격판정이 가능한 큐레이션 시드만
    const doc = `${policy.eligibility} ${policy.target} ${policy.name}`
    if (demographicMismatch(policy.name, doc, p)) continue // 대상 자체가 다르면 '놓친 것' 아님
    if (checkPolicy(policy, p).eligible) continue           // 이미 받을 수 있으면 near-miss 아님

    const ceil = incomeCeiling(doc)
    if (ceil === null) continue
    const over = p.income_percentile - ceil
    if (over <= 0 || over > margin) continue // 소득 상한 초과폭이 '조금'일 때만

    // 소득만 상한까지 낮추면 실제로 자격이 되는지 검증(다른 조건은 이미 충족)
    const asIfLower = checkPolicy(policy, { ...p, income_percentile: ceil })
    if (!asIfLower.eligible) continue

    out.push({
      policy,
      gap: over,
      reason: `소득 기준(기준 중위소득 ${ceil}% 이하)을 조금 넘어요 — 지금은 ${p.income_percentile}% 수준. `
        + `소득이 줄거나 가구원이 늘면 받을 수 있어, 상황이 바뀌면 다시 확인하세요.`,
    })
  }
  out.sort((a, b) => a.gap - b.gap) // 가장 아까운(근접) 것부터
  return out.slice(0, limit)
}
