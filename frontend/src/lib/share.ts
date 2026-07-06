const APP_URL = 'https://biocode67.github.io/modoo-bom/'

/** 텍스트/URL 공유 — Web Share 우선, 미지원 시 클립보드 복사. (개인정보 미포함) */
export async function shareApp(count?: number): Promise<'shared' | 'copied' | 'failed'> {
  const text = count && count > 0
    ? `모두봄에서 제가 받을 수 있는 복지를 ${count}개나 찾았어요! 🌱 회원가입 없이 1분이면 확인돼요. 가족·이웃과 함께 챙기세요.`
    : '숨어있는 내 복지 혜택, 모두봄에서 1분이면 찾을 수 있어요! 🌱 회원가입 없이 무료.'
  const data = { title: '모두봄 — 내 복지 찾기', text, url: APP_URL }
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share(data)
      return 'shared'
    }
  } catch (e) {
    // 사용자 취소(AbortError)면 조용히 종료. 그 외 실제 공유 오류는 아래 클립보드 폴백으로 흘려보낸다.
    if (e instanceof Error && e.name === 'AbortError') return 'failed'
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${APP_URL}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** 공유용 이미지 카드(PNG) 생성 — 캔버스. 개인정보 없이 N개/월 합계만. */
export async function makeCard(count: number, monthlyText: string): Promise<Blob | null> {
  const W = 1200, H = 630
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null

  // 배경 그라데이션 (크림→연그린)
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#fffaf3'); g.addColorStop(1, '#dcfce7')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // 장식 원
  ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.beginPath(); ctx.arc(W - 120, 120, 180, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(249,115,22,0.10)'; ctx.beginPath(); ctx.arc(120, H - 100, 150, 0, Math.PI * 2); ctx.fill()

  const font = (w: string, s: number) => `${w} ${s}px Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif`
  ctx.textBaseline = 'alphabetic'

  // 새싹 + 브랜드
  ctx.font = '90px sans-serif'; ctx.fillText('🌱', 80, 150)
  ctx.fillStyle = '#16a34a'; ctx.font = font('800', 52); ctx.fillText('모두봄', 185, 145)

  // 헤드라인
  ctx.fillStyle = '#1f3d2b'; ctx.font = font('800', 78)
  ctx.fillText('내가 받을 수 있는 복지', 80, 300)
  ctx.fillStyle = '#16a34a'; ctx.font = font('800', 110)
  ctx.fillText(`${count}개`, 80, 425)

  // 월 합계
  if (monthlyText) {
    ctx.fillStyle = '#ea580c'; ctx.font = font('700', 46)
    ctx.fillText(`예상 월 최대 ${monthlyText}`, 80, 500)
  }

  // 푸터
  ctx.fillStyle = '#6b7280'; ctx.font = font('500', 34)
  ctx.fillText('회원가입 없이 1분 · biocode67.github.io/modoo-bom', 80, 575)

  return await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'))
}

/** 이미지 카드 공유(파일) 또는 다운로드 폴백 */
export async function shareOrDownloadCard(blob: Blob): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], '모두봄_내복지.png', { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  try {
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: '모두봄 — 내 복지', text: '내가 받을 수 있는 복지를 확인했어요! 🌱' })
      return 'shared'
    }
  } catch {
    // 취소/실패 시 다운로드로 폴백
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '모두봄_내복지.png'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
