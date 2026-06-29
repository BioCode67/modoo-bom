import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/sections/Home'
import { Analyze } from '@/sections/Analyze'
import { Explore } from '@/sections/Explore'
import { My } from '@/sections/My'
import { ChatWidget } from '@/components/ChatWidget'
import { PrintSummary } from '@/components/PrintSummary'
import { loadExternalCatalog } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

export default function App() {
  const { view, elderly, highContrast } = useAppStore()

  // 외부 정책 카탈로그(public/policies.json) 런타임 병합 — 있으면 자동 확장
  useEffect(() => {
    loadExternalCatalog()
  }, [])

  // 접근성 모드 → <html>에 클래스 토글
  useEffect(() => {
    document.documentElement.classList.toggle('elderly-mode', elderly)
    document.documentElement.classList.toggle('high-contrast', highContrast)
  }, [elderly, highContrast])

  return (
    <div className={cn('min-h-screen bg-background')}>
      <a href="#main" className="skip-link no-print">본문 바로가기</a>
      <div className="no-print"><Navbar /></div>

      <main id="main" className="pb-20 md:pb-0 no-print">
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

      <div className="no-print"><ChatWidget /></div>
      <PrintSummary />
    </div>
  )
}
