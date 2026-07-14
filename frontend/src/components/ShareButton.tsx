import { useState } from 'react'
import { Share2, ImageDown, Check, ClipboardList } from 'lucide-react'
import { shareApp, makeCard, shareOrDownloadCard, buildResultText } from '@/lib/share'

/** 결과 공유 — 이웃에게 복지 알리기(텍스트) + 이미지 카드 + 카톡용 요약 글 복사. 개인정보 미포함. */
export function ShareButton({ count, monthlyText, policies = [] }: {
  count: number
  monthlyText: string
  /** '글로 복사'용 상위 정책 목록(핵심 POL-) — 없으면 글 복사 버튼 숨김 */
  policies?: { name: string; benefit: string; category: string; priority?: string }[]
}) {
  // 어느 버튼의 피드백인지 함께 추적 — 예전엔 공유 버튼에만 표시돼 '이미지 저장됨'이 엉뚱한 버튼에 떴다.
  const [flash, setFlash] = useState<{ which: 'share' | 'card' | 'text'; text: string } | null>(null)
  const show = (which: 'share' | 'card' | 'text', text: string) => { setFlash({ which, text }); setTimeout(() => setFlash(null), 2000) }

  const onShare = async () => {
    const r = await shareApp(count)
    if (r === 'copied') show('share', '링크 복사됨')
    else if (r === 'shared') show('share', '공유했어요')
  }
  const onCard = async () => {
    const blob = await makeCard(count, monthlyText)
    if (!blob) { show('card', '이미지 생성 실패'); return }
    const r = await shareOrDownloadCard(blob)
    if (r === 'cancelled') return // 사용자가 공유를 취소 — 피드백 없음(강제 다운로드·오표시 금지)
    show('card', r === 'downloaded' ? '이미지 저장됨' : '공유했어요')
  }

  // 카톡용 요약 글 복사 — 어르신이 자녀에게 '이거 좀 봐줘'로 보내는 가장 흔한 경로(붙여넣기 한 번)
  const onText = async () => {
    try {
      await navigator.clipboard.writeText(buildResultText(policies, monthlyText))
      show('text', '글 복사됨 — 카톡에 붙여넣으세요')
    } catch {
      show('text', '복사 실패')
    }
  }

  const shareMsg = flash?.which === 'share' ? flash.text : ''
  const cardMsg = flash?.which === 'card' ? flash.text : ''
  const textMsg = flash?.which === 'text' ? flash.text : ''
  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button onClick={onShare} className="btn-secondary !py-2.5" aria-label="이웃에게 공유">
        {shareMsg ? <Check className="h-4 w-4 text-success-500" /> : <Share2 className="h-4 w-4" />} {shareMsg || '공유'}
      </button>
      <button onClick={onCard} className="btn-secondary !py-2.5" aria-label="이미지 카드 저장">
        {cardMsg ? <Check className="h-4 w-4 text-success-500" /> : <ImageDown className="h-4 w-4" />} {cardMsg || '이미지'}
      </button>
      {policies.length > 0 && (
        <button onClick={onText} className="btn-secondary !py-2.5" aria-label="카톡용 요약 글 복사">
          {textMsg ? <Check className="h-4 w-4 text-success-500" /> : <ClipboardList className="h-4 w-4" />} {textMsg || '글로 복사'}
        </button>
      )}
      {/* 스크린리더에 성공/실패 안내(시각 피드백만으론 안 읽힘) */}
      <span role="status" aria-live="polite" className="sr-only">{flash?.text || ''}</span>
    </div>
  )
}
