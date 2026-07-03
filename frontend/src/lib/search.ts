import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 복지 도메인 검색 — 사용자가 실제로 쓰는 말을 정책에 쓰인 행정용어로 확장하고,
 * '개념 단위' 가중치로 관련도를 매겨 정렬한다. (LLM 미사용)
 *
 * 왜 필요한가: 기존 탐색은 (이름+분류+대상…)에 검색어를 그대로 substring 매칭해
 *  - "노인 일자리"처럼 띄어 쓰면 정책명("노인일자리…")엔 공백이 없어 0건이 나오고,
 *  - "애기/전세/병원" 같은 생활어는 행정용어("아동/주거/의료")와 안 맞아 누락된다.
 * → 질의를 '개념'으로 쪼개 동의어로 확장하고, 여러 개념을 동시에 충족하는 정책을 우대한다.
 *   (예: "노인 일자리" → 노인 AND 일자리를 모두 만족하는 정책이 상위)
 */

// 생활어 ↔ 행정용어. 질의 단어가 한 줄의 단어와 겹치면 그 줄 전체를 같은 개념으로 묶는다.
const SYNONYM_GROUPS: string[][] = [
  ['노인', '어르신', '고령', '시니어', '경로', '할머니', '할아버지'],
  ['아동', '아기', '애기', '어린이', '영유아', '유아', '아이', '자녀', '미취학'],
  ['청년', '청소년', '대학생', '취준생'],
  ['주거', '집', '전세', '월세', '임대', '주택', '거주', '보증금', '이사'],
  ['의료', '병원', '치료', '건강', '진료', '의료비', '약값', '수술', '재활'],
  ['고용', '일자리', '취업', '구직', '직업', '실업', '실직', '창업', '취직'],
  ['교육', '학비', '등록금', '학자금', '장학', '스칼러십', '교육비', '학원비', '방과후'],
  ['장애', '장애인', '장애우', '중증', '발달장애', '보조기기', '보청기', '휠체어'],
  ['한부모', '미혼모', '미혼부', '편부', '편모', '싱글맘', '싱글대디', '조손', '이혼', '사별'],
  ['출산', '임신', '산모', '출생', '분만', '난임', '임산부'],
  ['저소득', '생계', '기초생활', '빈곤', '취약', '차상위', '수급'],
  ['다문화', '결혼이민', '외국인', '이주민'],
  ['보훈', '국가유공자', '참전', '유공자', '군인', '제대군인', '군복무'],
  ['농어민', '농업', '어업', '농촌', '어촌', '농어촌'],
  ['에너지', '전기요금', '난방', '연료', '가스'],
  ['통신', '휴대폰', '핸드폰', '인터넷', '통신비'],
  ['돌봄', '간병', '요양', '활동지원'],
  ['보호아동', '고아', '소년소녀가장', '자립준비청년', '보호종료', '가정위탁', '위탁가정'],
  ['교통', '버스', '지하철', '교통비', '차비'],
]

/**
 * 질의 → 개념 그룹들. 각 그룹 = 원문 단어 + 동의어(소문자).
 * 다단어 질의는 단어별로 개념을 만든다("노인 일자리" → [노인…],[일자리…]).
 */
export function queryConcepts(q: string): string[][] {
  const base = q.trim().toLowerCase()
  if (!base) return []
  const words = base.split(/\s+/).filter(Boolean)
  // '지원/사업/서비스' 같은 범용어는 개념이 아니라 잡음(거의 모든 정책명에 등장) — 다른 단어가 있으면 제외.
  // 예: "월세 지원"에서 '지원'이 보육료'지원' 등을 밀어올려 주거 결과를 가리는 문제 방지.
  const GENERIC = /^(지원|사업|서비스|제도|혜택|신청|받기|해줘|알려줘)$/
  const meaningful = words.filter((w) => !GENERIC.test(w))
  const seeds = meaningful.length > 0 ? meaningful : words.length > 0 ? words : [base]
  return seeds.map((w) => {
    const grp = SYNONYM_GROUPS.find((g) =>
      g.some((t) => {
        const tl = t.toLowerCase()
        return w.includes(tl) || tl.includes(w)
      }),
    )
    const set = new Set<string>([w])
    if (grp) grp.forEach((t) => set.add(t.toLowerCase()))
    return [...set]
  })
}

/** 질의 → 모든 검색어(개념 평탄화). 외부에서 단순 매칭이 필요할 때. */
export function expandQuery(q: string): string[] {
  return [...new Set(queryConcepts(q).flat())]
}

function fieldScore(p: Policy | EligiblePolicy, t: string): number {
  if (!t) return 0
  const name = p.name.toLowerCase()
  let s = 0
  if (name === t) s += 8
  else if (name.includes(t)) s += 3
  if (p.category.toLowerCase().includes(t)) s += 2
  if ((p.target || '').toLowerCase().includes(t)) s += 1.5
  if ((p.eligibility || '').toLowerCase().includes(t)) s += 1
  if ((p.benefit || '').toLowerCase().includes(t)) s += 1
  return s
}

/**
 * 정책 1건의 관련도. 각 개념은 동의어 중 가장 잘 맞는 점수로 평가하고,
 * 둘 이상의 개념을 동시에 충족하면 충족 개념 수만큼 가산한다(다개념 우대).
 */
export function relevance(p: Policy | EligiblePolicy, concepts: string[][], rawQuery = ''): number {
  if (!concepts.length) return 0
  let total = 0
  let covered = 0
  for (const terms of concepts) {
    let best = 0
    for (const t of terms) best = Math.max(best, fieldScore(p, t))
    if (best > 0) {
      covered += 1
      total += best
    }
  }
  let score = covered > 1 ? total * covered : total
  // 원문 질의가 정책명에 그대로 들어가면 강하게 가산 — 짧은 동의어(예: '교육')가
  // 여러 필드에 걸쳐 exact 이름 매칭을 밀어내는 것을 방지(정확 이름 검색 우선).
  const raw = rawQuery.trim().toLowerCase()
  if (raw && score > 0) {
    const name = p.name.toLowerCase()
    if (name === raw) score += 100
    else if (raw.length >= 2 && name.includes(raw)) score += 30
  }
  return score
}

/** 카탈로그에서 질의에 매칭되는 정책을 관련도순으로 반환. */
export function searchPolicies<T extends Policy | EligiblePolicy>(list: T[], q: string): T[] {
  const concepts = queryConcepts(q)
  if (!concepts.length) return list
  return list
    .map((p) => ({ p, s: relevance(p, concepts, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p)
}
