import { useEffect, useRef, type RefObject } from 'react'

/**
 * 모달 접근성 훅 — 열릴 때 포커스 이동·배경 스크롤 잠금·Tab 트랩·ESC 닫기·닫을 때 포커스 복원.
 * (PolicyDetailDrawer의 검증된 로직을 공용화. 여러 다이얼로그에 일관 적용.)
 * @param ref 모달 패널 엘리먼트 ref, @param open 열림 여부, @param onClose 닫기 콜백
 * @param initialFocusSelector 열릴 때 우선 포커스할 요소 셀렉터(예: 검색 입력). 없으면 첫 포커스 요소(보통 닫기 버튼).
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initialFocusSelector?: string) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const prevFocused = document.activeElement as HTMLElement | null
    const sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusTimer = setTimeout(() => {
      const panel = ref.current
      if (!panel) return
      // 지정 셀렉터(예: 검색 입력)를 우선 포커스 — 없으면 첫 포커스 요소로 폴백
      const f = (initialFocusSelector && panel.querySelector<HTMLElement>(initialFocusSelector)) || panel.querySelector<HTMLElement>(sel)
      ;(f || panel).focus()
    }, 40)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const panel = ref.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      try { prevFocused?.focus() } catch { /* 무시 */ }
    }
  }, [open, ref, initialFocusSelector])
}
