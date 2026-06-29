import { useState } from 'react'
import { Share2, ImageDown, Check } from 'lucide-react'
import { shareApp, makeCard, shareOrDownloadCard } from '@/lib/share'

/** 결과 공유 — 이웃에게 복지 알리기(텍스트) + 이미지 카드. 개인정보 미포함. */
export function ShareButton({ count, monthlyText }: { count: number; monthlyText: string }) {
  const [msg, setMsg] = useState('')
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 2000) }

  const onShare = async () => {
    const r = await shareApp(count)
    if (r === 'copied') flash('링크 복사됨')
    else if (r === 'shared') flash('공유했어요')
  }
  const onCard = async () => {
    const blob = await makeCard(count, monthlyText)
    if (!blob) { flash('이미지 생성 실패'); return }
    const r = await shareOrDownloadCard(blob)
    flash(r === 'downloaded' ? '이미지 저장됨' : '공유했어요')
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={onShare} className="btn-secondary !py-2.5" aria-label="이웃에게 공유">
        {msg ? <Check className="h-4 w-4 text-sprout-500" /> : <Share2 className="h-4 w-4" />} {msg || '공유'}
      </button>
      <button onClick={onCard} className="btn-secondary !py-2.5" aria-label="이미지 카드 저장">
        <ImageDown className="h-4 w-4" /> 이미지
      </button>
    </div>
  )
}
