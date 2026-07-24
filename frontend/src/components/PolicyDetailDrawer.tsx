import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Heart, ExternalLink, CheckCircle2, Building2, RefreshCw, Rocket, Volume2, Square, Phone, Sparkles, ShieldCheck } from 'lucide-react'
import { useTTS } from '@/lib/useTTS'
import { relatedPolicies, type SemanticHit } from '@/lib/semanticSearch'
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { generateGuides, matchFacts } from '@/lib/welfare-engine'
import { categoryMeta, parseMonthly, formatWon, isCashBenefit, PRIORITY_META } from '@/lib/format'
import { deadlineHint } from '@/lib/deadline'
import { docLink, isApplyAutomatable } from '@/lib/officialLinks'
import { trustInfo } from '@/lib/trust'
import { useBackend } from '@/lib/useBackend'
import { AgentSubmitButton } from '@/components/AgentSubmitButton'
import { ApplyProbeButton } from '@/components/ApplyProbeButton'
import { APPLY_EXTRA_EVENT } from '@/lib/applyExtra'
import { ApplyFlow } from '@/components/ApplyFlow'
import { TermText } from '@/components/TermText'
import { VisitKit } from '@/components/VisitKit'
import { FreshnessBadge } from '@/components/FreshnessBadge'
import { DocSharingNote } from '@/components/DocSharingNote'
import { ConditionChips, BenefitBreakdownView } from '@/components/PolicyConditionChips'
import { t as tr, RTL } from '@/lib/i18nLite'
import { ApplyKit } from '@/components/ApplyKit'
import { oneTapApply, bestApplyInfo } from '@/lib/quickApply'
import { setPendingReturn } from '@/lib/returnPrompt'
import { useAppStore } from '@/store/useAppStore'
import { buildPrefill } from '@/lib/prefill'
import { buildEvents, downloadICS, futureEvents } from '@/lib/calendar'
import { cn } from '@/lib/utils'

function toEligible(p: Policy | EligiblePolicy): EligiblePolicy {
  if ('priority' in p) return p as EligiblePolicy
  return { ...p, reason: '', priority: 'medium', confidence: 0.8 }
}

/** 현금성일 때만 월 금액, 아니면 0 — 서비스 한도(재가급여)·바우처를 '월 N' 현금처럼 표기/정렬하지 않게
 *  전 컴포넌트 공통 게이트(isCashBenefit)를 관련목록에도 적용(감사 F2: 비현금을 현금으로 과장하던 결함) */
function cashMonthly(p: Policy): number {
  return isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
}

