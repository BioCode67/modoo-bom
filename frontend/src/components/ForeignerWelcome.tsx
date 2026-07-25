import { motion } from 'framer-motion'
import { Globe, ArrowRight, Phone } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { requestVoiceCall } from '@/lib/callBridge'

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
          어떤 언어로 물어도 괜찮아요<br className="hidden sm:block" />
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

        {/* 📞 자국어 통화 상담 직행 — 글보다 말이 편한 사용자용(통화 언어 프리셋, VOICE_LANGS 지원 언어만 정직하게 노출) */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-violet-100 pt-4">
          <span className="text-sm font-bold text-violet-700 flex items-center gap-1.5"><Phone className="h-4 w-4" /> 말로 하는 통화 상담 · Voice call <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold">베타</span> —</span>
          {([['en', 'English', '🇬🇧'], ['vi', 'Tiếng Việt', '🇻🇳'], ['zh', '中文', '🇨🇳']] as const).map(([code, label, flag]) => (
            <button
              key={code}
              onClick={() => requestVoiceCall({ lang: code })}
              onMouseEnter={warm} onFocus={warm} onTouchStart={warm} // 통화→AI 검색 핸드오프 대비 모델 프리워밍(언어 카드와 동일)
              aria-label={`자국어 통화 상담 — ${label}`}
              className="rounded-full border border-violet-200 bg-white px-3.5 py-1.5 text-sm font-semibold hover:border-violet-400 hover:shadow-sm transition-all"
            >
              {flag} 📞 {label}
            </button>
          ))}
        </div>
      </motion.div>
    </section>
  )
}
