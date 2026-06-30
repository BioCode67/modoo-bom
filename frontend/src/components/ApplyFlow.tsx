import { Check, FileText, ShieldCheck, Send, Sparkles, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 신청 자동화 흐름 스테퍼 — "무엇이 자동이고 무엇이 본인 몫인지" 한눈에.
 * 완전 자동화의 정답은 human-in-the-loop: 정보 작성·서류 준비는 자동, 본인인증·최종제출만 본인.
 * (정부 신청은 본인인증이 법적 필수, 최종제출은 비가역이라 본인 확인이 안전)
 */

type By = 'auto' | 'guide' | 'you'
const BADGE: Record<By, { label: string; chip: string; dot: string }> = {
  auto: { label: '자동', chip: 'bg-sprout-50 text-sprout-600', dot: 'bg-sprout-500 text-white' },
  guide: { label: '안내', chip: 'bg-sky2-50 text-sky2-700', dot: 'bg-sky2-500 text-white' },
  you: { label: '본인', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-100 text-amber-700 ring-2 ring-amber-200' },
}

export function ApplyFlow({ automatable, hasBackend }: { automatable: boolean; hasBackend: boolean }) {
  const docAuto = hasBackend && automatable
  const steps: { icon: React.ReactNode; label: string; desc: string; by: By }[] = [
    { icon: <Sparkles className="h-4 w-4" />, label: '맞춤 추천 완료', desc: '내 조건에 맞는 복지를 자동 선별했어요', by: 'auto' },
    { icon: <FileText className="h-4 w-4" />, label: '신청서 정보 자동 작성', desc: '이름·생년월일·연락처를 미리 채워뒀어요', by: 'auto' },
    {
      icon: docAuto ? <Bot className="h-4 w-4" /> : <FileText className="h-4 w-4" />,
      label: '서류 준비',
      desc: docAuto ? '에이전트가 등본 등을 자동 발급해요' : '필요 서류 발급처로 바로 이동해요(아래 링크)',
      by: docAuto ? 'auto' : 'guide',
    },
    { icon: <ShieldCheck className="h-4 w-4" />, label: '간편인증 (본인)', desc: '카카오 등 본인인증 — 법적으로 본인이 직접', by: 'you' },
    { icon: <Send className="h-4 w-4" />, label: '최종 제출 (본인)', desc: '내용을 확인하고 직접 제출하면 끝!', by: 'you' },
  ]

  return (
    <div className="rounded-2xl border border-sprout-100 bg-white p-3.5">
      <p className="text-xs font-bold text-muted-foreground mb-2.5">신청은 이렇게 진행돼요</p>
      <ol className="relative space-y-0">
        {steps.map((s, i) => {
          const b = BADGE[s.by]
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
                  <span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-px', b.chip)}>{b.label}</span>
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
