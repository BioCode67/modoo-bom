import { useEffect, useState } from 'react'

/** 한국어 음성 안내(TTS) 훅 — 어르신·저시력 접근성. 미지원 시 supported=false. */
export function useTTS() {
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    // 페이지 이탈/언마운트 시 읽기 중단
    return () => { if (supported) window.speechSynthesis.cancel() }
  }, [supported])

  const speak = (text: string) => {
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = 0.95
    u.pitch = 1
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }

  const stop = () => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const toggle = (text: string) => {
    if (speaking) stop()
    else speak(text)
  }

  return { supported, speaking, speak, stop, toggle }
}
