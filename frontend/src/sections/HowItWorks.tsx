import { motion } from 'framer-motion'
import { SectionHeading } from '@/ui/SectionHeading'

const STEPS = [
  { emoji: '📝', title: '간단 입력', desc: '나이·소득·가족 상황을 1분이면 입력 끝. 어려우면 데모 프로필로 바로 체험!', color: 'bg-sprout-100' },
  { emoji: '🤖', title: 'AI 자동 분석', desc: '정부·지자체·민간 5,000여 건의 복지 중 내가 받을 수 있는 혜택만 똑똑하게 골라드려요.', color: 'bg-sky2-100' },
  { emoji: '🎁', title: '맞춤 결과', desc: '예상 금액·우선순위·필요 서류까지 한눈에. 마음에 들면 관심목록에 저장!', color: 'bg-peach-100' },
  { emoji: '🚀', title: '신청까지', desc: '단계별 신청 가이드와 정부24·복지로 바로가기로 신청을 끝까지 도와드려요.', color: 'bg-sun-100' },
]

export function HowItWorks() {
  return (
    <section className="section-pad bg-white/60">
      <div className="page-container">
        <SectionHeading
          eyebrow="이렇게 쉬워요"
          title={<>복잡한 복지, <span className="gradient-text">4단계로 끝!</span></>}
          subtitle="복지로 검색하다 포기한 적 있다면, 이제 모두봄이 대신 찾아드릴게요."
        />
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
              className="card-cute card-hover p-6 text-center relative"
            >
              <span className="absolute -top-3 -left-2 flex h-8 w-8 items-center justify-center rounded-full bg-sprout-700 text-white text-sm font-extrabold shadow-soft">
                {i + 1}
              </span>
              <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${s.color} text-3xl`}>
                {s.emoji}
              </div>
              <h3 className="font-bold text-lg mb-1.5">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
