import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp } from 'lucide-react'

/**
 * '맨 위로' 버튼 — 정책 탐색(5,000건)·결과 등 긴 페이지에서 빠르게 상단 복귀.
 * 챗봇 FAB(우하단)·모바일 하단 탭과 겹치지 않게 좌하단에 배치. 400px 이상 스크롤 시 노출.
 */
export function ScrollTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="맨 위로 이동"
          className="fixed left-4 bottom-24 md:bottom-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-white text-sprout-600 shadow-soft border border-sprout-100 hover:bg-sprout-50 active:scale-95 transition-colors"
        >
          <ArrowUp className="h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
