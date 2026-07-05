import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw, Heart, TrendingUp, Bell, PartyPopper, Printer, Volume2, Square } from 'lucide-react'
import { useTTS } from '@/lib/useTTS'
import type { AnalysisResult, UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { PolicyCard } from '@/components/PolicyCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { BenefitBreakdown, CategoryDistribution } from '@/components/BenefitCharts'
import { FutureWelfare } from '@/components/FutureWelfare'
import { LifeTimeline } from '@/components/LifeTimeline'
import { ContinuityCard } from '@/components/ContinuityCard'
import { AiDiscovery } from '@/components/AiDiscovery'
import { NearMissCard } from '@/components/NearMissCard'
import { ComboCard } from '@/components/ComboCard'
import { WelfareScore } from '@/components/WelfareScore'
import { ShareButton } from '@/components/ShareButton'
import { Glossary } from '@/components/Glossary'
import { formatWon, sumCashMonthly } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

export function ResultsView({ result, profile, onReset }: { result: AnalysisResult; profile: UserProfile; onReset: () => void }) {
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [showRelated, setShowRelated] = useState(false)
  const setView = useAppStore((s) => s.setView)
  const eligible = result.eligible_policies
  // 정밀 추천(큐레이션 시드) / 민간재단(심사·선발형) / 관련 복지(공공데이터 텍스트 신호) 3분리
  const primary = eligible.filter((p) => /^POL-/.test(p.id))
  const privateRel = eligible.filter((p) => /^PRV-/.test(p.id)) // 민간재단 — 접힌 목록에 묻히지 않게 별도 노출
  const related = eligible.filter((p) => !/^(POL|PRV)-/.test(p.id))
  // 강력추천(high) 중 '현금성'만 합산(바우처·서비스·현물·고용주지원 제외) → 보수적·신뢰 가능한 헤드라인.
  // 자활·구직수당처럼 근로능력/상황 전제이거나 중복불가인 항목까지 더해 과장되지 않도록 의도적으로 좁힘.
  const monthly = sumCashMonthly(primary.filter((p) => p.priority === 'high'))
  const highCount = primary.filter((p) => p.priority === 'high').length
  const tts = useTTS()

  // 스크린리더: 결과 화면 진입 시 '분석 완료 + 찾은 개수'를 안내(마운트 후 채워 확실히 읽히게)
  const [liveMsg, setLiveMsg] = useState('')
  useEffect(() => {
    setLiveMsg(`분석 완료. ${profile.name || '회원'}님이 받을 수 있는 복지 ${primary.length}개를 찾았어요. 강력 추천 ${highCount}개.`)
  }, [primary.length, highCount, profile.name])

  const speakSummary = () => {
    const names = eligible.slice(0, 5).map((p) => p.name).join(', ')
    tts.toggle(
      `${profile.name || '회원'}님이 받을 수 있는 복지는 ${primary.length}개입니다. ` +
      (monthly > 0 ? `핵심 현금지원은 최대 월 ${formatWon(monthly)} 정도입니다. ` : '') +
      (names ? `주요 혜택은 ${names} 등입니다. 자세한 내용은 각 항목을 눌러 확인하세요.` : ''),
    )
  }

  return (
    <div className="page-container py-8 sm:py-10">
      {/* 스크린리더 전용: 결과 도착 안내 */}
      <p className="sr-only" role="status" aria-live="polite">{liveMsg}</p>
      {/* 연속성 에이전트 — 지난 방문 이후 달라진 점 + 새로 열린 복지 */}
      <ContinuityCard profile={profile} onOpen={setSelected} />
      {/* 헤더 요약 */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-cute p-6 sm:p-8 bg-gradient-to-br from-sprout-50 via-white to-sky2-50 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-sprout-200/40 blur-2xl" />
        <div className="relative">
          <span className="chip-sprout inline-flex">
            {primary.length === 0 ? '분석 결과' : <><PartyPopper className="h-3.5 w-3.5" /> 분석 완료</>}
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold leading-tight">
            {primary.length > 0 ? (
              <>
                {profile.name || '회원'}님이 받을 수 있는 복지는<br />
                <span className="gradient-text">{primary.length}개</span>예요! 🎉
              </>
            ) : (privateRel.length + related.length) > 0 ? (
              <>
                딱 맞는 핵심 정책은 못 찾았지만,<br />
                <span className="gradient-text">살펴볼 관련 복지 {privateRel.length + related.length}개</span>를 찾았어요
              </>
            ) : (
              <>
                {profile.name || '회원'}님 조건에 <span className="gradient-text">딱 맞는 정책</span>을 아직 못 찾았어요<br />
                <span className="text-lg sm:text-xl font-bold text-muted-foreground">조건을 조금 바꿔 다시 살펴볼까요?</span>
              </>
            )}
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">{result.profile_summary}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">‘중위소득’·‘소득인정액’ 같은 말이 어렵다면 <Glossary trigger="link" /></p>

          <div className="mt-5 grid grid-cols-3 gap-3 max-w-lg">
            <StatBox icon={<Heart className="h-4 w-4" />} value={`${primary.length}개`} label="맞춤 추천" />
            <StatBox icon={<TrendingUp className="h-4 w-4" />} value={monthly > 0 ? `월 ${formatWon(monthly)}` : '-'} label="핵심 현금지원" highlight />
            <StatBox icon={<Bell className="h-4 w-4" />} value={`${highCount}개`} label="강력 추천" />
          </div>
          {monthly > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground max-w-lg">
              ※ ‘핵심 현금지원’은 강력 추천 중 <b>현금으로 받는 지원</b>만 적게 잡아 더한 값이에요. 상품권·서비스·물품·회사 지원은 빼고, 중복으로 받을 수 없는 경우·실제 조건에 따라 받는 금액은 달라질 수 있어요.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={onReset} className="btn-secondary !py-2.5"><RotateCcw className="h-4 w-4" /> 다시 분석</button>
            <button onClick={() => setView('my')} className="btn-primary !py-2.5"><Heart className="h-4 w-4" /> 나의 복지에서 관리</button>
            <button onClick={() => window.print()} className="btn-secondary !py-2.5"><Printer className="h-4 w-4" /> 인쇄·저장</button>
            {tts.supported && (
              <button onClick={speakSummary} className="btn-secondary !py-2.5" aria-label={tts.speaking ? '읽기 중지' : '결과 읽어주기'}>
                {tts.speaking ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} {tts.speaking ? '중지' : '읽어주기'}
              </button>
            )}
            <ShareButton count={primary.length} monthlyText={monthly > 0 ? formatWon(monthly) : ''} />
          </div>
        </div>
      </motion.div>

      {/* 🌱 에이전트의 한마디 — 분석 결과를 1인칭으로 정리·우선순위 권고(AI Agent 목소리) */}
      {result.final_response && primary.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="mt-5 flex items-start gap-3 rounded-2xl border-2 border-sprout-200 bg-white p-4"
        >
          <span className="text-xl shrink-0">🌱</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-sprout-600 mb-0.5">에이전트가 정리했어요</p>
            <p className="text-sm leading-relaxed text-foreground/90">{result.final_response}</p>
          </div>
        </motion.div>
      )}

      {/* 알림 */}
      {result.notifications.length > 0 && (
        <div className="mt-5 space-y-2">
          {result.notifications.map((n, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * i }}
              className="flex items-start gap-3 rounded-2xl bg-sun-100 border border-sun-200 px-4 py-3">
              <Bell className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-yellow-900">{n.title}</p>
                <p className="text-xs text-yellow-800/90">{n.message}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* 복지 수혜 점수 — 행동 유도 (정밀 추천 기준) */}
      <WelfareScore eligible={primary} onOpen={setSelected} />

      {/* 포트폴리오 분석 (전문 시각화, 정밀 추천 기준) */}
      {primary.length > 0 && (
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BenefitBreakdown policies={primary} />
          <CategoryDistribution policies={primary} />
        </section>
      )}

      {/* 정책 목록 */}
      {eligible.length === 0 ? (
        /* 막다른 길 금지 — 0건이어도 반드시 '다음 행동'을 준다(기존 복지앱의 '멈춤' 불만 대응) */
        <div className="py-14 text-center">
          <p className="text-4xl mb-2">🤔</p>
          <p className="text-muted-foreground">
            현재 입력 기준으로는 딱 맞는 정책을 찾지 못했어요.<br />
            조건을 조금 바꾸거나, 아래에서 계속 찾아볼 수 있어요.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={onReset} className="btn-primary"><RotateCcw className="h-4 w-4" /> 조건 바꿔 다시 분석</button>
            <button onClick={() => setView('explore')} className="btn-secondary">정책 5,000여 건 직접 둘러보기</button>
            <a href="tel:129" className="btn-secondary">📞 129 무료 복지상담</a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground/70">
            갑작스러운 위기 상황(실직·질병 등)이라면 홈의 <b>긴급 도움</b>에서 빠른 진단을 받아보세요.
          </p>
        </div>
      ) : (
        <>
          <h2 className="mt-8 mb-3 text-lg font-extrabold">맞춤 추천 복지 <span className="text-sprout-500">{primary.length}</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {primary.map((p, i) => (
              <PolicyCard key={p.id} policy={p} index={i} onOpen={setSelected} />
            ))}
          </div>

          {/* 민간재단 지원 — 정부 데이터에 없는 사각지대(장학·의료비·위기지원). 심사·선발형임을 정직히 안내 */}
          {privateRel.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-1 text-lg font-extrabold">민간재단 지원 <span className="text-rose-500">{privateRel.length}</span> 💝</h2>
              <p className="text-xs text-muted-foreground mb-3">
                정부가 아닌 기업·재단의 장학금·의료비·위기지원이에요. <b>심사·선발로 뽑는 방식</b>이라 신청해도
                안 될 수 있지만, 정부 복지와 <b>별개로 함께</b> 받을 수 있는 경우가 많아요. 모집 시기를 놓치지 마세요.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {privateRel.map((p, i) => (
                  <PolicyCard key={p.id} policy={p} index={i} onOpen={setSelected} />
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div className="mt-6">
              <button onClick={() => setShowRelated((v) => !v)} className="btn-secondary w-full sm:w-auto">
                {showRelated ? '관련 복지 접기' : `관련 복지 더 보기 (${related.length}건)`}
              </button>
              <p className="text-xs text-muted-foreground mt-1.5">프로필과 관련된 공공 복지서비스예요. 자격은 각 정책 상세·문의처에서 확인하세요.</p>
              {showRelated && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {related.map((p, i) => (
                    <PolicyCard key={p.id} policy={p} index={i} onOpen={setSelected} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 🧩 수급 조합 도우미 — 같이 받을 것 vs 하나만 고를 것(경쟁 서비스에 없는 기능, 공식 출처 기반) */}
          <ComboCard eligible={eligible} />

          {/* 🎯 아깝게 놓친 복지 — 딱 한 조건만 벗어난 정책을 근거와 함께(에이전트의 판단 근거 노출) */}
          <NearMissCard profile={profile} onOpen={setSelected} />

          {/* 🧠 AI 의미 발견 — 자격 있는 복지와 의미가 가까운 숨은 복지를 온디바이스로 추가 발굴 */}
          <AiDiscovery eligible={primary.length ? primary : eligible} profile={profile} onOpen={setSelected} />
        </>
      )}

      {/* 선제적 생애 타임라인 — 앞으로 언제 무엇이 열리고 닫히는지 미리 챙김 */}
      <LifeTimeline profile={profile} onOpen={setSelected} />

      {/* 생애주기 시뮬레이터 — 만약 ~하면 시나리오별 미리보기 */}
      <FutureWelfare profile={profile} onOpen={setSelected} />

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
    </div>
  )
}

function StatBox({ icon, value, label, highlight }: { icon: React.ReactNode; value: string; label: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-3 text-center ${highlight ? 'bg-sprout-500 text-white' : 'bg-white border border-sprout-100'}`}>
      <div className={`flex items-center justify-center gap-1 ${highlight ? 'text-white/90' : 'text-sprout-500'}`}>{icon}</div>
      <p className={`text-base font-extrabold mt-0.5 ${highlight ? 'text-white' : 'text-foreground'}`}>{value}</p>
      <p className={`text-[11px] font-semibold ${highlight ? 'text-white/80' : 'text-muted-foreground'}`}>{label}</p>
    </div>
  )
}
