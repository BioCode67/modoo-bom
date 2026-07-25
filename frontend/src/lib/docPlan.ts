import type { Policy } from '@/data/policies'
import { issuableCanonical } from '@/lib/docAliases'
import { isRpaSupported } from '@/lib/officialLinks'
import { evaluateDoc, freshnessLabel, type DocValidity } from '@/lib/docValidity'
import { docGuide, guideSummary } from '@/lib/docGuide'
import { batchableGroups } from '@/lib/docPortalGroups'

/**
 * 필요 서류 통합 플랜 — 담아둔(추적 중인) 여러 복지의 required_docs 를 한데 모아
 * '같은 서류'를 합치고(정식명 기준 디듑), 각 서류가 몇 개의 신청에 재사용되는지,
 * 이미 발급했는지(store.docDone)와 그 유효기간(발급 3개월)을 한눈에 정리한다.
 *
 * 왜 새로운가: 기존 화면은 '정책 → 필요 서류'(정책 중심)로 본다. 여기는 '서류 → 어떤 신청들에
 * 필요한지'(서류 중심)로 뒤집어, "등본 하나만 떼면 담은 복지 5개 중 4개가 처리된다"처럼
 * 서류 발급 노력을 최소화하도록 안내한다. + 발급해둔 서류의 만료를 미리 챙겨준다.
 *
 * 순수 함수(now 주입)라 테스트 가능하고, 전부 브라우저 안에서 계산된다(서버 전송 없음).
 */

const norm = (s: string): string => (s || '').replace(/\s/g, '')

export type DocNeedStatus = 'ready' | 'expiring' | 'expired' | 'missing'

export interface DocNeed {
  key: string                                  // 정규화 키(정식명 우선)
  name: string                                 // 표시명(정식명 우선)
  policies: { id: string; name: string }[]     // 이 서류가 필요한 추적 정책들
  issuable: boolean                            // 자동발급(RPA) 대상 서류인가
  issuedAt: number | null                      // 발급 완료 시각(docDone), 없으면 null
  validity: DocValidity | null                 // 발급된 경우 유효 상태
  status: DocNeedStatus
}

export interface DocPlan {
  needs: DocNeed[]           // 우선순위 정렬(만료 > 임박 > 미발급 > 완료, 그다음 재사용 많은 순)
  totalPolicies: number      // 서류 정보가 있는 추적 정책 수
  uniqueDocs: number         // 합쳐진 고유 서류 종수
  rawDocs: number            // 합치기 전 서류 언급 총 횟수(중복 포함)
  missingCount: number
  readyCount: number
  expiringCount: number
  expiredCount: number
  issuableMissing: number    // 미발급 중 자동발급 가능한 종수
  topReuse: DocNeed | null   // 가장 많은 신청에 재사용되는 서류(2건 이상일 때만)
  summary: string
}

export interface TrackedRef { policyId: string }

/** 서류명 정규화 키 — 자동발급 정식명으로 해석되면 그 이름, 아니면 공백 제거 원문 */
export function docKey(name: string): string {
  return norm(issuableCanonical(name) || name)
}

const RANK: Record<DocNeedStatus, number> = { expired: 0, expiring: 1, missing: 2, ready: 3 }

function cmpNeed(a: DocNeed, b: DocNeed): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status]
  if (a.policies.length !== b.policies.length) return b.policies.length - a.policies.length
  return a.name.localeCompare(b.name)
}

/**
 * docDone(정규화 원문 → 발급 시각)에서 이 서류의 발급 시각을 찾는다.
 * 변형 표기로 발급된 경우도 같은 정식명이면 인정하고, 여러 건이면 가장 최근 발급 시각을 쓴다.
 */
function resolveIssuedAt(key: string, docDone: Record<string, number>): number | null {
  let best: number | null = null
  for (const [k, at] of Object.entries(docDone)) {
    if (!at) continue
    if (k === key || norm(issuableCanonical(k) || k) === key) {
      if (best == null || at > best) best = at
    }
  }
  return best
}

function summarize(plan: Omit<DocPlan, 'summary'>): string {
  const { uniqueDocs, missingCount, expiringCount, expiredCount, topReuse } = plan
  if (uniqueDocs === 0) return '담은 복지에 필요한 서류 정보가 아직 없어요.'
  const parts: string[] = [`담은 복지에 필요한 서류는 총 ${uniqueDocs}종이에요.`]
  if (expiredCount > 0) parts.push(`${expiredCount}종은 유효기간이 지나 다시 발급해야 해요.`)
  else if (expiringCount > 0) parts.push(`${expiringCount}종은 곧 만료되니 미리 챙기세요.`)
  if (missingCount > 0) parts.push(`아직 ${missingCount}종을 준비해야 해요.`)
  else if (expiredCount === 0 && expiringCount === 0) parts.push('필요한 서류가 모두 유효해요.')
  if (topReuse && topReuse.policies.length >= 2) {
    parts.push(`‘${topReuse.name}’ 하나면 ${topReuse.policies.length}개 신청에 함께 써요.`)
  }
  return parts.join(' ')
}

