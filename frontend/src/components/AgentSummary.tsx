import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, FileText, Send, CheckCircle2, ExternalLink } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { isRpaSupported } from '@/lib/officialLinks'
import { useBackend } from '@/lib/useBackend'
import { detectExtension } from '@/lib/extension'

/**
 * 에이전트 자동화 요약 — 담은 복지 기준으로 '에이전트가 대신 신청/발급할 수 있는 것'을 한눈에.
 * 확장(또는 로컬 에이전트)이 있으면 활성 표시, 없으면 설치 유도. 발견성 향상용.
 */
export function AgentSummary() {
  const tracked = useAppStore((s) => s.tracked)
  const { ready, caps } = useBackend()
  const [ext, setExt] = useState(false)
  useEffect(() => { detectExtension().then(setExt) }, [])
  const active = ext || (ready === true && !!caps?.rpa)

  const { applyable, docCount } = useMemo(() => {
    const map = getPolicyMap()
    let applyable = 0
    const docs = new Set<string>()
    tracked.forEach((t) => {
      const p = map[t.policyId]
      if (!p) return
      if (/bokjiro\.go\.kr|kosaf\.go\.kr/.test(p.application || '')) applyable += 1
      ;(p.required_docs || []).forEach((d) => { if (isRpaSupported(d)) docs.add(d) })
    })
    return { applyable, docCount: docs.size }
  }, [tracked])

  if (applyable === 0 && docCount === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="mt-8 card-cute p-4 sm:p-5"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <Bot className="h-5 w-5 text-sprout-500" /> 에이전트 자동화
        </h2>
        {active ? (
          <span className="chip-sprout"><CheckCircle2 className="h-3.5 w-3.5" /> 활성화됨</span>
        ) : (
          <span className="chip-sky">확장 설치하면 켜져요</span>
        )}
      </div>

      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        담은 복지를 기준으로, 에이전트가 <b>대신 해드릴 수 있는 일</b>이에요.
        {active ? ' 지금 바로 실행할 수 있어요.' : ' 크롬 확장을 설치하면 이 브라우저에서 실행돼요.'}
        <span className="block mt-0.5 text-xs">🔒 개인정보는 서버로 전송되지 않고, 본인인증·최종 제출은 본인이 직접 합니다.</span>
      </p>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-sprout-50/60 border border-sprout-100 p-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600"><Send className="h-5 w-5" /></div>
          <div>
            <p className="text-2xl font-extrabold leading-none">{applyable}<span className="text-sm font-bold text-muted-foreground">건</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">에이전트 자동 신청 가능</p>
          </div>
        </div>
        <div className="rounded-2xl bg-sky2-50/60 border border-sky2-100 p-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky2-100 text-sky2-600"><FileText className="h-5 w-5" /></div>
          <div>
            <p className="text-2xl font-extrabold leading-none">{docCount}<span className="text-sm font-bold text-muted-foreground">종</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">서류 자동 발급 가능</p>
          </div>
        </div>
      </div>

      {!active && (
        <a
          href="https://github.com/BioCode67/modoo-bom/tree/main/extension#설치-개발자-모드--데모"
          target="_blank" rel="noopener noreferrer"
          className="btn-primary !py-2 mt-3 text-xs"
        >
          <ExternalLink className="h-3.5 w-3.5" /> 확장 설치하고 자동화 켜기
        </a>
      )}
    </motion.section>
  )
}
