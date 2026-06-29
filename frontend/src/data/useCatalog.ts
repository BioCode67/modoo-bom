import { useSyncExternalStore } from 'react'
import { getCatalog, subscribeCatalog } from '@/data/catalog'
import type { Policy } from '@/data/policies'

/** 카탈로그가 외부 데이터로 확장되면 자동 리렌더 */
export function useCatalog(): Policy[] {
  return useSyncExternalStore(subscribeCatalog, getCatalog, getCatalog)
}
