import { sidoOf } from './welfare-engine'
import type { Policy } from '@/data/policies'

/** 17개 시·도 표시 순서 */
export const SIDOS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'] as const

export interface RegionStats {
  /** 시·도 코드('서울' 등) → 지자체(LOC) 정책 수 */
  counts: Record<string, number>
  /** 시·도 코드 → 예시 정책명(최대 exampleN개) */
  examples: Record<string, string[]>
  /** 전체 지역화 가능한 LOC 정책 수 */
  total: number
}

/**
 * 지자체(LOC) 정책을 시·도별로 집계하고, 시·도별 예시 정책명을 모은다(순수 함수 — 단위 테스트 용이).
 * LOC 정책의 지역은 target 접두사 "[시도 시군구] …"에 담겨 있어 `sidoOf`로 추출한다.
 * 시·도를 못 찾는 LOC(지역 미상)는 집계에서 제외한다.
 */
export function regionStats(catalog: Policy[], exampleN = 3): RegionStats {
  const counts: Record<string, number> = {}
  const examples: Record<string, string[]> = {}
  for (const p of catalog) {
    if (!p.id.startsWith('LOC-')) continue
    const s = sidoOf(p.target)
    if (!s) continue
    counts[s] = (counts[s] || 0) + 1
    const ex = examples[s] || (examples[s] = [])
    if (ex.length < exampleN) ex.push(p.name)
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { counts, examples, total }
}
