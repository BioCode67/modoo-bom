import { lazy, Suspense, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/sections/Home'
// 화면별 코드 분할 — 홈은 즉시, 나머지는 진입 시 로드(초기 번들↓, 저사양 기기 빠른 첫 로딩)
const Analyze = lazy(() => import('@/sections/Analyze').then((m) => ({ default: m.Analyze })))
const Explore = lazy(() => import('@/sections/Explore').then((m) => ({ default: m.Explore })))
const My = lazy(() => import('@/sections/My').then((m) => ({ default: m.My })))
import { ChatWidget } from '@/components/ChatWidget'
import { ScrollTop } from '@/components/ScrollTop'
import { PrintSummary } from '@/components/PrintSummary'
import { Onboarding } from '@/components/Onboarding'
import { loadExternalCatalog } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { AuthProvider } from '@/lib/authContext'
import { cn } from '@/lib/utils'

/** 화면 청크 로딩 중 폴백 — 짧고 가벼운 스피너 */
function PageLoading() {
  return (
    <div className="page-container py-24 flex justify-center" role="status" aria-label="불러오는 중">
      <Loader2 className="h-8 w-8 animate-spin text-sprout-400" />
    </div>
  )
}

export default function App() {
  const { view, elderly, highContrast } = useAppStore()

  // 외부 정책 카탈로그(public/policies.json, ~3.3MB) 런타임 병합 — 있으면 자동 확장.
  // fetch+JSON.parse가 첫 페인트·상호작용과 경합하지 않게 유휴 시점으로 미룬다(시드 135건이 즉시 커버,
  // 병합 완료 시 subscribeCatalog 구독으로 자동 리렌더).
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => { loadExternalCatalog() }, { timeout: 2500 })
    else setTimeout(() => { loadExternalCatalog() }, 800)
  }, [])

  // PWA 앱 바로가기(홈 아이콘 길게누르기) 딥링크 — ?go=analyze|explore|my 로 해당 화면 진입
  useEffect(() => {
    const go = new URLSearchParams(window.location.search).get('go')
    if (go === 'analyze' || go === 'explore' || go === 'my' || go === 'home') {
      useAppStore.getState().setView(go)
      // 주소창 정리(뒤로가기 깔끔하게)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // 접근성 모드 → <html>에 클래스 토글
  useEffect(() => {
    document.documentElement.classList.toggle('elderly-mode', elderly)
    document.documentElement.classList.toggle('high-contrast', highContrast)
  }, [elderly, highContrast])

  return (
    <AuthProvider>
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
          <Suspense fallback={<PageLoading />}>
            {view === 'home' && <Home />}
            {view === 'analyze' && <Analyze />}
            {view === 'explore' && <Explore />}
            {view === 'my' && <My />}
          </Suspense>
        </motion.div>
      </main>

      <div className="no-print"><ChatWidget /></div>
      <div className="no-print"><ScrollTop /></div>
      <div className="no-print"><Onboarding /></div>
      <PrintSummary />
    </div>
    </AuthProvider>
  )
}
