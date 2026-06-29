import { motion } from 'framer-motion'
import { Sparkles, ArrowRight, ShieldCheck, Compass } from 'lucide-react'
import { MascotCanvas } from '@/three/MascotCanvas'
import { useAppStore } from '@/store/useAppStore'

const STATS = [
  { value: '120+', label: '복지 정책' },
  { value: '6종', label: '서류 자동발급' },
  { value: '무료', label: '평생 이용' },
]

export function Hero() {
  const setView = useAppStore((s) => s.setView)

  return (
    <section className="relative overflow-hidden">
      {/* 배경 블롭 */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -right-16 h-80 w-80 rounded-full bg-sprout-200/50 blur-3xl animate-blob" />
        <div className="absolute top-40 -left-20 h-72 w-72 rounded-full bg-peach-200/40 blur-3xl animate-blob" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-sky2-200/40 blur-3xl animate-blob" style={{ animationDelay: '4s' }} />
      </div>

      <div className="page-container grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-6 items-center pt-10 pb-12 sm:pt-16">
        {/* 좌: 텍스트 */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="order-2 lg:order-1 text-center lg:text-left"
        >
          <span className="chip-sprout inline-flex mb-5">
            <Sparkles className="h-3.5 w-3.5" /> AI가 찾아주는 내 복지 혜택
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight leading-[1.12] text-balance">
            받을 수 있는 <span className="gradient-text">복지 혜택</span>,<br />
            <span className="gradient-text-warm">모두</span> 찾아드릴게요 🌱
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0 text-balance">
            나이·소득·상황만 알려주시면, 숨어있던 복지 혜택을 한 번에 찾아
            <b className="text-foreground"> 신청 방법과 필요 서류</b>까지 쉽게 안내해 드려요.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <button onClick={() => setView('analyze')} className="btn-primary text-base !px-7 !py-3.5">
              <Sparkles className="h-5 w-5" /> 내 복지 찾기 <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={() => setView('explore')} className="btn-secondary text-base !px-7 !py-3.5">
              <Compass className="h-5 w-5" /> 정책 둘러보기
            </button>
          </div>

          <div className="mt-6 flex items-center gap-2 justify-center lg:justify-start text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-sprout-500" />
            개인정보는 <b className="mx-1 text-foreground">내 기기에만</b> 저장돼요. 회원가입 없이 바로 이용.
          </div>

          {/* 통계 */}
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md mx-auto lg:mx-0">
            {STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="card-cute px-3 py-3 text-center"
              >
                <p className="text-2xl font-extrabold gradient-text">{s.value}</p>
                <p className="text-xs font-semibold text-muted-foreground mt-0.5">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* 우: 3D 마스코트 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="order-1 lg:order-2 h-[320px] sm:h-[420px] lg:h-[520px]"
        >
          <MascotCanvas />
        </motion.div>
      </div>
    </section>
  )
}