export function PolicyDetailDrawer({
  policy,
  onClose,
  onOpen,
}: {
  policy: Policy | EligiblePolicy | null
  onClose: () => void
  onOpen?: (p: Policy | EligiblePolicy) => void
}) {
  const { isSaved, toggleSaved, setStatus, setView } = useAppStore()
  const panelRef = useRef<HTMLElement>(null)

  // ESC 닫기 + 배경 스크롤 잠금 + 포커스 관리(모달 접근성: 열 때 포커스 이동, 닫을 때 복원, Tab 트랩)
  const open = policy != null
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const prevFocused = document.activeElement as HTMLElement | null
    // 다음 프레임에 패널 안 첫 포커스 요소(또는 패널)로 포커스 이동
    const focusTimer = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const f = panel.querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ;(f || panel).focus()
    }, 40)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      // Tab이 패널 밖으로 새지 않게 순환(배경 콘텐츠로의 포커스 이탈 방지)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      try { prevFocused?.focus() } catch { /* 무시 */ } // 닫을 때 이전 포커스 복원
    }
    // open만 의존: onClose는 매 렌더 새 함수라 deps에 넣으면 churn 발생
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 드로어 안에서 '관련/비슷한 복지'로 이동하면 policy만 바뀌고 open은 그대로라 위 effect가 재실행되지 않는데,
  //   본문(DrawerBody)은 policy.id로 keyed remount → 포커스가 body로 떨어져 스크린리더 읽기 위치가 초기화된다.
  //   policy.id 변화마다 패널 첫 요소로 포커스를 다시 옮겨 접근성을 유지(감사 a11y). 셋업/복원은 위 effect 담당.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const f = panel.querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ;(f || panel).focus()
    }, 50)
    return () => clearTimeout(t)
  }, [policy?.id, open])

  return (
    <AnimatePresence>
      {policy && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-sprout-900/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            className="fixed z-50 inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] max-h-[92vh] sm:max-h-none overflow-y-auto nice-scroll bg-background rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl outline-none"
            initial={{ y: '100%', x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label={`${policy.name} 상세`}
          >
            {/* key=policy.id — 드로어 안에서 '비슷한 복지'로 다른 정책 이동 시 이전 정책의 로컬상태(applied 배너·AI유사목록)가 잔존하지 않도록 재마운트 */}
            <DrawerBody key={policy.id} policy={policy} onClose={onClose} onOpen={onOpen} ctx={{ isSaved, toggleSaved, setStatus, setView }} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function DrawerBody({
  policy,
  onClose,
  onOpen,
  ctx,
}: {
  policy: Policy | EligiblePolicy
  onClose: () => void
  onOpen?: (p: Policy | EligiblePolicy) => void
  ctx: {
    isSaved: (id: string) => boolean
    toggleSaved: (p: { id: string; name: string; category: string }) => void
    setStatus: (id: string, s: 'idle' | 'tracking' | 'applied' | 'done') => void
    setView: (v: 'home' | 'analyze' | 'explore' | 'my') => void
  }
}) {
  const meta = categoryMeta(policy.category)
  // 현금성만 '월 N까지'로 강조 — 바우처·감면·현물·자산형성을 매월 받는 현금처럼 과장하지 않게(카드와 동일 기준)
  const monthly = isCashBenefit(policy.benefit, `${policy.name} ${policy.category}`) ? parseMonthly(policy.benefit) : 0
  const saved = ctx.isSaved(policy.id)
  const guide = generateGuides([toEligible(policy)])[0]
  const eligible = 'priority' in policy ? (policy as EligiblePolicy) : null
  const tts = useTTS()
  const { ready, caps } = useBackend()
  const hasBackend = ready === true && !!caps?.rpa
  const { profile, rpaInfo, uiLang } = useAppStore()
  const analysisResult = useAppStore((s) => s.result)
  const trackedList = useAppStore((s) => s.tracked)
  const docDoneMap = useAppStore((s) => s.docDone) // 반응형 구독(전역 서류 준비완료)
  const toggleDocDone = useAppStore((s) => s.toggleDocDone)
  // 이 정책이 실제 '내 분석 결과'에서 나온 것인지 — 신청 흐름 1단계의 '자동 선별 완료' 표기 정직성 근거.
  const matched = !!analysisResult?.eligible_policies.some((e) => e.id === policy.id)
  // 신청 CTA의 URL+라벨을 '최종 목적지' 기준으로 한 번에 — 라벨('복지로에서 신청')과 실제 착지(검색 등)가
  // 어긋나던 것 수정(감사 확정). LOC- 정책은 id 게이트로 동명 타 사업 딥링크 오연결 차단.
  const apply = bestApplyInfo(policy.application, policy.name, policy.id)
  const [visitKit, setVisitKit] = useState(false)
  const [applied, setApplied] = useState<false | 'copied' | 'opened' | 'blocked'>(false)
  const [blockedUrl, setBlockedUrl] = useState('')
  // 🔎 β 신청 딥링크 등록/해제 시 재렌더 — AgentSubmitButton(불변)이 새 오버레이를 즉시 반영하게
  const [, setApplyExtraTick] = useState(0)
  useEffect(() => {
    const bump = () => setApplyExtraTick((t) => t + 1)
    window.addEventListener(APPLY_EXTRA_EVENT, bump)
    return () => window.removeEventListener(APPLY_EXTRA_EVENT, bump)
  }, [])
  const related = onOpen
    ? getCatalog().filter((p) => p.category === policy.category && p.id !== policy.id)
        .sort((a, b) => cashMonthly(b) - cashMonthly(a)).slice(0, 3)
    : []

  // AI 의미기반 비슷한 복지(옵트인) — 사전계산 임베딩만 사용(모델 다운로드 불필요)
  const [aiRelated, setAiRelated] = useState<SemanticHit[] | null>(null)
  const [aiRelLoading, setAiRelLoading] = useState(false)
  const [aiRelErr, setAiRelErr] = useState(false)
  const findAiRelated = async () => {
    setAiRelLoading(true)
    setAiRelErr(false)
    try {
      setAiRelated(await relatedPolicies(policy.id, 6))
    } catch {
      setAiRelErr(true)
    } finally {
      setAiRelLoading(false)
    }
  }

  const speakPolicy = () => tts.toggle(
    `${policy.name}. 혜택 내용. ${policy.benefit}. 지원 대상. ${policy.target}. 자격 요건. ${policy.eligibility}. 신청 방법. ${policy.application}.`,
  )

  // 원터치 신청 이동 — 설치 없이(어느 브라우저·폰에서든) 가장 매끄러운 안전한 신청 경로:
  //  ① 내 정보(이름)를 클립보드에 자동 복사 → ② 공식 신청 페이지를 새 탭으로 열기
  //  → ③ 사용자는 정부 공식 사이트에서 간편인증(카카오 등)만 하고 붙여넣어 제출. (인증·제출은 안전상 본인 몫)
  const startApply = async () => {
    if (!saved) ctx.toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
    // 이미 '신청 완료/수급 중'인 정책을 다시 열람(갱신 여정)해도 상태를 'tracking'으로 강등하지 않는다
    const cur = trackedList.find((t) => t.policyId === policy.id)?.status
    if (!cur || cur === 'idle') ctx.setStatus(policy.id, 'tracking')
    const r = await oneTapApply(policy.application, policy.name, profile, rpaInfo, policy.id) // 정보 복사 + 공식 신청 페이지 열기
    if (r.opened) setPendingReturn({ kind: 'apply', policyId: policy.id, name: policy.name }) // 복귀 시 '신청하셨나요?' 확인
    // 팝업 차단이면 '이동했어요'라고 거짓 안내하지 않는다 — 직접 이동 링크를 배너로 제공
    setBlockedUrl(r.url)
    setApplied(r.opened ? (r.copied ? 'copied' : 'opened') : 'blocked')
  }

  return (
    <div className="pb-safe">
      {/* 헤더 */}
      <div className={cn('sticky top-0 z-10 px-5 pt-5 pb-4 bg-gradient-to-br from-sprout-50 to-white border-b border-sprout-100')}>
        <div className="flex items-start gap-3">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl', meta.cls)}>{meta.emoji}</div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-muted-foreground">{policy.category} · {policy.department}</span>
            <h2 className="text-xl font-extrabold leading-tight mt-0.5">{policy.name}</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {tts.supported && (
              <button onClick={speakPolicy} aria-label={tts.speaking ? '읽기 중지' : '정책 읽어주기'} className="rounded-full p-2 hover:bg-muted text-sprout-700">
                {tts.speaking ? <Square className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
            <button onClick={onClose} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
        </div>
        {eligible && eligible.priority && (
          <span className={cn('chip mt-3 inline-flex border', PRIORITY_META[eligible.priority].cls)}>
            {PRIORITY_META[eligible.priority].emoji} {PRIORITY_META[eligible.priority].label} · 신뢰도 {Math.round(eligible.confidence * 100)}%
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* 외국어 사용자 안내 — UI 골격은 자국어, 정책 본문은 한국어 + 즉시 번역/통역 연결(정직성) */}
        {uiLang !== 'ko' && (() => {
          // 즉시 자국어 번역: 정책 핵심(이름·혜택·대상·신청)을 구글 번역 텍스트 링크로. 앱 내 기계번역(환각) 대신 외부 도구로 연결.
          const gtl = uiLang === 'zh' ? 'zh-CN' : uiLang // 구글 중국어 코드
          // 신청 안내에서 raw URL은 제거(번역해도 무의미·글자수 낭비) — 사람이 읽는 안내문만 포함
          const applyText = (policy.application || '').replace(/https?:\/\/\S+/g, '').replace(/\(\s*\)/g, '').trim()
          const text = [policy.name, policy.benefit, policy.eligibility && `대상: ${policy.eligibility}`, applyText && `신청: ${applyText}`]
            .filter(Boolean).join('\n').slice(0, 1400)
          const gurl = `https://translate.google.com/?sl=ko&tl=${gtl}&op=translate&text=${encodeURIComponent(text)}`
          return (
            <div dir={RTL.includes(uiLang) ? 'rtl' : 'ltr'} className="rounded-2xl bg-sky2-50 border border-sky2-100 px-3.5 py-2.5 text-xs leading-relaxed text-sky2-800">
              <p>🌐 {tr(uiLang, 'banner')}</p>
              <a href={gurl} target="_blank" rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 font-bold text-sky2-700 underline hover:text-sky2-800">
                {tr(uiLang, 'translateCta')} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )
        })()}
        {(() => {
          const d = deadlineHint(policy)
          if (!d) return null
          return (
            <div className={cn('rounded-2xl border p-3 flex items-start gap-2', d.urgent ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200')}>
              <span className="text-lg leading-none">⏰</span>
              <div>
                <p className={cn('text-sm font-bold', d.urgent ? 'text-rose-700' : 'text-amber-700')}>{d.urgent ? '신청 기한을 꼭 확인하세요!' : '신청 기간이 정해져 있어요'}</p>
                <p className={cn('text-xs mt-0.5', d.urgent ? 'text-rose-600/90' : 'text-amber-700/90')}>{d.label} · 기한을 놓치면 못 받을 수 있어요.</p>
              </div>
            </div>
          )
        })()}
        {eligible?.reason && (
          <div className="rounded-2xl bg-sprout-50 border border-sprout-100 p-4">
            <p className="text-sm font-bold text-sprout-700 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> 내가 받을 수 있는 이유</p>
            <p className="text-sm text-sprout-700 mt-1">{eligible.reason}</p>
            {/* '왜 나에게 맞는지'를 내 실제 정보와 대조한 체크리스트 — 조건을 한눈에(경쟁 앱은 조건 나열만) */}
            {(() => {
              const facts = profile ? matchFacts(policy, profile) : []
              return facts.length > 0 ? (
                <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-sprout-100 pt-2.5">
                  {facts.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-sm text-sprout-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-sprout-700" /> {f}
                    </li>
                  ))}
                </ul>
              ) : null
            })()}
          </div>
        )}

        {(() => {
          // 공공데이터 요약본(대상=혜택=자격이 동일)이면 한 섹션으로 깔끔하게
          const summaryOnly = policy.target === policy.benefit && policy.benefit === policy.eligibility
          if (summaryOnly) {
            return (
              <Section title={`📋 ${tr(uiLang,'serviceInfo')}`}>
                <TermText text={policy.benefit} className="text-sm text-foreground/80 leading-relaxed block" />
                <a href={apply.url} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sprout-700 hover:underline">
                  복지로에서 자세한 자격·금액 확인 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Section>
            )
          }
          return (
            <>
              <Section title={`💰 ${tr(uiLang,'benefit')}`}>
                {monthly > 0 && <p className="text-2xl font-extrabold text-sprout-700 mb-1">월 {formatWon(monthly)}까지</p>}
                <TermText text={policy.benefit} className="text-sm text-foreground/80 leading-relaxed block" />
                {/* 합산형 급여(기초+부가=합계)면 구성 요소로 풀어 보여줌 */}
                <BenefitBreakdownView benefit={policy.benefit} />
              </Section>
              <Section title={`🎯 ${tr(uiLang,'target')}`}>
                <TermText text={policy.target} className="text-sm text-foreground/80 leading-relaxed block" />
              </Section>
              <Section title={`📋 ${tr(uiLang,'eligibility')}`}>
                {/* 자유서술 자격을 스캔 가능한 조건 칩(연령·소득·대상군·지역)으로 먼저 */}
                <ConditionChips policy={policy} />
                <TermText text={policy.eligibility} className="text-sm text-foreground/80 leading-relaxed block" />
              </Section>
            </>
          )
        })()}

        {/* 신청 단계 */}
        {guide && (
          <Section title={`🚀 ${tr(uiLang,'howToApply')}`}>
            <ol className="space-y-2">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sprout-700 text-white text-[11px] font-bold">{i + 1}</span>
                  <span className="text-foreground/80">{s.replace(/^\d+단계:\s*/, '')}</span>
                </li>
              ))}
            </ol>
            {guide.tips && <p className="mt-3 rounded-xl bg-sun-100 px-3 py-2 text-xs text-yellow-800">💡 {guide.tips}</p>}
          </Section>
        )}

        {/* 신청 키트 — 자동화 흐름 + 공식 신청 페이지 직결 + 내 정보 미리채움(복사) */}
        <Section title={`📝 ${tr(uiLang,'applyKit')}`}>
          <div className="mb-2.5">
            <ApplyFlow automatable={isApplyAutomatable(policy.name)} hasBackend={hasBackend} hasPrefill={buildPrefill(profile, rpaInfo).length > 0} matched={matched} />
          </div>
          <a
            href={apply.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full justify-center"
          >
            <ExternalLink className="h-4 w-4" /> {apply.label}
          </a>
          <div className="mt-2.5">
            <ApplyKit />
          </div>
        </Section>

        {/* 에이전트 자동 신청 (지원 서비스 + 백엔드 있을 때) */}
        <AgentSubmitButton policy={policy} />
        {/* 🔎 자동신청 미지원 정책의 실측 확장(β) — 통과 시 위 버튼이 재렌더로 즉시 나타난다 */}
        <ApplyProbeButton policy={policy} />

        {/* 필요 서류 — 체크 가능한 준비 체크리스트(전역 기억: 등본 등 공통 서류는 여러 복지에서 준비완료 공유) */}
        {policy.required_docs?.length > 0 && (() => {
          // 전역 docDone(공통 서류) + 이 정책의 개별 체크(checkedDocs)를 모두 반영 — 나의 복지 카드에서
          //   체크한 서류가 상세에선 미체크로 보이던 불일치(과소표시) 해소(TrackedCard·monitoring과 동일 기준, 감사 F3)
          const trackedItem = trackedList.find((t) => t.policyId === policy.id)
          const done = (d: string) => (trackedItem?.checkedDocs.includes(d) ?? false) || !!docDoneMap[d.replace(/\s/g, '')]
          const doneCount = policy.required_docs.filter(done).length
          const total = policy.required_docs.length
          return (
            <Section title={`📑 ${tr(uiLang,'requiredDocs')} · ${doneCount}/${total} 준비`}>
              {doneCount > 0 && (
                <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-sky2-100">
                  <div className="h-full rounded-full bg-sprout-500 transition-all" style={{ width: `${Math.round((doneCount / total) * 100)}%` }} />
                </div>
              )}
              <ul className="space-y-1.5">
                {policy.required_docs.map((d: string) => {
                  const dl = docLink(d)
                  const ok = done(d)
                  return (
                    <li key={d} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm ${ok ? 'text-muted-foreground' : 'text-foreground/80'}`}>
                      <button
                        onClick={() => toggleDocDone(d)}
                        aria-pressed={ok}
                        aria-label={`${d} 준비 ${ok ? '완료 취소' : '완료 표시'}`}
                        className="shrink-0"
                      >
                        {ok
                          ? <CheckCircle2 className="h-5 w-5 text-sprout-600" />
                          : <Square className="h-5 w-5 text-sky2-400" />}
                      </button>
                      <span className={`flex-1 ${ok ? 'line-through' : ''}`}>{d}</span>
                      <a href={dl.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-sky2-700 hover:underline inline-flex items-center gap-0.5 shrink-0">
                        발급 <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  )
                })}
              </ul>
              {/* 행정정보 공동이용 — 동의 서명 하나로 안 떼도 되는 서류 안내(생략 가능분 있을 때만) */}
              <DocSharingNote policy={policy} />
              {doneCount === total && (
                // 준비 완료 → 곧바로 신청으로 연결(루프 완성). bestApplyUrl로 주요 복지는 정확한 복지로 딥링크.
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-sprout-50 px-3 py-2.5">
                  <p className="flex-1 text-xs font-semibold text-sprout-700">✅ 필요 서류를 모두 준비했어요. 이제 신청하면 돼요!</p>
                  <a href={apply.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-sprout-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sprout-700 transition-colors shrink-0">
                    신청하러 가기 <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </Section>
          )
        })()}

        {/* 문의처 — 실사용자가 바로 전화할 수 있게 */}
        {policy.contact && (() => {
          const tel = (policy.contact.match(/[\d]{2,4}[-\s]?[\d]{3,4}[-\s]?[\d]{4}|[\d]{3,4}[-\s]?[\d]{4}/) || [])[0]?.replace(/\s/g, '')
          return (
            <a
              href={tel ? `tel:${tel}` : undefined}
              className="flex items-center gap-2 rounded-2xl bg-sky2-50 border border-sky2-100 px-4 py-3 text-sm font-semibold text-sky2-700"
            >
              <Phone className="h-4 w-4 shrink-0" />
              <span className="flex-1">{policy.contact}</span>
              {tel && <span className="chip-sky shrink-0">전화걸기</span>}
            </a>
          )
        })()}

        {/* 주민센터 방문용 인쇄 — 어르신·디지털 소외층의 실제 신청 경로(창구 방문) 지원 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={() => setVisitKit(true)} className="btn-secondary !py-2.5 text-sm">
            📄 {tr(uiLang, 'visitPrint')}
          </button>
          {/* 폰 캘린더에 준비 알림 — 내보내기 전용(.ics). 마감을 날조하지 않고, 관심목록을 몰래 바꾸지도 않는다(정직).
              이미 담아둔 정책은 실제 저장시점·상태로 일정을 만들어 '나의 복지' 모니터링과 어긋나지 않게 한다. */}
          <button
            onClick={() => {
              const existing = trackedList.find((t) => t.policyId === policy.id)
              const item = existing ?? { policyId: policy.id, name: policy.name, category: policy.category, status: 'tracking' as const, savedAt: Date.now(), checkedDocs: [] }
              // 과거 날짜 이벤트(이미 지난 준비일·점검일)는 캘린더에 무의미하므로 제외. 남는 게 없으면 정직히 안내.
              const ev = futureEvents(buildEvents([item], { [policy.id]: policy as Policy }))
              if (ev.length) downloadICS(ev)
              else alert('이 복지는 지금 캘린더에 넣을 예정 일정이 없어요. (준비 기한이 지났거나, 정해진 갱신 주기가 없는 경우예요.)')
            }}
            className="btn-secondary !py-2.5 text-sm"
          >
            ⏰ 폰 캘린더에 준비 알림
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> {policy.department}</span>
          <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> 갱신: {policy.renewal}</span>
        </div>

        {/* 출처·신뢰 근거 — 투명성(경쟁 서비스의 AI 환각 리스크와 차별화, 정직성 원칙) */}
        {(() => {
          const t = trustInfo(policy.id)
          return (
            <div className="rounded-2xl border border-sky2-100 bg-sky2-50/40 p-3 text-xs leading-relaxed">
              <p className="font-bold text-foreground/80 inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-sprout-700" /> 출처 · 신뢰 근거
              </p>
              <p className="mt-1 text-muted-foreground">{t.verified ? '✅ ' : 'ℹ️ '}{t.source}{t.note ? ` · ${t.note}` : ''}</p>
              <p className="mt-1 text-muted-foreground/80">실제 자격·지급액은 신청 기관의 <b>행정 심사</b>로 최종 확정돼요. 모두봄은 공식 정보를 있는 그대로 안내해요(추정·과장 없음).</p>
            </div>
          )
        })()}

        {/* 데이터 신선도·완결성 — 이 레코드를 얼마나 믿고 무엇을 공식 확인해야 하는지 정직 지표 */}
        <FreshnessBadge policy={policy} />

        {/* 함께 보면 좋은 복지 */}
        {related.length > 0 && onOpen && (
          <Section title="🔗 함께 보면 좋은 복지">
            <ul className="space-y-1.5">
              {related.map((r) => {
                const rm = cashMonthly(r)
                return (
                  <li key={r.id}>
                    <button onClick={() => onOpen(r)} className="w-full flex items-center gap-2 rounded-xl border border-sprout-100 px-3 py-2 text-left hover:bg-sprout-50 transition-colors">
                      <span>{categoryMeta(r.category).emoji}</span>
                      <span className="flex-1 text-sm font-semibold truncate">{r.name}</span>
                      {rm > 0 && <span className="text-xs font-bold text-sprout-700 shrink-0">월 {formatWon(rm)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
        {/* AI 의미기반 비슷한 복지(옵트인) */}
        {onOpen && (
          <Section title="🤖 AI로 비슷한 복지">
            {!aiRelated && !aiRelErr && (
              <button
                onClick={findAiRelated}
                disabled={aiRelLoading}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-sprout-200 bg-white px-3 py-2 text-sm font-semibold text-sprout-700 transition-colors hover:border-sprout-300 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" /> {aiRelLoading ? 'AI가 의미로 찾는 중…' : '의미가 비슷한 복지 찾기'}
              </button>
            )}
            {aiRelErr && <p className="text-xs text-rose-600">비슷한 복지를 불러오지 못했어요.</p>}
            {aiRelated && aiRelated.length === 0 && <p className="text-xs text-muted-foreground">비슷한 복지를 찾지 못했어요.</p>}
            {aiRelated && aiRelated.length > 0 && (
              <ul className="space-y-1.5">
                {aiRelated.map(({ policy: r }) => {
                  const rm = cashMonthly(r)
                  return (
                    <li key={r.id}>
                      <button onClick={() => onOpen(r)} className="flex w-full items-center gap-2 rounded-xl border border-sprout-100 px-3 py-2 text-left transition-colors hover:bg-sprout-50">
                        <span>{categoryMeta(r.category).emoji}</span>
                        <span className="flex-1 truncate text-sm font-semibold">{r.name}</span>
                        {rm > 0 && <span className="shrink-0 text-xs font-bold text-sprout-700">월 {formatWon(rm)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        )}
      </div>

      {/* 원터치 신청 후 안내 — 설치 없이 안전하게. 자동 소멸시키지 않는다(안내가 가장 필요한 순간은
          정부 탭에서 돌아온 때). 팝업 차단이면 '이동했어요' 대신 직접 이동 링크를 정직하게 제공. */}
      {applied && (
        <div className={cn('sticky bottom-[76px] mx-4 mb-2 rounded-2xl border px-4 py-2.5 text-xs flex items-start gap-2',
          applied === 'blocked' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-sprout-50 border-sprout-200 text-sprout-800')}
          role="status" aria-live="polite">
          <span className="flex-1">
            {applied === 'blocked' ? (
              <>⚠️ 팝업이 차단돼 새 탭을 못 열었어요 — <a href={blockedUrl} target="_blank" rel="noopener noreferrer"
                onClick={() => setPendingReturn({ kind: 'apply', policyId: policy.id, name: policy.name })}
                className="underline font-bold">여기를 눌러 공식 신청 페이지로 이동</a>하세요.</>
            ) : (
              <>{applied === 'copied' ? '✅ 이름을 복사했어요. ' : '✅ 공식 신청 페이지를 열었어요. '}열린 공식 사이트에서 <b>간편인증(카카오 등)</b> 후 {applied === 'copied' ? '첫 칸에 붙여넣고(나머지는 아래 신청 키트에서 항목별 복사) ' : ''}제출하면 끝이에요. 🔒 인증은 정부 사이트에서만 — 안전해요.</>
            )}
          </span>
          <button onClick={() => setApplied(false)} aria-label="안내 닫기" className="shrink-0 font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      {/* 하단 고정 액션 */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-sprout-100 p-4 flex gap-2">
        <button
          onClick={() => ctx.toggleSaved({ id: policy.id, name: policy.name, category: policy.category })}
          className={cn('btn-secondary !px-4', saved && '!bg-peach-50 !border-peach-200 !text-peach-600')}
        >
          <Heart className={cn('h-4 w-4', saved && 'fill-current')} /> {saved ? tr(uiLang, 'saved') : tr(uiLang, 'save')}
        </button>
        <button onClick={startApply} className="btn-primary flex-1">
          <Rocket className="h-4 w-4" /> {uiLang === 'ko' ? '내 정보 복사 + 공식 신청 이동' : tr(uiLang, 'goApply')}
        </button>
        <a
          href={apply.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-warm !px-4"
          title={apply.label}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {visitKit && <VisitKit policy={policy} profile={profile} onClose={() => setVisitKit(false)} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold mb-1.5">{title}</h3>
      {children}
    </div>
  )
}
