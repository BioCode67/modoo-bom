import { useState } from 'react'
import { Sparkles } from 'lucide-react'

/**
 * 🎂 토스식 나이 확인 — 대화형 진입(홈 한 문장·QuickAsk)에서 나이를 '청년→27'로 퉁치지 않고,
 * 정확한 나이를 한 화면에 '하나만' 크게 물어본다(사용자 요청: "토스처럼 입력받자").
 *
 * · 나이를 문장에 '명시'한 경우엔 이 단계를 건너뛴다(호출부가 _ageExplicit로 게이트).
 * · 추정값을 미리 채워 보여주고(퉁침 대신 투명 확인) 자동 포커스+전체 선택 → 그대로 두거나 바로 타이핑.
 * · 복지는 나이 기준이 촘촘해(청년 34/39·기초연금 65 등) 1~2살 차이로 자격이 갈리므로, 추정 분석의 오탐을 없앤다.
 * · '나이 없이 대략 분석' 폴백을 남겨 강제하지 않는다(어르신·저자력층 배려).
 */
export function AgeAskStep({ initialAge, onConfirm, onSkip, onBack }: {
  initialAge: number
  onConfirm: (age: number) => void
  onSkip: () => void
  onBack: () => void
}) {
  const [ageInput, setAgeInput] = useState(String(initialAge))
  const n = parseInt(ageInput, 10)
  const valid = !Number.isNaN(n) && n >= 0 && n <= 120

  return (
    <div className="page-container py-10 sm:py-16">
      <div className="mx-auto max-w-md card-cute p-6" role="group" aria-label="나이 확인">
        <p className="font-extrabold text-lg flex items-center gap-1.5">
          <Sparkles className="h-5 w-5 text-sprout-500" /> 나이를 알려주세요 🌱
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          복지는 나이 기준이 촘촘해요. <span className="text-sprout-700 font-semibold">정확한 나이</span>로 딱 맞는 혜택만 골라드릴게요.
        </p>
        <div className="mt-6 flex items-end justify-center gap-2">
          <input
            type="number" inputMode="numeric" autoFocus min={0} max={120}
            value={ageInput}
            onChange={(e) => setAgeInput(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid) onConfirm(n) }}
            aria-label="나이(만 나이) 입력"
            className="input-cute w-32 text-center text-5xl font-extrabold tabular-nums"
          />
          <span className="pb-3 text-2xl font-bold text-muted-foreground">세</span>
        </div>
        <button
          onClick={() => { if (valid) onConfirm(n) }} disabled={!valid}
          className="btn-primary w-full justify-center mt-6 disabled:!bg-muted disabled:!text-muted-foreground disabled:!shadow-none disabled:cursor-not-allowed"
        >
          <Sparkles className="h-4 w-4" /> 이 나이로 분석하기
        </button>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={onBack} className="text-xs text-muted-foreground hover:underline">← 다시 입력</button>
          <button onClick={onSkip} className="text-xs text-muted-foreground hover:underline">나이 없이 대략 분석</button>
        </div>
      </div>
    </div>
  )
}
