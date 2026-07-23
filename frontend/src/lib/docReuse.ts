import type { Policy } from '@/data/policies'
import { classifyDoc } from '@/lib/sharedDocInfo'

/**
 * 서류 재사용 매트릭스 — 여러 복지가 '같은 서류'를 요구할 때, 한 번 준비하면 몇 곳에 쓰는지 보여준다.
 * "복지는 N개인데 서류는 등본 하나면 대부분 끝"이라는 걸 눈으로 보여 준비 부담을 낮춘다.
 *
 * 순수 집계(외부 규칙·정액 없음). 각 정책의 required_docs를 세어 2곳 이상 공유하는 서류만 남긴다.
 * classifyDoc으로 '공동이용 동의로 생략 가능'까지 표기해, 재사용성과 절약을 함께 보여준다.
 */

export interface DocReuse {
  doc: string
  count: number          // 이 서류를 요구하는 복지 수
  policyNames: string[]  // 어떤 복지들이 요구하나
  shareable: boolean     // 행정정보 공동이용 동의로 생략 가능(추정)한 서류인가
}

export interface DocReusePlan {
  shared: DocReuse[]       // 2곳 이상 공유하는 서류(재사용 많은 순)
  totalPolicies: number    // 대상 복지 수
  topDoc: DocReuse | null  // 가장 여러 곳에 쓰이는 서류(대표)
  savedCount: number       // 공유 서류를 한 번씩만 준비할 때 줄어드는 발급 횟수(중복 준비 절약)
}

/**
 * 정책 묶음에서 공통(재사용) 서류를 집계한다.
 * 흐름:
 *  ① 각 정책의 required_docs를 정책 단위로 중복 제거해 카운트(한 정책이 같은 서류를 두 번 적어도 1회).
 *  ② 2곳 이상에서 요구되는 서류만 '재사용 서류'로 남기고 재사용 많은 순 정렬.
 *  ③ savedCount = Σ(count-1) — 공통 서류를 한 번만 준비하면 줄어드는 총 발급 횟수.
 */
export function docReuseMap(policies: Policy[]): DocReusePlan {
  const list = Array.isArray(policies) ? policies : []
  const map = new Map<string, { count: number; names: string[] }>()
  for (const p of list) {
    const seen = new Set<string>()
    for (const raw of p.required_docs || []) {
      const key = (raw || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const e = map.get(key) || { count: 0, names: [] }
      e.count += 1
      e.names.push(p.name)
      map.set(key, e)
    }
  }
  const shared = [...map.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([doc, e]) => ({ doc, count: e.count, policyNames: e.names, shareable: classifyDoc(doc) === 'yes' }))
    .sort((a, b) => b.count - a.count || a.doc.localeCompare(b.doc))
  const savedCount = shared.reduce((s, d) => s + (d.count - 1), 0)
  return { shared, totalPolicies: list.length, topDoc: shared[0] || null, savedCount }
}
