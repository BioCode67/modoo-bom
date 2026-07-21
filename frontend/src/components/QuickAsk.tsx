import { useState } from 'react'
import { Sparkles, Mic, MicOff } from 'lucide-react'
import { parseProfileFromText } from '@/lib/parseQuery'
import { useSpeech } from '@/lib/useSpeech'
import { detectLang } from '@/lib/detectLang'
import { useAppStore } from '@/store/useAppStore'
import type { UserProfile } from '@/lib/welfare-engine'
import { cn } from '@/lib/utils'

/**
 * 자연어 한 문장 → 즉시 분석. 위저드 없이도 상황을 말/글로 적으면 맞춤 복지를 찾아준다.
 * 음성 입력(useSpeech) 지원 — 어르신·저자력층 접근성. 파싱은 LLM 없이 클라이언트(parseQuery).
 */
const EXAMPLES = [
  '72세 혼자 사는데 소득이 적어요',
  '서울 사는 한부모, 5살 아이 키워요',
  '독립하려는 청년, 살 집 구해요',
  '퇴사하고 일자리 찾는 청년이에요',
  '임신 중이고 첫 아이예요',
]

export function QuickAsk({ onSubmit }: { onSubmit: (p: UserProfile) => void }) {
  const [text, setText] = useState('')
  const speech = useSpeech((t) => setText((prev) => (prev ? prev + ' ' : '') + t))
  // 마이크 오류(권한 거부·무음 등)를 조용히 삼키지 않고 안내 — 데모 중 흔한 실패 모드
  const setView = useAppStore((s) => s.setView)
  const setAiIntent = useAppStore((s) => s.setAiIntent)
  const setAiQuery = useAppStore((s) => s.setAiQuery)
  const go = () => {
    const t = text.trim()
    if (!t) return
    const lang = detectLang(t)
    if (lang && lang.code !== 'ko') {
      // 외국어 입력 → 다국어 AI 의미 검색으로 라우팅(한국어 규칙 파싱 대신)
      setAiQuery(t)
      setAiIntent(true)
      setView('explore')
      return
    }
    // 나이 추정(청년→27 등) 시 정확한 나이를 되묻는 '토스식 확인'은 호출부(Analyze.handleSubmit)에서
    //   일괄 처리한다 — 홈 히어로·대화·한 문장 모든 진입을 한 곳에서 게이트(중복 방지).
    onSubmit(parseProfileFromText(t))
  }

  return (
    <div className="card-cute p-5 mb-5">
      <p className="font-bold flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-sprout-500" /> 한 문장으로 물어보세요</p>
      <p className="text-xs text-muted-foreground mt-0.5">상황을 자연스럽게 적으면(또는 말하면) 바로 맞춤 복지를 찾아드려요. <span className="text-sprout-700 font-medium">🌍 외국어로 적으면 AI가 찾아드려요.</span></p>

      <div className="mt-3 relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go() }}
          rows={2}
          placeholder="예: 72세 혼자 사는데 소득이 적어요"
          className="input-cute w-full resize-none pr-12"
          aria-label="상황을 한 문장으로 입력"
        />
        {speech.supported && (
          <button
            onClick={speech.toggle}
            aria-label={speech.listening ? '음성 입력 중지' : '음성으로 말하기'}
            className={cn('absolute right-2 top-2 rounded-full p-2 transition-colors',
              speech.listening ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-sprout-100 text-sprout-700 hover:bg-sprout-200')}
          >
            {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
      </div>

      {speech.error && (
        <p role="alert" className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">🎤 {speech.error}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setText(ex)}
            className="text-xs rounded-full border border-sprout-100 px-2.5 py-1 text-muted-foreground hover:border-sprout-300 hover:text-foreground transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      <button onClick={go} disabled={!text.trim()} className="btn-primary w-full justify-center mt-3 disabled:!bg-muted disabled:!text-muted-foreground disabled:!shadow-none disabled:cursor-not-allowed">
        <Sparkles className="h-4 w-4" /> 이 내용으로 바로 분석
      </button>
    </div>
  )
}
