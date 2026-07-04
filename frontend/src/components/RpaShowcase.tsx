import { motion } from 'framer-motion'
import { MousePointerClick, Smartphone, FileCheck2, ShieldCheck, PlayCircle } from 'lucide-react'
import { SectionHeading } from '@/ui/SectionHeading'

const STEPS = [
  { icon: MousePointerClick, n: '1', title: '누르기만 하면', desc: '“자동발급”을 누르면 에이전트가 정부24를 실제로 조작해 로그인·정보 입력을 대신 해요.', who: 'AI 에이전트' },
  { icon: Smartphone, n: '2', title: '본인인증만 나', desc: '카카오톡 간편인증 승인만 직접. (명의도용·비가역 행위라 사람이 하는 게 맞아요)', who: '사용자' },
  { icon: FileCheck2, n: '3', title: '발급·저장까지', desc: '발급 폼 작성→신청→문서출력→PDF 저장까지 에이전트가 이어서 끝냅니다.', who: 'AI 에이전트' },
]

/**
 * 실제 정부 사이트 자동화 쇼케이스 — 우리의 가장 '에이전트다운' 자산.
 * 라이브 사이트에선 개인정보·보안 때문에 로컬(진짜 크롬+CDP)에서 동작하므로, 여기선 '무엇을 하는지'와
 * '왜 이게 진짜인지(목업 아님)'를 정직하게 보여준다. (시연 영상은 아래 자리에 삽입)
 */
export function RpaShowcase() {
  return (
    <section className="section-pad bg-gradient-to-b from-white to-sprout-50/40">
      <div className="page-container">
        <SectionHeading
          eyebrow="찾기에서 끝나지 않아요"
          title={<>서류 발급·신청까지 <span className="gradient-text">AI가 실제로</span> 대신해요</>}
        />
        <p className="text-center text-muted-foreground -mt-4 mb-10 max-w-2xl mx-auto text-sm leading-relaxed">
          목업이 아니라 <b className="text-foreground">진짜 정부24를 조작</b>합니다. 사용자의 실제 크롬을 에이전트가 원격으로
          움직여(안티매크로도 통과) 로그인·인증정보 입력·발급까지 수행해요. <b className="text-foreground">본인인증만</b> 직접 하면 됩니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {STEPS.map(({ icon: Icon, n, title, desc, who }, i) => (
            <motion.div
              key={n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="card-cute p-6 relative"
            >
              <span className="absolute right-5 top-5 text-4xl font-black text-sprout-100">{n}</span>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600">
                <Icon className="h-6 w-6" />
              </div>
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold ${who === '사용자' ? 'bg-peach-100 text-peach-600' : 'bg-sprout-500 text-white'}`}>{who}</span>
              <h3 className="font-bold text-lg mt-2 mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border-2 border-dashed border-sprout-200 bg-white p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600">
            <PlayCircle className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="font-bold">실제 발급 시연 — 등본이 8단계에서 폰 승인 1단계로</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              발표·심사에서 실제 자동발급 화면을 시연합니다(로컬 에이전트 <code className="text-xs bg-muted px-1 rounded">run-agent-cdp.bat</code>).
              완전 무인 대리인증은 <b className="text-foreground">일부러 배제</b>했어요 — 안전하고 정직한 설계입니다.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sprout-700 bg-sprout-50 rounded-full px-3 py-1.5 shrink-0">
            <ShieldCheck className="h-4 w-4" /> 개인정보 서버 전송 0
          </span>
        </div>
      </div>
    </section>
  )
}
