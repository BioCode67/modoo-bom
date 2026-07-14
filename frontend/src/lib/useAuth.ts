import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  isAuthEnabled, onAuthChange, getCurrentUser,
  signIn as sbSignIn, signOut as sbSignOut, userDisplay, type AuthProvider,
} from './supabase'
import { useAppStore } from '@/store/useAppStore'
import { mergeTracked, pullTracked, pushTracked, deleteTracked } from './sync'

/**
 * 로그인 세션 + '나의 복지' 클라우드 동기화 훅.
 * - 미설정(isAuthEnabled=false)이면 user는 항상 null, enabled=false → UI가 인증 요소를 숨김(현행 동일).
 * - 로그인 시: 클라우드 pull → 로컬과 병합 → 반영 → push. 이후 추적목록 변경을 debounce로 동기화.
 */
export function useAuth() {
  const enabled = isAuthEnabled()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [syncing, setSyncing] = useState<boolean>(false)

  // 초기 세션 조회 + 인증 상태 변화 구독
  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let alive = true
    let unsub: () => void = () => {}
    getCurrentUser().then((u) => { if (alive) { setUser(u); setLoading(false) } })
    void onAuthChange((u) => { if (alive) setUser(u) }).then((fn) => {
      if (alive) unsub = fn; else fn()
    })
    return () => { alive = false; unsub() }
  }, [enabled])

  // 로그인 상태에서 병합 동기화 + 이후 변경 push/delete
  useEffect(() => {
    if (!enabled || !user) return
    const uid = user.id
    let cancelled = false
    let unsub: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      setSyncing(true)
      const cloud = await pullTracked(uid)
      if (cancelled) return
      const merged = mergeTracked(useAppStore.getState().tracked, cloud)
      useAppStore.getState().replaceTracked(merged)
      await pushTracked(uid, merged)
      if (cancelled) return
      setSyncing(false)

      // 병합·push 이후부터 로컬 추적목록 변경을 감지해 동기화
      let prevIds = new Set(merged.map((t) => t.policyId))
      // ⚠️ 삭제는 debounce 윈도우 동안 '누적'해야 한다 — 매 변경마다 removed를 덮어쓰면(타이머 리셋)
      //   같은 800ms 안의 여러 삭제 중 마지막 것만 반영돼, 삭제한 정책이 다른 기기에서 되살아난다.
      const pendingRemovals = new Set<string>()
      unsub = useAppStore.subscribe((state, prev) => {
        if (state.tracked === prev.tracked) return
        const cur = state.tracked
        const curIds = new Set(cur.map((t) => t.policyId))
        for (const id of prevIds) if (!curIds.has(id)) pendingRemovals.add(id)
        for (const id of curIds) pendingRemovals.delete(id) // 다시 담으면 삭제 취소
        prevIds = curIds
        // ⚠️ '삭제'는 디바운스를 태우지 않고 즉시 전파 — 800ms 안에 새로고침·탭 종료('다음 분 상담 시작'
        //   직후가 전형)면 삭제가 클라우드에 못 가고, 톰스톤 없는 union 병합이 이전 상담자의 담은 복지를
        //   다음 사용자에게 되살렸다(15차 감사, PII). 업서트만 디바운스 유지.
        if (pendingRemovals.size) {
          const rm = [...pendingRemovals]
          pendingRemovals.clear()
          for (const id of rm) void deleteTracked(uid, id)
        }
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void pushTracked(uid, cur)
        }, 800)
      })
    })()

    return () => { cancelled = true; if (timer) clearTimeout(timer); unsub() }
  }, [enabled, user])

  const signIn = useCallback((p: AuthProvider) => sbSignIn(p), [])
  const signOut = useCallback(() => sbSignOut(), [])
  const { name, avatar } = userDisplay(user)

  return { enabled, user, loading, syncing, signIn, signOut, name, avatar }
}