/**
 * 추적 정책 목록 + 정책맵 + 발급기록(docDone)으로 서류 플랜을 만든다.
 * @param now 기준 시각(ms) — 유효기간 계산용(테스트 주입)
 */
export function buildDocPlan(
  tracked: TrackedRef[],
  policyMap: Record<string, Policy>,
  docDone: Record<string, number>,
  now: number,
): DocPlan {
  const map = new Map<string, DocNeed>()
  let policiesWithDocs = 0
  let rawDocs = 0

  for (const t of tracked) {
    const policy = policyMap[t.policyId]
    if (!policy) continue
    const docs = (policy.required_docs || []).filter(Boolean)
    if (docs.length === 0) continue
    policiesWithDocs++
    const seen = new Set<string>() // 한 정책이 같은 서류를 두 번 세지 않도록
    for (const raw of docs) {
      const canon = issuableCanonical(raw) || raw
      const key = norm(canon)
      if (!key) continue
      rawDocs++
      if (seen.has(key)) continue
      seen.add(key)
      let need = map.get(key)
      if (!need) {
        need = { key, name: canon, policies: [], issuable: isRpaSupported(canon), issuedAt: null, validity: null, status: 'missing' }
        map.set(key, need)
      }
      need.policies.push({ id: policy.id, name: policy.name })
    }
  }

  // 발급 여부/유효 상태 채우기
  for (const need of map.values()) {
    const at = resolveIssuedAt(need.key, docDone)
    if (at != null) {
      const v = evaluateDoc(need.name, at, now)
      need.issuedAt = at
      need.validity = v
      need.status = v.freshness === 'expired' ? 'expired' : v.freshness === 'expiring' ? 'expiring' : 'ready'
    }
  }

  const needs = [...map.values()].sort(cmpNeed)
  const missingCount = needs.filter((n) => n.status === 'missing').length
  const readyCount = needs.filter((n) => n.status === 'ready').length
  const expiringCount = needs.filter((n) => n.status === 'expiring').length
  const expiredCount = needs.filter((n) => n.status === 'expired').length
  const issuableMissing = needs.filter((n) => n.status === 'missing' && n.issuable).length
  const topReuse = needs.reduce<DocNeed | null>(
    (best, n) => (n.policies.length >= 2 && (!best || n.policies.length > best.policies.length) ? n : best),
    null,
  )

  const base: Omit<DocPlan, 'summary'> = {
    needs, totalPolicies: policiesWithDocs, uniqueDocs: needs.length, rawDocs,
    missingCount, readyCount, expiringCount, expiredCount, issuableMissing, topReuse,
  }
  return { ...base, summary: summarize(base) }
}

/** 플랜을 사람이 읽는 텍스트로(클립보드 복사·공유용) */
export function docPlanToText(plan: DocPlan): string {
  if (plan.uniqueDocs === 0) return '담은 복지에 필요한 서류 정보가 없습니다.'
  const lines: string[] = ['[필요 서류 정리]', plan.summary, '']
  const mark: Record<DocNeedStatus, string> = { expired: '❗재발급', expiring: '⏰임박', missing: '⬜미발급', ready: '✅완료' }
  for (const n of plan.needs) {
    const reuse = n.policies.length >= 2 ? ` · ${n.policies.length}개 신청 공용` : ''
    const auto = n.issuable ? ' · 자동발급 대상' : ''
    const life = n.validity && n.validity.freshness !== 'permanent' ? ` (${freshnessLabel(n.validity)})` : ''
    lines.push(`${mark[n.status]} ${n.name}${reuse}${auto}${life}`)
    const g = docGuide(n.name)
    if (g) lines.push(`    발급: ${guideSummary(g)}`)
    lines.push(`    ↳ ${n.policies.map((p) => p.name).join(', ')}`)
  }
  // 한 번 로그인으로 여러 장 뗄 수 있는 발급처 묶음
  const batches = batchableGroups(plan.needs.map((n) => n.name))
  if (batches.length > 0) {
    lines.push('', '[한 번 로그인으로 여러 장]')
    for (const b of batches) lines.push(`• ${b.portal}: ${b.docs.join(' · ')} (${b.docs.length}종)`)
  }
  lines.push('', '※ 유효기간은 통상 기준이며, 실제 인정 여부는 접수 기관 요구가 우선입니다.')
  return lines.join('\n')
}
