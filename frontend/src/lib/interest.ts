/**
 * 관심 분야 구독(웰로·복지멤버십식 카테고리 알림)의 집계 로직 — 순수 함수(단위 테스트 용이).
 *
 * 사용자가 구독한 분야별로, '받을 수 있는데(분석에서 추천됨) 아직 관심목록에 안 담은' 복지를
 * 집계해 능동적으로 안내한다. 기존 관심목록(개별 정책 저장)·프로필 기반 알림과 달리,
 * 사용자가 분야 단위로 상시 관심을 등록하는 모델(경쟁 서비스의 핵심 기능)을 채운다.
 */

/** 구독 가능한 관심 분야(라벨·이모지). 카테고리 매칭은 부분일치로 표기 변형을 흡수. */
export const INTEREST_CATEGORIES: { key: string; emoji: string }[] = [
  { key: '노인', emoji: '👵' },
  { key: '아동·영유아', emoji: '🧒' },
  { key: '청년', emoji: '🧑' },
  { key: '장애인', emoji: '♿' },
  { key: '저소득', emoji: '💛' },
  { key: '주거', emoji: '🏠' },
  { key: '의료', emoji: '🏥' },
  { key: '교육', emoji: '📚' },
  { key: '임신·출산', emoji: '🤰' },
]

export interface CategoryNudge {
  category: string
  total: number         // 이 분야에서 추천(자격 있는) 복지 수
  untracked: number     // 그중 아직 관심목록에 없는 수
  examples: { id: string; name: string }[]
}

interface Pol { id: string; name: string; category: string }

function matches(cat: string, sub: string): boolean {
  const c = cat || ''
  if (!c || !sub) return false // 빈 카테고리는 sub.includes('')가 항상 true라 모든 분야에 오매칭 → 제외
  if (c === sub || c.includes(sub) || sub.includes(c)) return true
  // 복합 분야('임신·출산'·'아동·영유아')는 토큰 단위로도 매칭 — '출산지원'이 '임신·출산' 구독에 잡히게(감사).
  //   2자 이상 토큰만 비교해 단일 글자 잡음 매칭을 막는다.
  const toks = sub.split(/[·・/]/).map((s) => s.trim()).filter((s) => s.length >= 2)
  return toks.some((tk) => c.includes(tk) || tk.includes(c))
}

/**
 * 구독 분야별 집계. `pols`는 분석 결과의 적격 정책(개인화) 또는 카탈로그 일부.
 * `trackedIds`에 이미 담은 정책은 '안 담은' 수에서 제외한다. total 0인 분야는 결과에서 뺀다.
 */
export function interestDigest(
  subscribed: string[],
  pols: Pol[],
  trackedIds: Set<string>,
  exampleN = 3,
): CategoryNudge[] {
  const out: CategoryNudge[] = []
  for (const category of subscribed) {
    const inCat = pols.filter((p) => matches(p.category, category))
    if (inCat.length === 0) continue
    const untrackedList = inCat.filter((p) => !trackedIds.has(p.id))
    out.push({
      category,
      total: inCat.length,
      untracked: untrackedList.length,
      examples: untrackedList.slice(0, exampleN).map((p) => ({ id: p.id, name: p.name })),
    })
  }
  return out
}
