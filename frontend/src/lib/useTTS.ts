import { useEffect, useState } from 'react'

/** 언어코드(en/vi/zh…) → SpeechSynthesis BCP-47 lang 태그. 다국어 AI 답변을 자국어 보이스로 읽기 위함. */
const LANG_TAG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', vi: 'vi-VN', zh: 'zh-CN', ja: 'ja-JP', th: 'th-TH', ru: 'ru-RU', ar: 'ar-SA', id: 'id-ID',
}
function toTag(lang?: string): string {
  if (!lang) return 'ko-KR'
  if (lang.includes('-')) return lang // 이미 BCP-47
  return LANG_TAG[lang] || 'ko-KR'
}
/** 해당 언어의 보이스가 브라우저에 실제로 있는지(없으면 발음이 깨지므로 호출부에서 안내 가능). */
export function hasVoiceFor(lang?: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  const tag = toTag(lang).split('-')[0]
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return true // 아직 로드 전 — 낙관적(voiceschanged 후 재판단)
  return voices.some((v) => v.lang.toLowerCase().startsWith(tag))
}

/** 음성 안내(TTS) 훅 — 어르신·저시력 접근성 + 다국어. 미지원 시 supported=false. */
export function useTTS() {
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window)
  const [speaking, setSpeaking] = useState(false)
  // 보이스 목록 로드 완료를 반영하는 버전 — voiceschanged 후 hasVoice 재판단을 유발(첫 낙관적 true 보정).
  const [voicesVer, setVoicesVer] = useState(0)

  useEffect(() => {
    if (!supported) return
    // 보이스 목록은 비동기 로드 — 미리 트리거해 첫 호출 시 빈 배열 문제 완화
    try { window.speechSynthesis.getVoices() } catch { /* noop */ }
    const onChange = () => setVoicesVer((v) => v + 1)
    try { window.speechSynthesis.addEventListener('voiceschanged', onChange) } catch { /* noop */ }
    // 페이지 이탈/언마운트 시 읽기 중단
    return () => {
      try { window.speechSynthesis.removeEventListener('voiceschanged', onChange) } catch { /* noop */ }
      window.speechSynthesis.cancel()
    }
  }, [supported])

  /** speak(text, lang?) — lang은 'en'·'vi' 같은 언어코드 또는 'en-US' BCP-47. 미지정=한국어. */
  const speak = (text: string, lang?: string) => {
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = toTag(lang)
    const base = u.lang.split('-')[0]
    const match = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(base))
    if (match) u.voice = match
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

  const toggle = (text: string, lang?: string) => {
    if (speaking) stop()
    else speak(text, lang)
  }

  // voicesVer가 바뀌면(보이스 로드 완료) 재평가되도록, 매 렌더에서 현재 목록으로 판단.
  // (voicesVer를 참조해 consumer가 로드 후 다시 렌더되게 함)
  void voicesVer
  const hasVoice = (lang?: string) => hasVoiceFor(lang)

  return { supported, speaking, speak, stop, toggle, hasVoice, voicesVer }
}
