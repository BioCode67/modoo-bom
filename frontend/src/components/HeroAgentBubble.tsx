import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Heart } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { useCatalog } from '@/data/useCatalog'
import { buildActionFeed } from '@/lib/monitoring'
import { formatWon, sumCashMonthly } from '@/lib/format'

/**
 * 새싹이(에이전트)가 먼저 말을 거는 말풍선 — 마스코트를 '살아있는 에이전트'로 만든다.
 * - 처음 온 사용자: 인사 + **실제 엔진이 방금 계산한 페르소나 결과 티저**를 순환
 *   (클라이언트 복지엔진 실계산 — 하드코딩 숫자 아님. 결과 화면의 '핵심 현금지원'과 동일 공식이라 어긋나지 않는다)
 * - 다시 온 사용자: **실제 저장 데이터**로 브리핑(담아둔 복지·지금 챙길 일 개수 — 날조 없음)
 * 재방문 브리핑은 '에이전트가 나를 기억하고 먼저 챙긴다'는 느낌의 핵심 장치.
 */
const GREETINGS = [
  '안녕하세요! 저 새싹이예요 🌱 어떤 상황이신지 편하게 한마디만 들려주세요.',
  '복잡한 서류 채우기는 없어요. 말하듯 알려주시면 딱 맞는 복지를 제가 찾아드릴게요.',
]

// 첫 화면 티저용 페르소나 — 히어로 예시 칩과 같은 문장(누르면 그대로 재현 가능해 정직)
const TEASER_PERSONAS = [
  { label: '72세 혼자, 소득 적음', text: '72세 혼자 사는데 소득이 적어요' },
  { label: '서울 한부모, 5살 아이', text: '서울 사는 한부모, 5살 아이 키워요' },
  { label: '일자리 찾는 청년', text: '퇴사하고 일자리 찾는 청년이에요' },
]

interface Teaser { label: string; count: number; monthly: number; text: string }

