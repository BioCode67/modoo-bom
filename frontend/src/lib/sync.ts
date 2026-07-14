import { getSupabase } from './supabase'
import type { TrackedItem } from '@/store/useAppStore'

/**
 * '나의 복지' 추적목록의 클라우드 동기화 (로컬 우선).
 * - 로그인 시: 클라우드를 받아 로컬과 병합(데이터 손실 없는 합집합) → 로컬 반영 → 클라우드 push.
 * - 이후 로컬 변경: 해당 항목 upsert. 로컬 삭제: 해당 행 delete(삭제 전파).
 * 표는 사용자별 RLS로 보호되어 본인 데이터만 접근 가능.
 */
const TABLE = 'tracked_policies'

/** 항목을 마지막으로 손댄 시점(저장/신청/점검/편집 중 최신) — 병합 우선순위 기준.
 *  editedAt: 서류 체크(toggleDoc)·상태 되돌림처럼 기존 타임스탬프를 안 바꾸는 편집도 반영 —
 *  없으면 로컬 최신 체크리스트가 원격 옛 사본에 조용히 덮였다(15차 감사). */
function freshness(t: TrackedItem): number {
  return Math.max(t.savedAt || 0, t.appliedAt || 0, t.lastChecked || 0, t.editedAt || 0)
}

/**
 * 로컬·클라우드 추적목록 병합 — 정책ID 합집합, 더 최근에 손댄 쪽 우선(동률은 로컬 유지).
 * 순수 함수(네트워크 없음) — 회귀 테스트 대상.
 */
export function mergeTracked(local: TrackedItem[], cloud: TrackedItem[]): TrackedItem[] {
  const byId = new Map<string, TrackedItem>()
  for (const t of cloud) if (t && t.policyId) byId.set(t.policyId, t)
  for (const t of local) {
    if (!t || !t.policyId) continue
    const ex = byId.get(t.policyId)
    if (!ex || freshness(t) >= freshness(ex)) byId.set(t.policyId, t)
  }
  return [...byId.values()]
}

/** 클라우드에서 내 추적목록 가져오기 */
export async function pullTracked(userId: string): Promise<TrackedItem[]> {
  const sb = await getSupabase()
  if (!sb) return []
  const { data, error } = await sb.from(TABLE).select('data').eq('user_id', userId)
  if (error || !data) return []
  return data.map((r) => (r as { data: TrackedItem }).data).filter(Boolean)
}

/** 추적목록(여러 건) 클라우드에 upsert */
export async function pushTracked(userId: string, items: TrackedItem[]): Promise<void> {
  const sb = await getSupabase()
  if (!sb || items.length === 0) return
  const rows = items
    .filter((t) => t && t.policyId)
    .map((t) => ({ user_id: userId, policy_id: t.policyId, data: t }))
  await sb.from(TABLE).upsert(rows, { onConflict: 'user_id,policy_id' })
}

/** 추적 항목 1건 클라우드에서 삭제(로컬 제거 전파) */
export async function deleteTracked(userId: string, policyId: string): Promise<void> {
  const sb = await getSupabase()
  if (!sb) return
  await sb.from(TABLE).delete().eq('user_id', userId).eq('policy_id', policyId)
}
