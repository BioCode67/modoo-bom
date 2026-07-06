import { useState } from 'react'
import { Share2, ImageDown, Check } from 'lucide-react'
import { shareApp, makeCard, shareOrDownloadCard } from '@/lib/share'

/** 결과 공유 — 이웃에게 복지 알리기(텍스트) + 이미지 카드. 개인정보 미포함. */
export function ShareButton({ count, monthlyText }: { count: number; monthlyText: string }) {
  // 어느 버튼의 피드백인지 함께 추적 — 예전엔 공유 버튼에만 표시돼 '이미지 저장됨'이 엉뚱한 버튼에 떴다.
  const [flash, setFlash] = useState<{ which: 'share' | 'card'; text: string } | null>(null)
  const show = (which: 'share' | 'card', text: string) => { setFlash({ which, text }); setTimeout(() => setFlash(null), 2000) }

  const onShare = async () => {
    const r = await shareApp(count)
    if (r === 'copied') show('share', '링크 복사됨')
    else if (r === 'shared') show('share', '공유했어요')
  }
  const onCard = async () => {
    const blob = await makeCard(count, monthlyText)
    if (!blob) { show('card', '이미지 생성 실패'); return }
    const r = await shareOrDownloadCard(blob)
    show('card', r === 'downloaded' ? '이미지 저장됨' : '공유했어요')
  }

  const shareMsg = flash?.which === 'share' ? flash.text : ''
  const cardMsg = flash?.which === 'card' ? flash.text : ''
  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={onShare} className="btn-secondary !py-2.5" aria-label="이웃에게 공유">
        {shareMsg ? <Check className="h-4 w-4 text-success-500" /> : <Share2 className="h-4 w-4" />} {shareMsg || '공유'}
      </button>
      <button onClick={onCard} className="btn-secondary !py-2.5" aria-label="이미지 카드 저장">
        {cardMsg ? <Check className="h-4 w-4 text-success-500" /> : <ImageDown className="h-4 w-4" />} {cardMsg || '이미지'}
      </button>
      {/* 스크린리더에 성공/실패 안내(시각 피드백만으론 안 읽힘) */}
      <span role="status" aria-live="polite" className="sr-only">{flash?.text || ''}</span>
    </div>
  )
}