export function HeroAgentBubble({ onFocusInput }: { onFocusInput?: () => void }) {
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const setView = useAppStore((s) => s.setView)
  const setPendingProfile = useAppStore((s) => s.setPendingProfile)
  const [gi, setGi] = useState(0)

  // 지금 챙길 일(마감 임박·서류 미비·신청 권유 등)이 있는 저장 항목 수 — 실측
  const actionCount = useMemo(() => {
    if (!tracked.length) return 0
    try { return buildActionFeed(tracked, getPolicyMap()).length } catch { return 0 }
  }, [tracked])

  const primaryCount = useMemo(
    () => (result?.eligible_policies?.filter((p) => /^POL-/.test(p.id)).length ?? 0),
    [result],
  )

  // 재방문 여부 = 저장된 관심목록/이전 분석 결과가 있음
  const returning = tracked.length > 0 || !!result
  const name = profile?.name?.trim()

  // ⭐ 첫 화면 임팩트 — 실제 엔진으로 페르소나 3종을 '방금' 계산해 티저로 순환.
  //   첫 페인트를 막지 않도록 idle에 계산하고, 카탈로그(공공데이터) 병합 시 재계산해 숫자가 실데이터를 따라간다.
  const catalogCount = useCatalog().length
  const [teasers, setTeasers] = useState<Teaser[]>([])
  useEffect(() => {
    if (returning) return
    let alive = true
    const compute = async () => {
      try {
        const [{ runAnalysis }, { parseProfileFromText }] = await Promise.all([
          import('@/lib/welfare-engine'),
          import('@/lib/parseQuery'),
        ])
        const out: Teaser[] = []
        for (const t of TEASER_PERSONAS) {
          const r = runAnalysis(parseProfileFromText(t.text))
          const primary = r.eligible_policies.filter((p) => /^POL-/.test(p.id))
          // 결과 화면 헤드라인과 '동일 공식'(강력추천 중 현금성만 보수 합산) — 첫 화면이 결과보다 부풀지 않게
          const monthly = sumCashMonthly(primary.filter((p) => p.priority === 'high'))
          out.push({ label: t.label, count: primary.length, monthly, text: t.text })
        }
        if (alive) setTeasers(out)
      } catch { /* 엔진 오류 시 인사말만 순환(무해) */ }
    }
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const id = idle ? idle(compute) : window.setTimeout(compute, 250)
    return () => {
      alive = false
      if (!idle) window.clearTimeout(id as number)
    }
  }, [returning, catalogCount])

  // 인사 ↔ 실계산 티저 인터리브 순환(에이전트가 지금 일하고 있는 느낌).
  // 티저가 표시 중일 땐 CTA가 '이 결과 바로 보기'로 바뀌어 한 번에 그 페르소나 분석을 실행 —
  // 첫 화면 숫자가 결과 화면으로 그대로 이어짐(원클릭 라이브 데모 = 정직성 증명).
  const rotation: { node: React.ReactNode; teaser?: Teaser }[] = useMemo(() => {
    const nodes: { node: React.ReactNode; teaser?: Teaser }[] = GREETINGS.map((g) => ({ node: g }))
    teasers.forEach((t, i) => {
      nodes.splice(1 + i * 2, 0, {
        teaser: t,
        node: (
          <>
            방금 계산해 봤어요 — <b>{t.label}</b>이면 지금 <b>{t.count}개</b>
            {t.monthly > 0 && <>, 현금 지원 <b className="text-sprout-700">월 {formatWon(t.monthly)}</b>까지</>} 나와요.
          </>
        ),
      })
    })
    return nodes
  }, [teasers])

  // 신규 사용자 인사는 부드럽게 순환(에이전트가 살아있는 느낌).
  // ⚠️ 화면낭독기·모션 최소화 사용자에겐 순환을 멈춘다 — 회전 때마다 aria-live가 재낭독돼 첫 화면에서
  //   끝없이 방해하던 문제(WCAG 2.2.2)와 JS 모션이 prefers-reduced-motion을 무시하던 문제를 함께 차단(감사 A1)
  useEffect(() => {
    if (returning) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setGi((v) => (v + 1) % Math.max(1, rotation.length)), 4200)
    return () => clearInterval(t)
  }, [returning, rotation.length])

  let body: React.ReactNode
  let cta: { label: string; onClick: () => void } | null = null

  if (returning) {
    const hi = name ? `${name}님, 다시 오셨네요! ` : '다시 오셨네요! '
    if (actionCount > 0) {
      body = <>{hi}담아두신 복지 중 <b>{actionCount}개</b>는 지금 챙길 일이 있어요. 제가 정리해 뒀어요.</>
      cta = { label: '나의 복지에서 확인', onClick: () => setView('my') }
    } else if (tracked.length > 0) {
      body = <>{hi}담아두신 복지 <b>{tracked.length}개</b>를 이어서 챙겨드릴까요?</>
      cta = { label: '나의 복지 열기', onClick: () => setView('my') }
    } else {
      body = <>{hi}지난번에 받을 수 있는 복지 <b>{primaryCount}개</b>를 찾아드렸어요. 이어서 보실래요?</>
      cta = { label: '지난 결과 보기', onClick: () => setView('analyze') }
    }
  } else {
    const cur = rotation[gi % Math.max(1, rotation.length)]
    body = cur?.node
    const t = cur?.teaser
    if (t) {
      cta = {
        label: '이 결과 바로 보기',
        onClick: () => {
          // 티저와 동일 문장으로 즉시 분석 — 첫 화면 숫자가 결과 화면과 1:1로 이어진다
          import('@/lib/parseQuery').then(({ parseProfileFromText }) => {
            setPendingProfile(parseProfileFromText(t.text))
            setView('analyze')
          }).catch(() => setView('analyze'))
        },
      }
    } else {
      cta = onFocusInput ? { label: '한마디로 시작하기', onClick: onFocusInput } : null
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="relative z-10 max-w-sm mx-auto"
      // 회전하는 신규 인사엔 live 영역을 두지 않는다(4.2초마다 재낭독 방지) — 한 번만 뜨는 복귀 브리핑만 안내(감사 A1)
      role={returning ? 'status' : undefined}
      aria-live={returning ? 'polite' : undefined}
    >
      <div className="flex items-start gap-2.5 rounded-3xl rounded-bl-md border-2 border-sprout-200 bg-white/95 backdrop-blur px-4 py-3 shadow-soft">
        <span className="shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-sprout-100">
          <SproutLogo withFace className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold text-sprout-700">새싹이 · 복지 에이전트</p>
          {/* min-h 3줄 확보 — 인사말이 4.2초 주기로 바뀔 때 2↔3줄 변동으로 아래 3D 캔버스가 밀리는 것 방지 */}
          <div className="mt-0.5 min-h-[4.25rem] text-sm font-medium text-foreground leading-relaxed">
            <AnimatePresence mode="wait">
              <motion.p
                key={returning ? 'ret' : gi}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3 }}
              >
                {body}
              </motion.p>
            </AnimatePresence>
          </div>
          {cta && (
            <button
              onClick={cta.onClick}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-sprout-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-sprout-800 transition-colors"
            >
              {returning ? <Heart className="h-3.5 w-3.5" /> : null}
              {cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* 말풍선 꼬리 — 마스코트 쪽을 향함 */}
      <div className="mx-auto h-3 w-3 -mt-1.5 rotate-45 border-b-2 border-r-2 border-sprout-200 bg-white/95" />
    </motion.div>
  )
}
