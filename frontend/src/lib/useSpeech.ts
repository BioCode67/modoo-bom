import { useEffect, useRef, useState } from 'react'

// Web Speech API 타입(브라우저 비표준) 최소 선언
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type SRCtor = new () => SpeechRecognitionLike

function getCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/** 한국어 음성 인식 훅. 미지원 브라우저면 supported=false. */
export function useSpeech(onResult: (text: string) => void) {
  const [supported] = useState(() => !!getCtor())
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const cbRef = useRef(onResult)
  cbRef.current = onResult

  useEffect(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'ko-KR'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript ?? ''
      if (text) cbRef.current(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    return () => { try { rec.stop() } catch { /* noop */ } }
  }, [])

  const toggle = () => {
    const rec = recRef.current
    if (!rec) return
    if (listening) {
      try { rec.stop() } catch { /* noop */ }
      setListening(false)
    } else {
      try { rec.start(); setListening(true) } catch { /* noop */ }
    }
  }

  return { supported, listening, toggle }
}
