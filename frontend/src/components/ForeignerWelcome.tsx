import { motion } from 'framer-motion'
import { Globe, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

/**
 * 외국인·다문화 전용 진입로 — 경쟁 서비스가 전부 비운 시장(모두 한국어 전용).
 * 온디바이스 다국어 의미검색(multilingual-e5)을 그대로 활용해, 자국어로 한 문장만 넣으면
 * 한국 복지를 바로 매칭한다. 회원가입·한국어 불필요, 번역·검색 모두 기기 안(서버 전송 0).
 *
 * ⚠️ 표기는 각 언어 사용자가 바로 알아볼 수 있는 정확한 문구만 사용(간단·검증 가능한 인사/질의).
 */
const LANGS: { flag: string; label: string; hello: string; q: string }[] = [
  { flag: '🇻🇳', label: 'Tiếng Việt', hello: 'Xin chào', q: 'Tôi có thu nhập thấp và cần hỗ trợ' },
  { flag: '🇬🇧', label: 'English', hello: 'Hello', q: 'I have a low income and need support' },
  { flag: '🇨🇳', label: '中文', hello: '你好', q: '我收入低，需要生活补助' },
  { flag: '🇯🇵', label: '日本語', hello: 'こんにちは', q: '収入が少なく、支援が必要です' },
  { flag: '🇮🇩', label: 'Indonesia', hello: 'Halo', q: 'Penghasilan saya rendah dan butuh bantuan' },
  { flag: '🇹🇭', label: 'ไทย', hello: 'สวัสดี', q: 'ฉันมีรายได้น้อยและต้องการความช่วยเหลือ' },
]

export function ForeignerWelcome() {
  const { setAiQuery, setAiIntent, setView } = useAppStore()
  const warm = () => { import('@/lib/semanticSearch').then((m) => m.warmupSemantic()).catch(() => {}) }
  const ask = (q: string) => { setAiQuery(q); setAiIntent(true); setView('explore') }

  return (
    <section className="page-container py-10 sm:py-14">
      <motion.div
        initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }}
        className="rounded-3xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky2-50 p-6 sm:p-8"
      >
        <div className="flex items-center gap-2 text-violet-700">
          <Globe className="h-5 w-5" />
          <span className="text-sm font-bold">For everyone in Korea · 외국인·다문화 환영</span>
        </div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold leading-tight">
          {/* br이 sm+ 전용이라 모바일에서 '괜찮아요Ask in…'로 붙었다(14차) → 모바일은 공백으로 분리 */}
          어떤 언어로 물어도 괜찮아요<span className="sm:hidden"> </span><br className="hidden sm:block" />
          <span className="gradient-text">Ask in your language.</span>
        </h2>
        <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-2xl">
          한국어를 몰라도, 회원가입 없이 — 자국어로 한 문장만 적으면 <b>받을 수 있는 한국 복지</b>를 AI가 바로 찾아드려요.
          번역과 검색은 <b>모두 기기 안에서</b> 이뤄져요(서버 전송 없음). <span className="whitespace-nowrap">🔒 100% on-device.</span>
        </p>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {LANGS.map((l) => (
            <button
              key={l.label}
              onClick={() => ask(l.q)}
              onMouseEnter={warm} onFocus={warm} onTouchStart={warm}
              className="group flex flex-col items-start gap-0.5 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-left hover:border-violet-400 hover:shadow-sm transition-all"
            >
              <span className="text-sm font-bold flex items-center gap-1.5">
                <span className="text-lg">{l.flag}</span> {l.label}
              </span>
              <span className="text-xs text-muted-foreground">{l.hello} — {l.label} 검색 <ArrowRight className="inline h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" /></span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground/80">+ 한국어·기타 언어도 지원 — 입력 언어를 자동으로 감지해요.</p>
        {/* 국적/체류자격 고지 — 외국인이 못 받는 급여를 '받을 수 있다'고 오해하지 않게(감사 #8).
            어설픈 다국어 번역 대신 한국어+영어만 병기(검증 가능한 정확 문구, 정직성). */}
        <p className="mt-2 rounded-xl bg-white/70 border border-violet-100 px-3 py-2 text-[11px] leading-relaxed text-violet-900/80">
          ℹ️ 일부 복지는 <b>국적·체류자격</b> 요건이 있어 외국인은 대상이 아닐 수 있어요.
          정확한 자격은 다누리콜센터 <b>☎1577-1366</b>(13개 언어 통역)에서 확인하세요.
          <span className="block">Some benefits require Korean nationality or a specific visa/residency status. Check with Danuri ☎1577-1366 (interpreters).</span>
        </p>
      </motion.div>
    </section>
  )
}
