import { motion } from 'framer-motion'
import { Search, Calculator, FileCheck, Bell, ShieldCheck, Accessibility, Globe } from 'lucide-react'
import { SectionHeading } from '@/ui/SectionHeading'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

const FEATURES = [
  { icon: Globe, title: '다국어 AI 의미 검색', desc: '한국어·English·Tiếng Việt 등 어떤 언어로 물어도, AI가 뜻을 이해해 복지를 찾아드려요. 모델은 내 기기 안에서 직접 실행(서버 전송 없음).', tint: 'text-white bg-gradient-to-br from-sprout-500 to-sky2-500', badge: 'NEW' },
  { icon: Search, title: '맞춤 복지 탐색', desc: '내 상황에 딱 맞는 혜택만 AI가 골라드려요. 키워드·카테고리 검색도 가능.', tint: 'text-sprout-600 bg-sprout-100' },
  { icon: Calculator, title: '예상 금액 계산', desc: '매달 얼마나 받을 수 있는지 한눈에. 우선순위 높은 혜택부터 안내해요.', tint: 'text-peach-600 bg-peach-100' },
  { icon: FileCheck, title: '서류 자동 준비', desc: '필요 서류를 체크리스트로 정리하고, 정부24·건보공단에서 자동 발급까지.', tint: 'text-sky2-600 bg-sky2-100' },
  { icon: Bell, title: '생애 이벤트 알림', desc: '출산·실직 같은 변화에 맞춰 새로 받을 수 있는 혜택과 기한을 알려드려요.', tint: 'text-yellow-700 bg-sun-100' },
  { icon: ShieldCheck, title: '안심 개인정보', desc: '입력 정보는 서버가 아닌 내 기기에만 저장. 회원가입도 필요 없어요.', tint: 'text-sprout-600 bg-sprout-100' },
  { icon: Accessibility, title: '누구나 쉽게', desc: '큰글씨 모드와 음성 입력으로 어르신도 편하게 이용할 수 있어요.', tint: 'text-rose-600 bg-rose-100' },
]

export function Features() {
  const setView = useAppStore((s) => s.setView)
  const setAiIntent = useAppStore((s) => s.setAiIntent)
  const openAiSearch = () => { setAiIntent(true); setView('explore') }

  return (
    <section className="section-pad">
      <div className="page-container">
        <SectionHeading
          eyebrow="모두봄이 하는 일"
          title={<>확인부터 신청·관리까지<br className="hidden sm:block" /> <span className="gradient-text-warm">한 곳에서</span></>}
        />
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, title, desc, tint, badge }, i) => {
            const clickable = badge === 'NEW'
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                onClick={clickable ? openAiSearch : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAiSearch() } } : undefined}
                aria-label={clickable ? `${title} 체험하기` : undefined}
                className={cn('card-cute card-hover p-6 relative', clickable && 'cursor-pointer ring-2 ring-sprout-300 focus-ring')}
              >
                {badge && (
                  <span className="absolute right-4 top-4 rounded-full bg-peach-400 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-soft">
                    {badge}
                  </span>
                )}
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${tint}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="font-bold text-lg mb-1.5">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                {clickable && (
                  <p className="mt-3 text-sm font-bold text-sprout-600">지금 체험하기 →</p>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
