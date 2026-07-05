import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Search, Compass, Heart, LifeBuoy, Sparkles, X, Globe } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { useModalFocus } from '@/hooks/useModalFocus'

const STEPS = [
  { icon: Globe, title: '🌍 다국어 AI 의미 검색', desc: '한국어·English·Tiếng Việt 등 어떤 언어로 적어도, AI가 내 기기에서 뜻을 이해해 복지를 찾아 요약해드려요 (글 분석은 서버 전송 없음 · 음성 인식은 브라우저 내장 기능을 사용해요)', tint: 'text-white bg-gradient-to-br from-sprout-500 to-emerald-500' },
  { icon: Search, title: '내 복지 찾기', desc: '“72세 혼자 사는데 소득이 적어요”처럼 한 문장(또는 음성)이면 맞춤 복지를 바로 찾아드려요', tint: 'text-sprout-600 bg-sprout-100' },
  { icon: Compass, title: '정책 탐색', desc: '전국 5,000여 개 복지를 검색·정렬해서 둘러봐요', tint: 'text-sky2-600 bg-sky2-100' },
  { icon: Heart, title: '나의 복지', desc: '관심 복지 저장·신청 준비·사후 관리까지', tint: 'text-peach-600 bg-peach-100' },
  { icon: LifeBuoy, title: '긴급 도움', desc: '위기 상황이면 긴급복지와 129로 바로 안내', tint: 'text-rose-600 bg-rose-100' },
]

/** 첫 방문 1회 노출되는 친근한 안내 — 신규·어르신 진입장벽 완화 */
export function Onboarding() {
  const { onboarded, setOnboarded, setView } = useAppStore()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, !onboarded, setOnboarded)

  if (onboarded) return null

  return (
    <div className="modal-overlay" onClick={setOnboarded}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card-cute w-full max-w-md max-h-[90vh] overflow-auto nice-scroll p-6"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="모두봄 안내"
        ref={panelRef} tabIndex={-1}
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
