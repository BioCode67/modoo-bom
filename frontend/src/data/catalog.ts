import { WELFARE_POLICIES, type Policy } from '@/data/policies'
import { PRIVATE_POLICIES } from '@/data/privatePolicies'
import { HOUSING_POLICIES } from '@/data/housingPolicies'
import { GOV_PROGRAMS } from '@/data/govPrograms'
import { FINANCIAL_POLICIES } from '@/data/financialPolicies'

// 시드 = 정부 큐레이션(POL-) + 민간재단(PRV-) + 청년주택 공고(HOU-) + 정부 지원사업(SUP-) + 정책서민금융(FIN-, 서민금융진흥원 실측)
const SEED_POLICIES: Policy[] = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]

/**
 * 통합 복지 카탈로그.
 * - 기본(시드): 코드에 내장된 큐레이션 정책(오프라인/즉시 사용).
 * - 확장: 빌드 산출물의 `public/policies.json`(ETL이 공공데이터로 생성)을 런타임에 병합.
 *   → 코드 수정/재빌드 없이 수백~수천 건으로 확장·갱신 가능.
 */
/**
 * 표시용 중복 제거. 시드 내부 중복·시드/중앙 동명 중복만 정리한다.
 * ⚠️ 지자체(LOC-)는 같은 이름이라도 지역이 다르면 별개 사업(예: 여러 시군구의 '출산장려금')이므로
 *    절대 이름으로 합치지 않고 모두 유지한다(고유 id로 이미 구분됨).
 */
// 이름 정규화 키 — 공백 + 괄호문자 제거로 표기변형까지 같은 것으로 본다
// (예: '지원 (국민행복카드)' == '지원 국민행복카드'). 괄호 '내용'은 유지해 1종/2종 등 실제 차이는 보존.
export function nameKey(name: string): string {
  return (name || '').replace(/[\s()（）]/g, '')
}

function dedupeByName(list: Policy[]): Policy[] {
  const seen = new Set<string>()
  return list.filter((p) => {
    if (/^LOC-/.test(p.id)) return true // 지자체: 지역별 동명 사업 모두 유지
    const k = nameKey(p.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// CATALOG(표시용)은 이름 디듑, MAP(조회용)은 모든 id를 유지해 추적/참조가 깨지지 않게 함.
let CATALOG: Policy[] = dedupeByName(SEED_POLICIES)
let MAP: Record<string, Policy> = Object.fromEntries(SEED_POLICIES.map((p) => [p.id, p]))
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
/** 브라우저에선 워커에서 fetch+parse(메인스레드 TBT 제거), 테스트/워커 미지원 환경은 인라인 폴백 */
function fetchExternalData(url: string): Promise<unknown | null> {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return new Promise((resolve) => {
      try {
        const w = new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' })
        const to = setTimeout(() => { try { w.terminate() } catch { /* noop */ } resolve(null) }, 30000)
        w.onmessage = (e: MessageEvent<{ ok: boolean; data?: unknown }>) => {
          clearTimeout(to)
          try { w.terminate() } catch { /* noop */ }
          resolve(e.data.ok ? (e.data.data ?? null) : null)
        }
        w.onerror = () => { clearTimeout(to); try { w.terminate() } catch { /* noop */ } resolve(null) }
        w.postMessage({ url })
      } catch { resolve(null) }
    }).then(async (d) => d ?? inlineFetch(url)) // 워커 실패 시 인라인 폴백
  }
  return inlineFetch(url)
}
async function inlineFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function loadExternalCatalog(): Promise<number> {
  if (loaded) return CATALOG.length
  loaded = true
  try {
    const base = import.meta.env.BASE_URL || '/'
    const data = await fetchExternalData(`${base}policies.json`)
    if (data == null) return CATALOG.length
    const wrapped = data as { policies?: unknown[] }
    const list: unknown[] = Array.isArray(data) ? data : Array.isArray(wrapped?.policies) ? wrapped.policies! : []
    const merged = new Map<string, Policy>(Object.entries(MAP))
    const before = merged.size
    // 시드(큐레이션·상세)가 외부(요약)보다 우선 — 같은 이름은 시드 유지
    const seedNames = new Set([...merged.values()].map((p) => nameKey(p.name)))
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const p = normalize(item as Record<string, unknown>)
      if (!p.id || !p.name) continue
      // 지자체(LOC-)는 지역별 동명 사업이 별개이므로 시드와 이름 겹쳐도 유지(dedupeByName과 동일 원칙).
      if (!p.id.startsWith('LOC-') && seedNames.has(nameKey(p.name))) continue // 시드와 이름 중복 → 스킵
      merged.set(p.id, p)
    }
    if (merged.size !== before) {
      const all = [...merged.values()]
      MAP = Object.fromEntries(all.map((p) => [p.id, p])) // 모든 id 유지(추적/참조 안전)
      CATALOG = dedupeByName(all)                          // 표시용 이름 디듑
      subs.forEach((cb) => cb())
    }
    return CATALOG.length
  } catch {
    return CATALOG.length
  }
}
