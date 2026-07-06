import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, FileText, Send, CheckCircle2, ExternalLink } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { isRpaSupported, isApplyAutomatable } from '@/lib/officialLinks'
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
  const localAgent = ready === true && !!caps?.rpa
  const active = ext || localAgent

  // 채널별 정직 집계(감사 실측 반영): 복지로/장학재단 자동신청은 확장 전용, 로컬 백엔드는 내장 6서비스·6서류만.
  const { applyable, docCount } = useMemo(() => {
    const map = getPolicyMap()
    let applyable = 0
    const docs = new Set<string>()
    const extLike = ext || !active // 미설치(설치 유도 카드)에선 '설치하면 가능한' 확장 기준으로 안내
    tracked.forEach((t) => {
      const p = map[t.policyId]
      if (!p) return
      if (extLike) {
        if (/bokjiro\.go\.kr|kosaf\.go\.kr/.test(p.application || '')) applyable += 1
      } else if (isApplyAutomatable(p.name)) {
        applyable += 1 // 로컬 에이전트: 내장 자동신청 6종만
      }
      ;(p.required_docs || []).forEach((d) => {
        if (extLike ? isRpaSupported(d) : isRpaSupported(d, 'local')) docs.add(d)
      })
    })
    return { applyable, docCount: docs.size }
  }, [tracked, ext, active])

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
          <span className="chip-sprout">설치 없이 발급 가능</span>
        )}
      </div>

      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        담은 복지를 기준으로, 에이전트가 <b>대신 해드릴 수 있는 일</b>이에요.
        {active
          ? ' 지금 바로 실행할 수 있어요.'
          : ' 지금 이 화면에서 설치 없이, 아래 ‘서류 준비 도우미’의 전자증명서 발급·공식 신청 링크로 바로 진행하실 수 있어요. 로그인·클릭·양식까지 대신하는 완전 자동은 데모용 에이전트를 연결하면 켜져요.'}
        <span className="block mt-0.5 text-xs">🔒 개인정보는 서버로 전송되지 않고, 본인인증·최종 제출은 본인이 직접 합니다.</span>
      </p>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-sprout-50/60 border border-sprout-100 p-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-700"><Send className="h-5 w-5" /></div>
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
        <div className="mt-3 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            👇 아래 <b>서류 준비 도우미</b>에서 <b>설치 없이 전자증명서로 바로 발급</b>하거나 공식 신청으로 이동하세요.
          </p>
          <a
            href="https://github.com/BioCode67/modoo-bom/tree/main/extension#설치-개발자-모드--데모"
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground/70 hover:underline inline-flex items-center gap-1 self-start"
          >
            <ExternalLink className="h-3 w-3" /> 시연·파워유저: 에이전트(로컬) 연결하면 완전 자동으로 실행돼요 →
          </a>
        </div>
      )}
    </motion.section>
  )
}
