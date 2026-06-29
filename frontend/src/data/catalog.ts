import { WELFARE_POLICIES, type Policy } from '@/data/policies'

/**
 * 통합 복지 카탈로그.
 * - 기본(시드): 코드에 내장된 큐레이션 정책(오프라인/즉시 사용).
 * - 확장: 빌드 산출물의 `public/policies.json`(ETL이 공공데이터로 생성)을 런타임에 병합.
 *   → 코드 수정/재빌드 없이 수백~수천 건으로 확장·갱신 가능.
 */
let CATALOG: Policy[] = WELFARE_POLICIES
let MAP: Record<string, Policy> = Object.fromEntries(WELFARE_POLICIES.map((p) => [p.id, p]))
let loaded = false
const subs = new Set<() => void>()

export function getCatalog(): Policy[] {
  return CATALOG
}
export function getPolicyMap(): Record<string, Policy> {
  return MAP
}
export function getCategories(): string[] {
  const seen = new Set<string>()
  for (const p of CATALOG) if (p.category) seen.add(p.category)
  return [...seen]
}
export function subscribeCatalog(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

/** 외부 정책 1건을 안전하게 정규화(누락 필드 보강) */
function normalize(raw: Record<string, unknown>): Policy {
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [])
  return {
    id: s(raw.id),
    name: s(raw.name),
    category: s(raw.category) || '기타',
    target: s(raw.target),
    benefit: s(raw.benefit),
    eligibility: s(raw.eligibility),
    required_docs: arr(raw.required_docs),
    application: s(raw.application),
    department: s(raw.department),
    renewal: s(raw.renewal) || '기관 안내 확인',
    contact: s(raw.contact) || undefined,
  }
}

/**
 * public/policies.json 을 로드해 시드와 병합(중복 id는 외부 우선).
 * 실패(404 등)하면 조용히 시드만 사용.
 */
export async function loadExternalCatalog(): Promise<number> {
  if (loaded) return CATALOG.length
  loaded = true
  try {
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}policies.json`, { cache: 'no-cache' })
    if (!res.ok) return CATALOG.length
    const data = await res.json()
    const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.policies) ? data.policies : []
    const merged = new Map<string, Policy>(Object.entries(MAP))
    const before = merged.size
    // 시드(큐레이션·상세)가 외부(요약)보다 우선 — 같은 이름은 시드 유지
    const seedNames = new Set([...merged.values()].map((p) => p.name.replace(/\s/g, '')))
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const p = normalize(item as Record<string, unknown>)
      if (!p.id || !p.name) continue
      if (seedNames.has(p.name.replace(/\s/g, ''))) continue // 시드와 이름 중복 → 스킵
      merged.set(p.id, p)
    }
    if (merged.size !== before) {
      CATALOG = [...merged.values()]
      MAP = Object.fromEntries(CATALOG.map((p) => [p.id, p]))
      subs.forEach((cb) => cb())
    }
    return CATALOG.length
  } catch {
    return CATALOG.length
  }
}
