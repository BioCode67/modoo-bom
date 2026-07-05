import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserProfile, AnalysisResult, EligiblePolicy } from '@/lib/welfare-engine'

export type View = 'home' | 'analyze' | 'explore' | 'my'

export type AppStatus = 'idle' | 'tracking' | 'applied' | 'done'

export interface TrackedItem {
  policyId: string
  name: string
  category: string
  status: AppStatus
  savedAt: number
  /** 사용자가 직접 체크한 준비 완료 서류 */
  checkedDocs: string[]
  /** 신청 완료(applied)로 표시한 시점 — 심사 기간/기한 계산 기준 */
  appliedAt?: number
  /** 마지막으로 진행상황을 점검한 시점 — 재점검 알림 계산 기준 */
  lastChecked?: number
}

interface AppState {
  // 뷰 라우팅 (정적 배포 친화 — 상태 기반)
  view: View
  setView: (v: View) => void

  // 탐색 진입 시 AI 의미 검색을 자동 활성화하려는 의도(홈 카드·외국어 입력 등) — 전이(비저장)
  aiIntent: boolean
  setAiIntent: (v: boolean) => void
  aiQuery: string
  setAiQuery: (q: string) => void

  // 접근성 — 큰글씨 모드 / 고대비 모드
  elderly: boolean
  toggleElderly: () => void
  highContrast: boolean
  toggleHighContrast: () => void

  // 첫 방문 온보딩 1회 노출
  onboarded: boolean
  setOnboarded: () => void

  // RPA 자동입력용 추가정보(선택) — 본인인증 폼 자동 작성에만 사용, 내 기기에만 저장
  rpaInfo: { name: string; birth_date: string; phone: string; carrier: string }
  setRpaInfo: (patch: Partial<{ name: string; birth_date: string; phone: string; carrier: string }>) => void

  // 최근 프로필 + 분석 결과 캐시 (오랜만에 들어와도 바로 보이게)
  profile: UserProfile | null
  result: AnalysisResult | null
  setAnalysis: (profile: UserProfile, result: AnalysisResult) => void
  clearAnalysis: () => void
  // 홈에서 한 문장 입력 시, 결과를 바로 캐시하지 않고 '분석 대기' 프로필만 넘겨 분석 오버레이(실제 AI)를 태운다
  pendingProfile: UserProfile | null
  setPendingProfile: (p: UserProfile | null) => void

  // 관심 목록 + 신청 트래킹 (나의 복지)
  tracked: TrackedItem[]
  isSaved: (policyId: string) => boolean
  toggleSaved: (p: { id: string; name: string; category: string }) => void
  setStatus: (policyId: string, status: AppStatus) => void
  toggleDoc: (policyId: string, doc: string) => void
  markChecked: (policyId: string) => void
  removeTracked: (policyId: string) => void
  /** 추적목록 전체 교체 (클라우드 동기화 병합 결과 반영용) */
  replaceTracked: (items: TrackedItem[]) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: 'home',
      setView: (v) => {
        set({ view: v })
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      },
      aiIntent: false,
      setAiIntent: (v) => set({ aiIntent: v }),
      aiQuery: '',
      setAiQuery: (q) => set({ aiQuery: q }),

      elderly: false,
      toggleElderly: () => set((s) => ({ elderly: !s.elderly })),
      highContrast: false,
      toggleHighContrast: () => set((s) => ({ highContrast: !s.highContrast })),
      onboarded: false,
      setOnboarded: () => set({ onboarded: true }),

      rpaInfo: { name: '', birth_date: '', phone: '', carrier: '' },
      setRpaInfo: (patch) => set((s) => ({ rpaInfo: { ...s.rpaInfo, ...patch } })),

      profile: null,
      result: null,
      setAnalysis: (profile, result) => set({ profile, result }),
      clearAnalysis: () => set({ profile: null, result: null }),
      pendingProfile: null,
      setPendingProfile: (pendingProfile) => set({ pendingProfile }),

      tracked: [],
      isSaved: (policyId) => get().tracked.some((t) => t.policyId === policyId),
      toggleSaved: (p) =>
        set((s) => {
          const exists = s.tracked.find((t) => t.policyId === p.id)
          if (exists) return { tracked: s.tracked.filter((t) => t.policyId !== p.id) }
          return {
            tracked: [
              ...s.tracked,
              { policyId: p.id, name: p.name, category: p.category, status: 'idle', savedAt: Date.now(), checkedDocs: [] },
            ],
          }
        }),
      setStatus: (policyId, status) =>
        set((s) => ({
          tracked: s.tracked.map((t) => {
            if (t.policyId !== policyId) return t
            // 신청 완료로 바뀌는 순간 신청일을 기록(심사 기간/기한 계산 기준)
            const appliedAt = status === 'applied' && !t.appliedAt ? Date.now() : t.appliedAt
            return { ...t, status, appliedAt }
          }),
        })),
      toggleDoc: (policyId, doc) =>
        set((s) => ({
          tracked: s.tracked.map((t) => {
            if (t.policyId !== policyId) return t
            const has = t.checkedDocs.includes(doc)
            return { ...t, checkedDocs: has ? t.checkedDocs.filter((d) => d !== doc) : [...t.checkedDocs, doc] }
          }),
        })),
      markChecked: (policyId) =>
        set((s) => ({ tracked: s.tracked.map((t) => (t.policyId === policyId ? { ...t, lastChecked: Date.now() } : t)) })),
      removeTracked: (policyId) => set((s) => ({ tracked: s.tracked.filter((t) => t.policyId !== policyId) })),
      replaceTracked: (items) => set({ tracked: items }),
    }),
    {
      name: 'modoobom-store',
      // ⚠️ 개인정보 최소저장(보안): rpaInfo(이름·생년월일·휴대폰)는 **디스크에 저장하지 않는다**.
      //   신청서 미리채움용 강식별 PII라 세션(메모리) 동안만 유지 → 공용 기기 잔존·유출 위험 제거.
      //   profile/result는 '나의 복지' 재방문 경험에 필요해 유지(이름·연락처 없음, 초기화 버튼으로 삭제 가능).
      partialize: (s) => ({ tracked: s.tracked, elderly: s.elderly, highContrast: s.highContrast, onboarded: s.onboarded, profile: s.profile, result: s.result }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<AppState>
        return { ...current, ...p, rpaInfo: current.rpaInfo } // rpaInfo는 항상 메모리 기본값에서 시작
      },
    },
  ),
)

export type { UserProfile, AnalysisResult, EligiblePolicy }
