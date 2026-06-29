/** 표시용 포맷/메타 헬퍼 */

export function formatWon(n: number): string {
  if (!n || n <= 0) return '-'
  if (n >= 100000000) return `${(n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1)}억원`
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`
  return `${n.toLocaleString()}원`
}

export const PRIORITY_META: Record<'high' | 'medium' | 'low', { label: string; cls: string; emoji: string }> = {
  high: { label: '강력 추천', cls: 'priority-high', emoji: '🔥' },
  medium: { label: '추천', cls: 'priority-medium', emoji: '👍' },
  low: { label: '검토', cls: 'priority-low', emoji: '🌱' },
}

/** 카테고리별 이모지/색 (탐색기·카드 표시용). 미지정 카테고리는 기본값. */
export function categoryMeta(category: string): { emoji: string; cls: string } {
  const c = category || ''
  if (c.includes('노인')) return { emoji: '👵', cls: 'bg-amber-100 text-amber-700' }
  if (c.includes('아동') || c.includes('영유아') || c.includes('보육')) return { emoji: '👶', cls: 'bg-pink-100 text-pink-700' }
  if (c.includes('청년')) return { emoji: '🧑', cls: 'bg-sky2-100 text-sky2-600' }
  if (c.includes('장애')) return { emoji: '♿', cls: 'bg-indigo-100 text-indigo-700' }
  if (c.includes('임신') || c.includes('출산') || c.includes('모')) return { emoji: '🤰', cls: 'bg-rose-100 text-rose-600' }
  if (c.includes('저소득') || c.includes('생계') || c.includes('기초')) return { emoji: '🤝', cls: 'bg-emerald-100 text-emerald-700' }
  if (c.includes('주거')) return { emoji: '🏠', cls: 'bg-orange-100 text-orange-700' }
  if (c.includes('의료') || c.includes('건강')) return { emoji: '🏥', cls: 'bg-red-100 text-red-600' }
  if (c.includes('고용') || c.includes('취업') || c.includes('일자리')) return { emoji: '💼', cls: 'bg-blue-100 text-blue-700' }
  if (c.includes('교육') || c.includes('학')) return { emoji: '📚', cls: 'bg-violet-100 text-violet-700' }
  if (c.includes('문화')) return { emoji: '🎨', cls: 'bg-fuchsia-100 text-fuchsia-700' }
  if (c.includes('한부모') || c.includes('가족') || c.includes('다문화')) return { emoji: '👨‍👩‍👧', cls: 'bg-teal-100 text-teal-700' }
  return { emoji: '🌼', cls: 'bg-sprout-100 text-sprout-700' }
}

/** 혜택 문구에서 월 금액 추정(엔진과 동일 규칙) — 카드 배지용 */
export function parseMonthly(benefit: string): number {
  const m = benefit.match(/월\s*(?:최대\s*)?([0-9,]+)\s*원/)
  if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  return 0
}
