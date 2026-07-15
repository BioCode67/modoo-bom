import { motion } from 'framer-motion'
import { Heart, ChevronRight, Languages } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { categoryMeta, parseMonthly, formatWon, isCashBenefit, PRIORITY_META } from '@/lib/format'
import { deadlineHint } from '@/lib/deadline'
import { benefitTypeOf, BENEFIT_TYPE_META } from '@/lib/benefitType'
import { useAutoTranslate } from '@/lib/onDeviceTranslate'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

function isEligible(p: Policy | EligiblePolicy): p is EligiblePolicy {
  return 'priority' in p && 'reason' in p
}

export function PolicyCard({
  policy,
  onOpen,
  index = 0,
  translateTo,
}: {
  policy: Policy | EligiblePolicy
  onOpen: (p: Policy | EligiblePolicy) => void
  index?: number
  /** 다국어 AI 검색: 지정 시 표시 텍스트(이름·대상·혜택·분류)를 온디바이스로 그 언어로 번역.
   *  미지정/'ko'/미지원 브라우저면 한국어 원문 그대로. 금액·자격 등 로직은 항상 한국어 원문 기준. */
  translateTo?: string
}) {
  const { isSaved, toggleSaved } = useAppStore()
  const saved = isSaved(policy.id)
  const meta = categoryMeta(policy.category)
  // 현금성 혜택일 때만 '월 N까지' 배지 — 감면·할인·바우처(예: 다자녀 전기요금 감면)를 현금처럼 오표기하지 않게.
  const monthly = isCashBenefit(policy.benefit) ? parseMonthly(policy.benefit) : 0
  const eligible = isEligible(policy)
  // 지자체(LOC) 정책은 target 앞 "[시도 시군구]"에서 지역 배지 추출(시군구 우선)
  const rm = policy.id.startsWith('LOC-') ? policy.target.match(/^\[([^\]]+)\]/) : null
  const region = rm ? (rm[1].split(/\s+/).pop() || rm[1]) : ''
  const targetText = rm ? policy.target.replace(/^\[[^\]]+\]\s*/, '') : policy.target
  const deadline = deadlineHint(policy) // 신청 기한 힌트(있으면 ⏰ 배지)
  const btype = benefitTypeOf(policy) // 지원형태(현금·바우처·감면·서비스·대출)

  // 다국어 AI 검색 — 표시 텍스트만 질의 언어로 온디바이스 번역(원문 한국어는 상세·저장·금액계산에 그대로 유지).
  // 혜택 미리보기는 '월 N까지' 금액 배지가 없을 때(monthly===0)만 노출되므로 그때만 번역한다.
  const benefitPreview = policy.benefit.slice(0, 60)
  const tr = useAutoTranslate(
    { name: policy.name, target: targetText, category: policy.category, benefit: monthly > 0 ? undefined : benefitPreview },
    translateTo,
  )
  const dName = tr?.name ?? policy.name
  const dCategory = tr?.category ?? policy.category
  const dTarget = tr?.target ?? targetText
  const dBenefit = tr?.benefit ?? benefitPreview

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      className="card-cute card-hover p-5 flex flex-col h-full cursor-pointer group"
      // 마우스는 카드 아무 곳이나 클릭. 키보드·스크린리더는 아래 '자세히' 버튼으로 상세 진입.
      // (카드 자체를 role=button으로 두면 내부 버튼(하트)과 '중첩 인터랙티브' 접근성 위반 → 분리)
      onClick={() => onOpen(policy)}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl', meta.cls)}>
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-muted-foreground">{dCategory}</span>
            {tr && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-700 bg-violet-50 rounded-full px-1.5 py-0.5"
                title="브라우저 안에서 자동 번역됨 · 원문(신청 기준)은 한국어예요">
                <Languages className="h-2.5 w-2.5" /> 자동 번역
              </span>
            )}
            {region && <span className="text-[10px] font-semibold text-sky2-700 bg-sky2-50 rounded-full px-1.5 py-0.5">📍 {region}</span>}
            {btype && <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 rounded-full px-1.5 py-0.5">{BENEFIT_TYPE_META[btype].emoji} {BENEFIT_TYPE_META[btype].label}</span>}
            {deadline && (
              <span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-0.5', deadline.urgent ? 'text-rose-700 bg-rose-50' : 'text-amber-700 bg-amber-50')}>
                ⏰ {deadline.label}
              </span>
            )}
            {eligible && (
              <span className={cn('chip text-[10px] !px-2 !py-0.5 border', PRIORITY_META[policy.priority].cls)}>
                {PRIORITY_META[policy.priority].emoji} {PRIORITY_META[policy.priority].label}
              </span>
            )}
          </div>
          {/* 카드 제목은 heading이 아닌 일반 텍스트 — 5천여 카드 그리드에서 heading 남발/레벨 스킵 방지.
              스크린리더는 카드의 '자세히' 버튼(aria-label=정책명 상세 보기)으로 정책명을 안내받는다. */}
          <p className="font-bold text-[15px] leading-snug mt-0.5 truncate">{dName}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
          }}
          aria-label={saved ? '관심목록에서 제거' : '관심목록에 추가'}
          className={cn(
            'shrink-0 rounded-full p-2 transition-all active:scale-90',
            saved ? 'bg-peach-100 text-peach-500' : 'bg-muted text-muted-foreground hover:bg-peach-50 hover:text-peach-400',
          )}
        >
          <Heart className={cn('h-4 w-4', saved && 'fill-current')} />
        </button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{dTarget}</p>

      {eligible && (policy as EligiblePolicy).reason && (
        <div className="mt-2 rounded-xl bg-sprout-50 px-3 py-2 text-xs text-sprout-800 line-clamp-2">
          ✓ {(policy as EligiblePolicy).reason}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between">
        {monthly > 0 ? (
          <span className="text-sm font-extrabold text-sprout-700">
            월 {formatWon(monthly)}<span className="text-[11px] font-medium text-muted-foreground"> 까지</span>
          </span>
        ) : (
          <span className="text-xs font-semibold text-muted-foreground line-clamp-1">{tr ? dBenefit : `${policy.benefit.slice(0, 18)}…`}</span>
        )}
        {/* 키보드·스크린리더용 상세 열기 버튼(카드 role=button 대신). 대비 통과 위해 sprout-700 */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(policy) }}
          aria-label={`${dName} 상세 보기`}
          className="inline-flex items-center gap-0.5 rounded text-xs font-semibold text-sprout-700 transition-all group-hover:gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sprout-500"
        >
          자세히 <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
