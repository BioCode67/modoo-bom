import { Check, FileText, ShieldCheck, Send, Sparkles, Bot } from 'lucide-react'
import { t as tr } from '@/lib/i18nLite'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

/**
 * 신청 자동화 흐름 스테퍼 — "무엇이 자동이고 무엇이 본인 몫인지" 한눈에.
 * 완전 자동화의 정답은 human-in-the-loop: 정보 작성·서류 준비는 자동, 본인인증·최종제출만 본인.
 * (정부 신청은 본인인증이 법적 필수, 최종제출은 비가역이라 본인 확인이 안전)
 */

type By = 'auto' | 'guide' | 'you'
const BADGE_STYLE: Record<By, { chip: string; dot: string }> = {
  auto: { chip: 'bg-sprout-50 text-sprout-600', dot: 'bg-sprout-500 text-white' },
  guide: { chip: 'bg-sky2-50 text-sky2-700', dot: 'bg-sky2-500 text-white' },
  you: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-100 text-amber-700 ring-2 ring-amber-200' },
}

export function ApplyFlow({ automatable, hasBackend, hasPrefill = false, matched = false }: { automatable: boolean; hasBackend: boolean; hasPrefill?: boolean; matched?: boolean }) {
  const uiLang = useAppStore((s) => s.uiLang)
  const badgeLabel: Record<By, string> = { auto: tr(uiLang, 'byAuto'), guide: tr(uiLang, 'byGuide'), you: tr(uiLang, 'byYou') }
  const docAuto = hasBackend && automatable
  // 라벨은 자국어(스캔 가능), 상세 설명은 한국어 유지(정책 본문과 함께 통역 배너로 안내)
  // 1단계: 이 정책이 실제 '내 분석 결과'에서 온 경우에만 '자동 선별 완료'(체크)로 표기 — 과장 금지 철칙.
  //   탐색 목록에서 직접 고른 정책은 어떤 조건 매칭도 없었으므로 '직접 고른 복지'로 정직히 안내한다.
  const recommendStep = matched
    ? { icon: <Sparkles className="h-4 w-4" />, label: tr(uiLang, 'stepRecommend'), desc: '내 조건에 맞는 복지를 자동 선별했어요', by: 'auto' as By }
    : { icon: <Sparkles className="h-4 w-4" />, label: tr(uiLang, 'stepPick'), desc: '탐색에서 직접 고른 복지예요. 프로필 분석을 하면 내 조건에 맞는지 확인해드려요', by: 'guide' as By }
  const steps: { icon: React.ReactNode; label: string; desc: string; by: By }[] = [
    recommendStep,
    hasPrefill
      ? { icon: <FileText className="h-4 w-4" />, label: tr(uiLang, 'stepInfo'), desc: '입력한 정보를 신청서에 붙여넣을 수 있게 준비했어요', by: 'auto' as By }
      : { icon: <FileText className="h-4 w-4" />, label: tr(uiLang, 'stepInfo'), desc: '아래에 이름·생년월일·연락처를 입력하면 붙여넣기용으로 준비해드려요', by: 'guide' as By },
    {
      icon: docAuto ? <Bot className="h-4 w-4" /> : <FileText className="h-4 w-4" />,
      label: tr(uiLang, 'stepDocs'),
      desc: docAuto ? '에이전트가 등본 등을 자동 발급해요' : '필요 서류 발급처로 바로 이동해요(아래 링크)',
      by: docAuto ? 'auto' : 'guide',
    },
    { icon: <ShieldCheck className="h-4 w-4" />, label: tr(uiLang, 'stepAuth'), desc: '카카오 등 본인인증 — 법적으로 본인이 직접', by: 'you' },
    { icon: <Send className="h-4 w-4" />, label: tr(uiLang, 'stepSubmit'), desc: '내용을 확인하고 직접 제출하면 끝!', by: 'you' },
  ]

  return (
    <div className="rounded-2xl border border-sprout-100 bg-white p-3.5">
      <p className="text-xs font-bold text-muted-foreground mb-2.5">{tr(uiLang, 'flowTitle')}</p>
      <ol className="relative space-y-0">
        {steps.map((s, i) => {
          const b = BADGE_STYLE[s.by]
          return (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {/* 연결선 */}
              {i < steps.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-sprout-100" aria-hidden />}
              <span className={cn('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', b.dot)}>
                {s.by === 'auto' ? <Check className="h-4 w-4" /> : s.icon}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-bold flex items-center gap-1.5">
                  {s.label}
                  <span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-px', b.chip)}>{badgeLabel[s.by]}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-1 text-[11px] text-muted-foreground/80 leading-relaxed">
        ℹ️ 본인인증·최종제출만 본인이 하시면 돼요. 이건 안전을 위한 정부 절차예요(우회 불가).
      </p>
    </div>
  )
}
