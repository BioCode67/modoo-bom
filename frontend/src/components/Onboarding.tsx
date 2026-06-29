import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Search, Compass, Heart, LifeBuoy, Sparkles, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'

const STEPS = [
  { icon: Search, title: '내 복지 찾기', desc: '1분 입력으로 받을 수 있는 복지를 모두 찾아드려요', tint: 'text-sprout-600 bg-sprout-100' },
  { icon: Compass, title: '정책 탐색', desc: '120여 개 복지를 검색·정렬해서 둘러봐요', tint: 'text-sky2-600 bg-sky2-100' },
  { icon: Heart, title: '나의 복지', desc: '관심 복지 저장·신청 준비·사후 관리까지', tint: 'text-peach-600 bg-peach-100' },
  { icon: LifeBuoy, title: '긴급 도움', desc: '위기 상황이면 긴급복지와 129로 바로 안내', tint: 'text-rose-600 bg-rose-100' },
]

/** 첫 방문 1회 노출되는 친근한 안내 — 신규·어르신 진입장벽 완화 */
export function Onboarding() {
  const { onboarded, setOnboarded, setView } = useAppStore()

  useEffect(() => {
    if (onboarded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOnboarded() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onboarded, setOnboarded])

  if (onboarded) return null

  return (
    <div className="modal-overlay" onClick={setOnboarded}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card-cute w-full max-w-md max-h-[90vh] overflow-auto nice-scroll p-6"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="모두봄 안내"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <SproutLogo withFace className="h-11 w-11" />
            <div>
              <p className="font-extrabold text-lg gradient-text leading-tight">모두봄에 오신 걸 환영해요</p>
              <p className="text-xs text-muted-foreground">숨어있는 내 복지, 1분이면 찾아요 🌱</p>
            </div>
          </div>
          <button onClick={setOnboarded} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        <ul className="mt-5 space-y-3">
          {STEPS.map(({ icon: Icon, title, desc, tint }) => (
            <li key={title} className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${tint}`}><Icon className="h-5 w-5" /></span>
              <div>
                <p className="font-bold text-sm">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-2xl bg-sprout-50 px-4 py-3 text-xs text-sprout-700">
          🔒 입력 정보는 서버가 아닌 <b>내 기기에만</b> 저장돼요. 회원가입도 필요 없어요.
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={setOnboarded} className="btn-secondary flex-1">둘러볼게요</button>
          <button onClick={() => { setOnboarded(); setView('analyze') }} className="btn-primary flex-1"><Sparkles className="h-4 w-4" /> 내 복지 찾기</button>
        </div>
      </motion.div>
    </div>
  )
}
