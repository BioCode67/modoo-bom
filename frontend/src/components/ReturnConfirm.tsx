import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getPendingReturn, clearPendingReturn, dismissPendingReturn, markPendingLeft, markPendingReturned, type PendingReturn } from '@/lib/returnPrompt'

/** 공식 사이트 탭에서 돌아오자마자 프롬프트가 뜨면 오탐(팝업 차단·잘못 클릭) — 최소 체류 시간 */
const MIN_AWAY_MS = 8000

/**
 * 복귀 확인 배너 — 정부 사이트(새 탭)에서 신청/발급을 마치고 돌아온 순간
 * '완료하셨나요?'를 1탭으로 묻는다. '네'를 눌러야만 상태가 기록된다(자동 낙관 처리 없음 — 정직성 원칙).
 * App 셸에 1회만 마운트(중복 프롬프트 방지). iOS Safari의 visibilitychange 발화 편차에 대비해 focus도 병행 청취.
 */
/** away 구간(left→returned) 확정값 — 짧은 왕복(2초)이 나중 refocus에서 8초 넘게 계산되던 오탐 차단(16차) */
function awayMs(p: PendingReturn): number {
  if (!p.left) return 0
  return (p.returned ?? Date.now()) - p.left
}

export function ReturnConfirm() {
  const { tracked, setStatus, markChecked, toggleDocDone, isDocDone } = useAppStore()
  const resetNonce = useAppStore((s) => s.resetNonce)
  const [pending, setPending] = useState<PendingReturn | null>(null)

  // '다음 분 상담 시작'(현장 초기화) 시 표시 중이던 배너도 내린다 — 이전 상담자의 정책·서류명이
  // 남아 있다가 '네'를 누르면 새 세션 docDone을 오염시켰다(16차 검증).
  useEffect(() => { if (resetNonce > 0) setPending(null) }, [resetNonce])

  useEffect(() => {
    const check = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // 실제로 페이지를 떠나는 순간을 기록 — 클릭만 하고 안 떠난(팝업 차단·취소) 기록엔
        // 나중 refocus에 배너를 띄우지 않기 위한 근거(15차 감사).
        markPendingLeft()
        return
      }
      // 복귀 시각 확정(away 구간 고정) — 이후 focus 이벤트가 와도 away가 늘지 않는다
      markPendingReturned()
      const p = getPendingReturn()
      // '실제 떠나 있던 시간'이 최소 체류를 넘은 경우에만(짧은 왕복 오탐 차단)
      if (p && !p.dismissed && awayMs(p) > MIN_AWAY_MS) setPending(p)
    }
    // 복귀 중 원래 탭이 메모리에서 내려가 페이지가 리로드되면(모바일 탭 퇴거·PWA 재기동)
    // visibilitychange/focus가 발화하지 않는다 — 마운트 시점에도 1회 확인(left는 sessionStorage에 생존).
    check()
    // 같은 탭 이동(모바일이 target=_blank를 무시하는 경우)은 pagehide로 이탈을 마킹
    const onHide = () => markPendingLeft()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  if (!pending) return null

  const confirm = () => {
    if (pending.kind === 'apply') {
      // 이미 '신청 완료/수급 중'인 항목(갱신 여정)은 강등하지 않는다 — 점검 시각만 갱신
      const cur = tracked.find((t) => t.policyId === pending.policyId)?.status
      if (cur === 'applied' || cur === 'done') markChecked(pending.policyId)
      else setStatus(pending.policyId, 'applied')
    } else if (!isDocDone(pending.doc)) {
      toggleDocDone(pending.doc)
    }
    // 큐에서 이 기록만 제거 — 연속 발급 시 다음 서류 확인이 이어서 뜬다(15차: 단일 슬롯 유실 해소)
    clearPendingReturn(pending.at)
    // 다음 활성 항목이 있으면 이어서 확인(away 구간 기준 — 짧은 왕복은 묻지 않음)
    const next = getPendingReturn()
    setPending(next && awayMs(next) > MIN_AWAY_MS ? next : null)
  }
  const later = () => {
    dismissPendingReturn(pending.at)
    const next = getPendingReturn()
    setPending(next && awayMs(next) > MIN_AWAY_MS ? next : null)
  }

  const title = pending.kind === 'apply' ? `「${pending.name}」 신청을 완료하셨나요?` : `「${pending.doc}」 발급을 완료하셨나요?`
  const yesLabel = pending.kind === 'apply' ? '네, 신청했어요' : '네, 발급했어요'

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
        className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:w-[380px] z-[70]"
        role="status" aria-live="polite"
      >
        <div className="rounded-2xl border-2 border-sprout-200 bg-white shadow-xl p-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-sprout-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-snug">{title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {pending.kind === 'apply' ? '기록해두면 진행상황·갱신 알림을 챙겨드려요.' : '기록해두면 남은 서류만 추려서 보여드려요.'}
              </p>
            </div>
            <button onClick={later} aria-label="닫기" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-sprout-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={confirm} className="btn-primary flex-1 !py-2 text-xs justify-center">{yesLabel}</button>
            <button onClick={later} className="btn-secondary !py-2 text-xs">아직이에요</button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
