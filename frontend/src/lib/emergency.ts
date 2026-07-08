import { getCatalog } from '@/data/catalog'
import type { Policy } from '@/data/policies'

export interface Crisis {
  key: string
  emoji: string
  label: string
  keywords: string[]
}

export const CRISES: Crisis[] = [
  { key: 'joblost', emoji: '💼', label: '실직했어요', keywords: ['실업', '실직', '구직', '긴급', '생계'] },
  { key: 'sick', emoji: '🏥', label: '아프거나 다쳤어요', keywords: ['의료', '질병', '치료', '긴급', '재활', '산재'] },
  { key: 'death', emoji: '🕯️', label: '주소득자가 사라졌어요', keywords: ['긴급', '생계', '한부모', '유족'] },
  { key: 'business', emoji: '📉', label: '사업이 어려워요', keywords: ['긴급', '생계', '소상공인', '자영업'] },
  { key: 'disaster', emoji: '🔥', label: '화재·재난을 겪었어요', keywords: ['긴급', '재난', '재해', '주거'] },
  { key: 'housing', emoji: '🏠', label: '월세·주거가 위태로워요', keywords: ['주거', '긴급', '월세', '임대', '주택'] },
  // '여성'·'청소년'은 너무 넓어 생리용품 바우처 등 비긴급 항목을 끌어와서 제외 — 위기 대응 특화어만 둔다.
  { key: 'violence', emoji: '🆘', label: '폭력·학대 위기예요', keywords: ['긴급', '보호', '위기', '피해', '학대', '가정폭력'] },
  { key: 'birth', emoji: '🤰', label: '출산이 임박했어요', keywords: ['출산', '산모', '긴급', '임신'] },
]

/** 선택한 위기 상황에 맞는 긴급/지원 정책을 카탈로그에서 매칭(긴급복지지원 우선) */
export function matchEmergency(keys: string[]): Policy[] {
  if (keys.length === 0) return []
  const kws = new Set<string>()
  for (const k of keys) CRISES.find((c) => c.key === k)?.keywords.forEach((w) => kws.add(w))

  const scored = getCatalog().map((p) => {
    const hay = `${p.name} ${p.category} ${p.target} ${p.eligibility} ${p.benefit}`
    let score = 0
    for (const w of kws) {
      if (p.name.includes(w)) score += 3
      else if (hay.includes(w)) score += 1
    }
    // 긴급복지지원 계열은 위기 상황 핵심 → 가중
    if (p.name.includes('긴급')) score += 4
    // 민간재단(심사·선발형)은 노출하되 법정 권리인 정부 긴급지원보다 아래로(정부 제도 최우선 안내)
    if (/^PRV-/.test(p.id)) score -= 3
    return { p, score }
  }).filter((x) => x.score > 0)

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 6).map((x) => x.p)
}
