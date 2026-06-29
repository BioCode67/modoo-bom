import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/sections/Home'
import { Analyze } from '@/sections/Analyze'
import { Explore } from '@/sections/Explore'
import { My } from '@/sections/My'
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
            {view === 'analyze' && <Analyze />}
            {view === 'explore' && <Explore />}
            {view === 'my' && <My />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
