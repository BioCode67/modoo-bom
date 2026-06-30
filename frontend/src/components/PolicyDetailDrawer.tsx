import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Heart, ExternalLink, FileText, CheckCircle2, Building2, RefreshCw, Rocket, Volume2, Square, Phone } from 'lucide-react'
import { useTTS } from '@/lib/useTTS'
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { generateGuides } from '@/lib/welfare-engine'
import { categoryMeta, parseMonthly, formatWon, PRIORITY_META } from '@/lib/format'
import { deadlineHint } from '@/lib/deadline'
import { docLink, applyLink } from '@/lib/officialLinks'
import { AgentSubmitButton } from '@/components/AgentSubmitButton'
import { ApplyKit } from '@/components/ApplyKit'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

function toEligible(p: Policy | EligiblePolicy): EligiblePolicy {
  if ('priority' in p) return p as EligiblePolicy
  return { ...p, reason: '', priority: 'medium', confidence: 0.8 }
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

  // ESC로 닫기 + 열려있는 동안 배경 스크롤 잠금 (포커스 트랩 없이 안전하게)
  const open = policy != null
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
    // open만 의존: onClose는 매 렌더 새 함수라 deps에 넣으면 churn 발생
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
            className="fixed z-50 inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] max-h-[92vh] sm:max-h-none overflow-y-auto nice-scroll bg-background rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl"
            initial={{ y: '100%', x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label={`${policy.name} 상세`}
          >
            <DrawerBody policy={policy} onClose={onClose} onOpen={onOpen} ctx={{ isSaved, toggleSaved, setStatus, setView }} />
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
  const monthly = parseMonthly(policy.benefit)
  const saved = ctx.isSaved(policy.id)
  const guide = generateGuides([toEligible(policy)])[0]
  const eligible = 'priority' in policy ? (policy as EligiblePolicy) : null
  const tts = useTTS()
  const related = onOpen
    ? getCatalog().filter((p) => p.category === policy.category && p.id !== policy.id)
        .sort((a, b) => parseMonthly(b.benefit) - parseMonthly(a.benefit)).slice(0, 3)
    : []

  const speakPolicy = () => tts.toggle(
    `${policy.name}. 혜택 내용. ${policy.benefit}. 지원 대상. ${policy.target}. 자격 요건. ${policy.eligibility}. 신청 방법. ${policy.application}.`,
  )

  const startApply = () => {
    if (!saved) ctx.toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
    ctx.setStatus(policy.id, 'tracking')
    onClose()
    ctx.setView('my')
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
              <button onClick={speakPolicy} aria-label={tts.speaking ? '읽기 중지' : '정책 읽어주기'} className="rounded-full p-2 hover:bg-muted text-sprout-600">
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
            <p className="text-sm text-sprout-700/90 mt-1">{eligible.reason}</p>
          </div>
        )}

        {(() => {
          // 공공데이터 요약본(대상=혜택=자격이 동일)이면 한 섹션으로 깔끔하게
          const summaryOnly = policy.target === policy.benefit && policy.benefit === policy.eligibility
          if (summaryOnly) {
            return (
              <Section title="📋 서비스 안내">
                <p className="text-sm text-foreground/80 leading-relaxed">{policy.benefit}</p>
                <a href={applyLink(policy.application).url} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sprout-600 hover:underline">
                  복지로에서 자세한 자격·금액 확인 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Section>
            )
          }
          return (
            <>
              <Section title="💰 혜택 내용">
                {monthly > 0 && <p className="text-2xl font-extrabold text-sprout-600 mb-1">월 {formatWon(monthly)}까지</p>}
                <p className="text-sm text-foreground/80 leading-relaxed">{policy.benefit}</p>
              </Section>
              <Section title="🎯 지원 대상">
                <p className="text-sm text-foreground/80 leading-relaxed">{policy.target}</p>
              </Section>
              <Section title="📋 자격 요건">
                <p className="text-sm text-foreground/80 leading-relaxed">{policy.eligibility}</p>
              </Section>
            </>
          )
        })()}

        {/* 신청 단계 */}
        {guide && (
          <Section title="🚀 신청 방법">
            <ol className="space-y-2">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sprout-500 text-white text-[11px] font-bold">{i + 1}</span>
                  <span className="text-foreground/80">{s.replace(/^\d+단계:\s*/, '')}</span>
                </li>
              ))}
            </ol>
            {guide.tips && <p className="mt-3 rounded-xl bg-sun-100 px-3 py-2 text-xs text-yellow-800">💡 {guide.tips}</p>}
          </Section>
        )}

        {/* 신청 키트 — 공식 신청 페이지 직결 + 내 정보 미리채움(복사) */}
        <Section title="📝 신청 키트">
          <a
            href={applyLink(policy.application).url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full justify-center"
          >
            <ExternalLink className="h-4 w-4" /> {applyLink(policy.application).label}
          </a>
          <div className="mt-2.5">
            <ApplyKit />
          </div>
        </Section>

        {/* 에이전트 자동 신청 (지원 서비스 + 백엔드 있을 때) */}
        <AgentSubmitButton policy={policy} />

        {/* 필요 서류 */}
        {policy.required_docs?.length > 0 && (
          <Section title="📑 필요 서류">
            <ul className="space-y-1.5">
              {policy.required_docs.map((d: string) => {
                const dl = docLink(d)
                return (
                  <li key={d} className="flex items-center gap-2 text-sm text-foreground/80">
                    <FileText className="h-4 w-4 text-sky2-500 shrink-0" />
                    <span className="flex-1">{d}</span>
                    <a href={dl.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-sky2-600 hover:underline inline-flex items-center gap-0.5 shrink-0">
                      발급 <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

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

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> {policy.department}</span>
          <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> 갱신: {policy.renewal}</span>
        </div>

        {/* 함께 보면 좋은 복지 */}
        {related.length > 0 && onOpen && (
          <Section title="🔗 함께 보면 좋은 복지">
            <ul className="space-y-1.5">
              {related.map((r) => {
                const rm = parseMonthly(r.benefit)
                return (
                  <li key={r.id}>
                    <button onClick={() => onOpen(r)} className="w-full flex items-center gap-2 rounded-xl border border-sprout-100 px-3 py-2 text-left hover:bg-sprout-50 transition-colors">
                      <span>{categoryMeta(r.category).emoji}</span>
                      <span className="flex-1 text-sm font-semibold truncate">{r.name}</span>
                      {rm > 0 && <span className="text-xs font-bold text-sprout-600 shrink-0">월 {formatWon(rm)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
      </div>

      {/* 하단 고정 액션 */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-sprout-100 p-4 flex gap-2">
        <button
          onClick={() => ctx.toggleSaved({ id: policy.id, name: policy.name, category: policy.category })}
          className={cn('btn-secondary !px-4', saved && '!bg-peach-50 !border-peach-200 !text-peach-600')}
        >
          <Heart className={cn('h-4 w-4', saved && 'fill-current')} /> {saved ? '저장됨' : '관심'}
        </button>
        <button onClick={startApply} className="btn-primary flex-1">
          <Rocket className="h-4 w-4" /> 신청 준비하기
        </button>
        <a
          href={applyLink(policy.application).url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-warm !px-4"
          title={applyLink(policy.application).label}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
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
