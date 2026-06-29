import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/sections/Home'
import { Analyze } from '@/sections/Analyze'
import { Explore } from '@/sections/Explore'
import { My } from '@/sections/My'
import { ChatWidget } from '@/components/ChatWidget'
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
        {/* 뷰 전환: key 변경으로 새 뷰를 즉시 마운트(enter-only). exit 대기 deadlock 방지. */}
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {view === 'home' && <Home />}
          {view === 'analyze' && <Analyze />}
          {view === 'explore' && <Explore />}
          {view === 'my' && <My />}
        </motion.div>
      </main>

      <ChatWidget />
    </div>
  )
}
