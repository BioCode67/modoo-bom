import { useRef, useState } from 'react'
import { LogIn, LogOut, Cloud } from 'lucide-react'
import { useAuthCtx } from '@/lib/authContext'
import { SproutLogo } from '@/ui/SproutLogo'
import { useModalFocus } from '@/hooks/useModalFocus'

/**
 * 로그인 컨트롤 (Navbar용).
 * - 미설정(enabled=false): 아무것도 렌더하지 않음 → 현행 UI와 동일.
 * - 로그아웃 상태: '로그인' 버튼 + 모달(카카오·구글).
 * - 로그인 상태: 아바타+이름 + 메뉴(동기화 상태·로그아웃).
 */
export function AuthControl() {
  const { enabled, user, loading, signIn, signOut, name, avatar, syncing } = useAuthCtx()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, open, () => setOpen(false)) // 포커스 이동·트랩·ESC·복원

  if (!enabled || loading) return null

  if (!user) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          aria-label="로그인"
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold border-2 bg-white border-sprout-100 text-sprout-700 hover:border-sprout-300 transition-colors"
        >
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">로그인</span>
        </button>

        {open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="로그인">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative card-cute w-full max-w-sm p-7 text-center" ref={panelRef} tabIndex={-1}>
              <SproutLogo withFace className="mx-auto h-14 w-14" />
              <h2 className="mt-3 text-xl font-extrabold">모두봄 로그인</h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                로그인하면 다른 기기·브라우저에서도<br /><b className="text-foreground">나의 복지 신청 현황</b>을 이어서 볼 수 있어요.
              </p>

              <div className="mt-6 space-y-2.5">
                <button
                  onClick={() => signIn('kakao')}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-[15px] transition-transform hover:scale-[1.02]"
                  style={{ background: '#FEE500', color: '#191600' }}
                >
                  <span className="text-lg leading-none">💬</span> 카카오로 시작하기
                </button>
                <button
                  onClick={() => signIn('google')}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-[15px] border-2 border-gray-200 bg-white text-gray-700 transition-transform hover:scale-[1.02]"
                >
                  <GoogleG /> Google로 시작하기
                </button>
              </div>

              <button onClick={() => setOpen(false)} className="mt-5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">
                나중에 할게요
              </button>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                로그인 없이도 모든 기능을 무료로 쓸 수 있어요. 🌱
              </p>
            </div>
          </div>
        )}
      </>
    )
  }

  // 로그인 상태
  const initial = (name || '이').trim().charAt(0)
  return (
    <div className="relative">
      <button
        onClick={() => setMenu((m) => !m)}
        className="inline-flex items-center gap-1.5 rounded-xl pl-1 pr-2.5 py-1 border-2 border-sprout-100 bg-white hover:border-sprout-200 transition-colors"
        aria-haspopup="menu"
        aria-expanded={menu}
      >
        {avatar
          ? <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
          : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sprout-200 text-sprout-700 text-xs font-bold">{initial}</span>}
        <span className="hidden sm:inline text-xs font-bold text-foreground max-w-[7rem] truncate">{name}</span>
      </button>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute right-0 mt-2 z-50 w-56 card-cute p-2 shadow-soft" role="menu">
            <div className="px-2.5 py-2">
              <p className="text-sm font-bold truncate">{name}님</p>
              <p className="mt-0.5 text-[11px] inline-flex items-center gap-1 text-sprout-700">
                <Cloud className="h-3 w-3" /> {syncing ? '동기화 중…' : '기기 간 동기화 켜짐'}
              </p>
            </div>
            <button
              onClick={() => { void signOut(); setMenu(false) }}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              role="menuitem"
            >
              <LogOut className="h-4 w-4" /> 로그아웃
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Google 'G' 로고 (인라인 SVG) */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6.1C.9 16 0 19.9 0 23.5s.9 7.5 2.6 10.9l7.8-6.1z" />
      <path fill="#34A853" d="M24 47c6.2 0 11.5-2 15.3-5.6l-7.3-5.7c-2 1.4-4.7 2.3-8 2.3-6.4 0-11.8-3.7-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 47 24 47z" />
    </svg>
  )
}
