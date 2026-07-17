import { motion } from 'framer-motion'
import { MessageCircleHeart, MousePointerClick, Smartphone, ShieldCheck, PlayCircle, Download } from 'lucide-react'
import { SectionHeading } from '@/ui/SectionHeading'
import { DemoAutomation } from '@/components/DemoAutomation'

// 데스크탑 앱(Windows 전용) — 설치 exe '직접 다운로드'(릴리스 게시 확인됨: app-v0.3.0 ModooBom-Setup.exe).
// latest/download 는 최신 릴리스의 동명 자산을 따라가므로 버전이 올라가도 링크가 유지된다.
const AGENT_SETUP_URL = 'https://github.com/BioCode67/modoo-bom/releases/latest/download/ModooBom-Setup.exe'
const AGENT_RELEASES_URL = 'https://github.com/BioCode67/modoo-bom/releases'
const isWindows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

// 무설치 기본 경로 — 어떤 브라우저·폰에서도, 설치 없이. (대부분의 사용자가 이 경로)
const STEPS = [
  { icon: MessageCircleHeart, n: '1', title: '말로 말하면', desc: '“72세 혼자 사는데 소득이 적어요” 한마디(음성도)면 맞춤 복지를 바로 찾아드려요.', who: '모두봄 AI' },
  { icon: MousePointerClick, n: '2', title: '[신청] 한 번', desc: '내 정보를 자동 복사하고 공식 신청 페이지를 바로 열어드려요. 설치도, 크롬 전용도 아니에요.', who: '모두봄' },
  { icon: Smartphone, n: '3', title: '인증만 나', desc: '정부 공식 사이트에서 카카오 간편인증만. 개인정보·인증은 정부 사이트에만 머물러 안전해요.', who: '사용자' },
]

/**
 * 신청까지 이어지는 경험을 정직하게 보여준다.
 * 기본(무설치): 말하기→추천→원터치 신청 이동(내 정보 복사+공식 페이지)→인증만. 어느 브라우저·폰이든.
 * 선택(완전 자동): 크롬 확장/로컬 에이전트로 발급·작성까지 자동(파워 유저). 미래: 공공 마이데이터로 인증만 하면 완전 자동.
 */
export function RpaShowcase() {
  return (
    <section className="section-pad bg-gradient-to-b from-white to-sprout-50/40">
      <div className="page-container">
        <SectionHeading
          eyebrow="찾기에서 끝나지 않아요"
          title={<>말하면 → 추천 → <span className="gradient-text">신청까지</span>, 설치 없이</>}
        />
        <p className="text-center text-muted-foreground -mt-4 mb-10 max-w-2xl mx-auto text-sm leading-relaxed">
          앱 설치도, 크롬 전용도 아니에요. <b className="text-foreground">어떤 브라우저·폰</b>에서든 말로 상황을 말하면 맞춤 복지를 찾고,
          <b className="text-foreground"> [신청] 한 번</b>으로 내 정보를 복사해 공식 신청 페이지까지 데려다드려요. 정부 사이트에서 <b className="text-foreground">인증만</b> 하면 끝.
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
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-700">
                <Icon className="h-6 w-6" />
              </div>
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold ${who === '사용자' ? 'bg-peach-100 text-peach-800' : 'bg-sprout-700 text-white'}`}>{who}</span>
              <h3 className="font-bold text-lg mt-2 mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border-2 border-dashed border-sprout-200 bg-white p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-700">
            <PlayCircle className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="font-bold">더 자동으로도 — 원하는 분만 (선택)</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              데스크탑 앱에서는 <b className="text-foreground">🚀 원클릭 연쇄</b> — 필요한 서류를 순서대로 자동 발급하고, 방금 발급분을
              복지로 신청 양식에 <b className="text-foreground">자동 첨부</b>한 뒤 <b className="text-foreground">제출 직전에 멈춰요</b>.
              📱 카카오 인증 승인과 최종 제출만 본인이요(명의도용 방지 안전장치).
              <br className="hidden sm:block" />앞으로는 <b className="text-foreground">공공 마이데이터</b>로 <b className="text-foreground">인증 한 번이면 완전 자동</b> — 설치 없이 안전하게 준비 중이에요.
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 shrink-0">
            {isWindows && (
              <>
                <a
                  href={AGENT_SETUP_URL}
                  className="btn-primary !py-2 !px-4 text-xs whitespace-nowrap"
                  title="Windows 설치 파일을 바로 내려받아요 — 실행 후 '추가 정보 → 실행'을 누르면 설치돼요"
                >
                  <Download className="h-4 w-4" /> Windows 앱 바로 받기
                </a>
                <a
                  href={AGENT_RELEASES_URL} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  설치 안내·다른 버전 보기
                </a>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sprout-700 bg-sprout-50 rounded-full px-3 py-1.5">
              <ShieldCheck className="h-4 w-4" /> 개인정보 서버 전송 0
            </span>
          </div>
        </div>

        {/* 실제 정부24 자동화 '체험' — 데모 서버(getDemoRpaBase) 연결 시에만 노출. 개인정보 없이 진짜 자동화를 보여줌 */}
        <DemoAutomation />
      </div>
    </section>
  )
}
