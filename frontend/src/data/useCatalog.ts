import { useSyncExternalStore } from 'react'
import { getCatalog, getPolicyMap, subscribeCatalog } from '@/data/catalog'
import type { Policy } from '@/data/policies'

/** 카탈로그가 외부 데이터로 확장되면 자동 리렌더 */
export function useCatalog(): Policy[] {
  return useSyncExternalStore(subscribeCatalog, getCatalog, getCatalog)
}

/** 반응형 정책맵 — 외부 정책(public/policies.json) 지연 병합 시 자동 리렌더.
 *  '나의 복지'처럼 담아둔 공공데이터(GOV-/LOC-) 정책이 로드 전에는 미지 상태로 깨지던 문제 방지. */
export function usePolicyMap(): Record<string, Policy> {
  useCatalog() // 병합 시 리렌더를 트리거하기 위한 구독
  return getPolicyMap()
}
