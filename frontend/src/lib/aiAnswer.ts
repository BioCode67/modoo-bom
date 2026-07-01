import { detectLang } from './detectLang'
import { parseMonthly, formatWon } from './format'

export interface AiAnswerItem {
  name: string
  benefit: string
}

/**
 * AI 답변 요약 문장 생성 — 환각 없이 검색결과 기반.
 * 대표 3건(이름 중복 제거) + 현금성 최대 금액 + (외국어면) 입력 언어 이해 안내.
 * items는 유사도 상위 순으로 정렬돼 있다고 가정.
 */
export function buildAiAnswer(items: AiAnswerItem[], query: string): string {
  if (!items || items.length === 0) return ''
  const seen = new Set<string>()
  const top: string[] = []
  for (const it of items) {
    if (top.length >= 3) break
    const nm = (it.name || '').replace(/\s/g, '')
    if (!nm || seen.has(nm)) continue
    seen.add(nm)
    top.push(it.name)
  }
  const cashMax = Math.max(0, ...items.slice(0, 12).map((it) => parseMonthly(it.benefit)))
  const d = detectLang(query)
  const langNote = d && d.code !== 'ko' ? `${d.label} 문장을 이해했어요. ` : ''
  const amt = cashMax > 0 ? ` 현금성 지원은 월 최대 ${formatWon(cashMax)}이에요.` : ''
  return `${langNote}이런 복지가 가장 잘 맞아요: ${top.join(', ')}.${amt}`
}
