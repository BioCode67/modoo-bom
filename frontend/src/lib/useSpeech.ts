import { useEffect, useRef, useState } from 'react'

// Web Speech API 타입(브라우저 비표준) 최소 선언
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}

/** 음성 인식 오류코드 → 사용자용 안내(어르신도 이해할 쉬운 말). */
function speechErrorMessage(code?: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '마이크 사용이 막혀 있어요. 브라우저 주소창의 🔒(자물쇠)에서 마이크를 허용해 주세요.'
    case 'no-speech':
      return '소리가 들리지 않았어요. 다시 한 번 또박또박 말씀해 주세요.'
    case 'audio-capture':
      return '마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인해 주세요.'
    case 'network':
      return '네트워크 문제로 음성 인식을 못 했어요. 연결을 확인하고 다시 시도해 주세요.'
    default:
      return '음성 인식에 실패했어요. 글로 입력하셔도 됩니다.'
  }
}
type SRCtor = new () => SpeechRecognitionLike

function getCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/** 음성 인식 훅. lang으로 인식 언어 지정(기본 한국어). 미지원 브라우저면 supported=false.
 * lang이 바뀌면 인식기를 재생성 → 다국어 음성 입력(외국인·다문화) 지원. */
export function useSpeech(onResult: (text: string) => void, lang: string = 'ko-KR') {
  const [supported] = useState(() => !!getCtor())
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null) // 마지막 오류 안내(권한거부·무음 등) — UI에서 노출
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const cbRef = useRef(onResult)
  cbRef.current = onResult

  useEffect(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript ?? ''
      if (text) cbRef.current(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => { setListening(false); setError(speechErrorMessage(e?.error)) }
    recRef.current = rec
    return () => { try { rec.stop() } catch { /* noop */ } }
  }, [lang])

  const toggle = () => {
    const rec = recRef.current
    if (!rec) return
    if (listening) {
      try { rec.stop() } catch { /* noop */ }
      setListening(false)
    } else {
      setError(null)
      try { rec.start(); setListening(true) } catch { setError(speechErrorMessage()) }
    }
  }

  return { supported, listening, toggle, error }
}
