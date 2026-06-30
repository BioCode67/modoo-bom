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
      unsub = useAppStore.subscribe((state, prev) => {
        if (state.tracked === prev.tracked) return
        const cur = state.tracked
        const curIds = new Set(cur.map((t) => t.policyId))
        const removed = [...prevIds].filter((id) => !curIds.has(id))
        prevIds = curIds
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void pushTracked(uid, cur)
          for (const id of removed) void deleteTracked(uid, id)
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
