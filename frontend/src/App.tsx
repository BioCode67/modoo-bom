import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/sections/Home'
import { Placeholder } from '@/sections/Placeholder'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

export default function App() {
  const { view, elderly } = useAppStore()

  // 큰글씨 모드 → <html>에 클래스 토글
  useEffect(() => {
    document.documentElement.classList.toggle('elderly-mode', elderly)
  }, [elderly])

  return (
    <div className={cn('min-h-screen bg-background')}>
      <a href="#main" className="skip-link">본문 바로가기</a>
      <Navbar />

      <main id="main" className="pb-20 md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {view === 'home' && <Home />}
            {view === 'analyze' && <Placeholder title="복지 찾기" desc="프로필을 입력하면 맞춤 복지를 찾아드려요." />}
            {view === 'explore' && <Placeholder title="정책 탐색" desc="120여 개 복지 정책을 검색하고 둘러보세요." />}
            {view === 'my' && <Placeholder title="나의 복지" desc="관심 정책과 신청 현황을 관리하세요." />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
