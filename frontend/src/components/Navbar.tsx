import { Home, Search, Compass, Heart, Eye, Sparkles, Contrast, Download, Volume2 } from 'lucide-react'
import { useAppStore, type View } from '@/store/useAppStore'
import { useInstallPrompt } from '@/lib/useInstallPrompt'
import { AuthControl } from '@/components/AuthControl'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'

const NAV: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'home', label: '홈', icon: Home },
  { view: 'analyze', label: '복지 찾기', icon: Search },
  { view: 'explore', label: '정책 탐색', icon: Compass },
  { view: 'my', label: '나의 복지', icon: Heart },
]

export function Navbar() {
  const { view, setView, elderly, toggleElderly, highContrast, toggleHighContrast, tracked, openVoiceGuide } = useAppStore()
  const { canInstall, promptInstall } = useInstallPrompt()
  const savedCount = tracked.length

  return (
    <>
      {/* 데스크톱/태블릿 상단 바 */}
      <header className="sticky top-0 z-40 glass border-b border-sprout-100/70">
        <div className="page-container flex h-16 items-center gap-3">
          <button onClick={() => setView('home')} className="flex items-center gap-2 group" aria-label="모두봄 홈">
            <SproutLogo withFace className="h-9 w-9 transition-transform group-hover:scale-110 group-hover:rotate-6" />
            <span className="font-extrabold text-lg gradient-text tracking-tight">모두봄</span>
          </button>

          <nav className="ml-4 hidden md:flex items-center gap-1" aria-label="주요 메뉴">
            {NAV.map(({ view: v, label, icon: Icon }) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-current={view === v ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                  view === v ? 'bg-sprout-100 text-sprout-700' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {v === 'my' && savedCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-peach-600 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">
                    {savedCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* 🔊 소리로 듣는 사용법 — 온보딩을 닫은 뒤에도 언제든 열 수 있게(어르신·저시력 상시 진입) */}
            <button
              onClick={openVoiceGuide}
              title="음성으로 사용법 듣기"
              aria-label="음성으로 사용법 듣기"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 bg-white border-sprout-100 text-sprout-700 hover:border-sprout-300"
            >
              <Volume2 className="h-4 w-4" />
              <span className="hidden lg:inline">사용법 듣기</span>
            </button>
            <button
              onClick={toggleElderly}
              title={elderly ? '일반 글씨' : '큰 글씨(어르신용)'}
              aria-pressed={elderly}
              aria-label="큰 글씨(어르신용) 모드"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 transition-colors',
                elderly ? 'bg-sun-200 border-sun-300 text-yellow-800' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200',
              )}
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">{elderly ? '큰글씨 ON' : '큰글씨'}</span>
            </button>
            <button
              onClick={toggleHighContrast}
              title={highContrast ? '일반 대비' : '고대비(저시력용)'}
              aria-pressed={highContrast}
              aria-label="고대비(저시력용) 모드"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 transition-colors',
                highContrast ? 'bg-foreground text-background border-foreground' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200',
              )}
            >
              <Contrast className="h-4 w-4" />
              <span className="hidden sm:inline">고대비</span>
            </button>
            {canInstall && (
              <button onClick={promptInstall} title="앱으로 설치" aria-label="앱으로 설치" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 bg-white border-sprout-100 text-sprout-700 hover:border-sprout-300">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">앱 설치</span>
              </button>
            )}
            <AuthControl />
            <button onClick={() => setView('analyze')} className="btn-primary !px-4 !py-2 hidden sm:inline-flex">
              <Sparkles className="h-4 w-4" />
              내 복지 찾기
            </button>
          </div>
        </div>
      </header>

      {/* 모바일 하단 탭바 */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 md:hidden glass border-t border-sprout-100/70 pb-safe"
        aria-label="하단 메뉴"
      >
        <div className="grid grid-cols-4">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-current={view === v ? 'page' : undefined}
              className={cn(
                // text-xs(임의값 금지) — 어르신 큰글씨 모드의 확대 규칙(.text-xs 오버라이드)에 주 내비게이션도 포함되게
                'relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition-colors',
                view === v ? 'text-sprout-700' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('h-5 w-5 transition-transform', view === v && 'scale-110')} />
              {label}
              {v === 'my' && savedCount > 0 && (
                <span className="absolute top-1.5 right-[22%] rounded-full bg-peach-600 text-white text-[9px] font-bold px-1 leading-tight">
                  {savedCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}
