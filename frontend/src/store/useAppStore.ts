import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserProfile, AnalysisResult, EligiblePolicy } from '@/lib/welfare-engine'
import type { UiLang } from '@/lib/i18nLite'

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
  // UI 표시 언어 — 외국어 입력을 감지하면 상세·신청키트 UI 골격을 그 언어로(외국인 딥퍼널). 'ko'=기본.
  uiLang: UiLang
  setUiLang: (l: UiLang) => void
  // 가족 도움 링크(#helper=) 수신 시 — 남의 프로필을 '대신 보는' 임시 세션(비저장, 내 데이터 불침범)
  helper: { profile: UserProfile; tracked: { policyId: string; name: string }[] } | null
  setHelper: (h: { profile: UserProfile; tracked: { policyId: string; name: string }[] } | null) => void
  pendingRegion: string // '우리 동네 복지' 진입 시 Explore에 미리 지정할 시·도
  setPendingRegion: (r: string) => void

  // 접근성 — 큰글씨 모드 / 고대비 모드
  elderly: boolean
  toggleElderly: () => void
  highContrast: boolean
  toggleHighContrast: () => void

  // 첫 방문 온보딩 1회 노출
  onboarded: boolean
  setOnboarded: () => void

  // RPA 자동입력용 추가정보(선택) — 본인인증 폼 자동 작성에만 사용, 내 기기에만 저장
  // sido/sigungu: 주민등록상 주소(회원정보 주소와 다를 때 발급 폼에서 자동 정정용)
  rpaInfo: { name: string; birth_date: string; phone: string; carrier: string; sido: string; sigungu: string }
  setRpaInfo: (patch: Partial<{ name: string; birth_date: string; phone: string; carrier: string; sido: string; sigungu: string }>) => void

  // 서류 발급 완료 기억(정규화된 서류명 → 완료 시각) — 새 탭에서 발급하고 돌아와도 진행상황 유지(persist, PII 아님)
  docDone: Record<string, number>
  toggleDocDone: (doc: string) => void
  isDocDone: (doc: string) => boolean

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

/**
 * 결과 요약에서 실명 접두('${name}님(')를 '회원님('으로 치환 — 디스크 저장 전 PII 제거용.
 * runAnalysis가 summary를 '${name}님(72세, …)'로 만들기 때문에, result를 통째로 persist하면
 * profile.name을 비워도 이 문장 안에 실명이 남는다. 저장 직전 이 함수로 지운다.
 */
export function stripNameFromSummary(summary: string): string {
  return (summary || '').replace(/^[^(]*님\(/, '회원님(')
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
      uiLang: 'ko',
      setUiLang: (l) => set({ uiLang: l }),
      helper: null,
      setHelper: (helper) => set({ helper }),
      pendingRegion: '',
      setPendingRegion: (pendingRegion) => set({ pendingRegion }),

      elderly: false,
      toggleElderly: () => set((s) => ({ elderly: !s.elderly })),
      highContrast: false,
      toggleHighContrast: () => set((s) => ({ highContrast: !s.highContrast })),
      onboarded: false,
      setOnboarded: () => set({ onboarded: true }),

      rpaInfo: { name: '', birth_date: '', phone: '', carrier: '', sido: '', sigungu: '' },
      setRpaInfo: (patch) => set((s) => ({ rpaInfo: { ...s.rpaInfo, ...patch } })),

      docDone: {},
      toggleDocDone: (doc) =>
        set((s) => {
          // 표기 변형('주민등록 등본'/'주민등록등본')이 별개 키가 되지 않도록 공백 제거로 정규화
          const key = doc.replace(/\s/g, '')
          const next = { ...s.docDone }
          if (next[key]) delete next[key]
          else next[key] = Date.now()
          return { docDone: next }
        }),
      isDocDone: (doc) => !!get().docDone[doc.replace(/\s/g, '')],

      profile: null,
      result: null,
      setAnalysis: (profile, result) => set({ profile, result }),
      clearAnalysis: () => {
        // 분석 초기화 시 기기에 남은 프로필 이력(modoo:profileHistory)도 함께 삭제(방침 §5 이행)
        try { localStorage.removeItem('modoo:profileHistory') } catch { /* noop */ }
        set({ profile: null, result: null })
      },
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
      // 최소저장: 이름(호칭)은 디스크에 남기지 않는다(세션 중엔 메모리로 유지 — 새로고침 후 '회원님'으로 표시)
      //   ⚠️ profile.name만 비우면 부족하다 — result.profile_summary 문장 안에 '${name}님(...)'으로 실명이 박혀
      //   result 통째로 저장하면 그대로 새어나간다. summary의 이름 접두를 '회원님'으로 치환해 실명을 제거한다.
      partialize: (s) => ({
        tracked: s.tracked, docDone: s.docDone, elderly: s.elderly, highContrast: s.highContrast, onboarded: s.onboarded, uiLang: s.uiLang,
        profile: s.profile ? { ...s.profile, name: '' } : null,
        result: s.result ? { ...s.result, profile_summary: stripNameFromSummary(s.result.profile_summary) } : null,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<AppState>
        return { ...current, ...p, rpaInfo: current.rpaInfo } // rpaInfo는 항상 메모리 기본값에서 시작
      },
    },
  ),
)

export type { UserProfile, AnalysisResult, EligiblePolicy }
