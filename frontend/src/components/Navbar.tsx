import { Home, Search, Compass, Heart, Eye, Sparkles, Contrast } from 'lucide-react'
import { useAppStore, type View } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'

const NAV: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'home', label: '홈', icon: Home },
  { view: 'analyze', label: '복지 찾기', icon: Search },
  { view: 'explore', label: '정책 탐색', icon: Compass },
  { view: 'my', label: '나의 복지', icon: Heart },
]

export function Navbar() {
  const { view, setView, elderly, toggleElderly, highContrast, toggleHighContrast, tracked } = useAppStore()
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
                  <span className="ml-0.5 rounded-full bg-peach-400 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">
                    {savedCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleElderly}
              title={elderly ? '일반 글씨' : '큰 글씨(어르신용)'}
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
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 transition-colors',
                highContrast ? 'bg-foreground text-background border-foreground' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200',
              )}
            >
              <Contrast className="h-4 w-4" />
              <span className="hidden sm:inline">고대비</span>
            </button>
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
                'relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors',
                view === v ? 'text-sprout-600' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('h-5 w-5 transition-transform', view === v && 'scale-110')} />
              {label}
              {v === 'my' && savedCount > 0 && (
                <span className="absolute top-1.5 right-[22%] rounded-full bg-peach-400 text-white text-[9px] font-bold px-1 leading-tight">
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
