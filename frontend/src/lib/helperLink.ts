import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 가족 도움 링크 — 프로필(이름 제외)과 담아둔 정책을 URL 해시(#helper=)로 인코딩해
 * 가족·복지사에게 전달하면, 받은 기기에서 같은 결과·체크리스트를 온디바이스로 복원한다.
 *
 * 정직성·보안: 해시(fragment)는 서버로 전송되지 않는다. 이름 등 강식별 정보는 넣지 않는다(name 강제 제거).
 * 받는 쪽은 프로필만으로 runAnalysis를 다시 돌려 동일 결과를 재계산 — 서버·백엔드 불필요.
 */
export interface HelperPayload {
  v: 1
  profile: UserProfile
  tracked: { policyId: string; name: string }[]
}

const MAX_BYTES = 6000 // 링크 과대·악용 방지 상한

/** base64url 인코딩(한글 안전 — TextEncoder 사용). */
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 프로필+담은 정책 → 공유 링크(현재 사이트 URL + #helper=…). 이름은 반드시 제거. */
export function encodeHelperLink(profile: UserProfile, tracked: { policyId: string; name: string }[]): string {
  // 디코더와 동일한 필드 상한을 인코더에서도 적용(이름 60·id 40 절단)하고,
  // base64 결과가 MAX_BYTES를 넘으면 후행 항목을 떨궈, 만든 링크가 항상 수신측 decode를 통과하도록 보장.
  // (예전엔 개수만 40으로 제한 → 한글 장문 지자체 정책명 다수면 6000자 초과 → 받는 가족 화면에 조용히 홈만 떴다.)
  let items = tracked.slice(0, 40).map((t) => ({ policyId: String(t.policyId).slice(0, 40), name: String(t.name || '').slice(0, 60) }))
  const base = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : 'https://biocode67.github.io/modoo-bom/'
  const build = (list: typeof items) => b64urlEncode(JSON.stringify({ v: 1, profile: { ...profile, name: '' }, tracked: list } satisfies HelperPayload))
  let enc = build(items)
  while (enc.length > MAX_BYTES && items.length > 0) {
    items = items.slice(0, -1) // 상한 초과 시 뒤에서부터 항목 제거(프로필은 항상 유지)
    enc = build(items)
  }
  return `${base}#helper=${enc}`
}

/** 해시 문자열(#helper=… 또는 순수 payload)을 검증·파싱. 실패/과대/변조면 null. */
export function decodeHelperPayload(raw: string): HelperPayload | null {
  try {
    const m = raw.match(/helper=([^&]+)/)
    const enc = m ? m[1] : raw
    if (!enc || enc.length > MAX_BYTES) return null
    const json = b64urlDecode(enc)
    if (json.length > MAX_BYTES) return null
    const p = JSON.parse(json) as HelperPayload
    // 필드 화이트리스트 검증(악의적 구조 차단)
    if (p?.v !== 1 || typeof p.profile !== 'object' || !Array.isArray(p.tracked)) return null
    const pr = p.profile
    if (typeof pr.age !== 'number' || typeof pr.income_percentile !== 'number') return null
    // 정규화(신뢰 가능한 필드만 복원, 이름은 항상 비움)
    const profile: UserProfile = {
      name: '',
      age: Math.max(0, Math.min(120, pr.age)),
      gender: (['male', 'female', 'other'].includes(pr.gender) ? pr.gender : 'other') as UserProfile['gender'],
      region: String(pr.region || '').slice(0, 10),
      household_type: String(pr.household_type || '').slice(0, 12),
      income_percentile: Math.max(0, Math.min(300, pr.income_percentile)),
      disability: !!pr.disability,
      disability_grade: String(pr.disability_grade || '').slice(0, 6),
      employment_status: String(pr.employment_status || '').slice(0, 12),
      has_children: !!pr.has_children,
      children_ages: Array.isArray(pr.children_ages) ? pr.children_ages.filter((a) => typeof a === 'number' && a >= 0 && a <= 30).slice(0, 8) : [],
      is_pregnant: !!pr.is_pregnant,
      life_events: Array.isArray(pr.life_events) ? pr.life_events.filter((e) => typeof e === 'string').slice(0, 10) : [],
    }
    const tracked = p.tracked
      .filter((t) => t && typeof t.policyId === 'string')
      .slice(0, 40)
      .map((t) => ({ policyId: String(t.policyId).slice(0, 40), name: String(t.name || '').slice(0, 60) }))
    return { v: 1, profile, tracked }
  } catch {
    return null
  }
}
