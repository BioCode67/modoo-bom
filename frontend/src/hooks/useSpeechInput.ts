/**
 * Web Speech API 음성 인식 훅
 * - lang: ko-KR
 * - 한국어 숫자 단어 → 아라비아 숫자 변환
 */
import { useState, useRef, useCallback } from 'react'

// 한국어 숫자 단어 → 아라비아 숫자 (개별 자리 발음 기준)
function koreanDigitsToArabic(text: string): string {
  // 한국어 숫자 단어를 먼저 아라비아 숫자로 치환한 뒤 비숫자 제거
  // ⚠️ '일'을 먼저 제거하면 안 됨 — '일'은 숫자 1이기도 함
  const map: [string, string][] = [
    ['영', '0'], ['공', '0'],
    ['일', '1'],
    ['이', '2'],
    ['삼', '3'],
    ['사', '4'],
    ['오', '5'],
    ['육', '6'], ['륙', '6'],
    ['칠', '7'],
    ['팔', '8'],
    ['구', '9'],
  ]
  let result = text
  for (const [kr, digit] of map) {
    result = result.replaceAll(kr, digit)
  }
  // 단위·공백·구분자 제거 (숫자로 변환된 이후에 제거)
  return result.replace(/[^0-9]/g, '')
}

type Status = 'idle' | 'listening' | 'done' | 'error' | 'unsupported'

interface Options {
  /** 인식 완료 후 콜백 — 숫자만 추출된 값 전달 */
  onResult: (digits: string, raw: string) => void
  /** 최소 자릿수: 이 이상일 때만 onResult 호출 */
  minDigits?: number
}

export function useSpeechInput({ onResult, minDigits = 1 }: Options) {
  const [status, setStatus] = useState<Status>(() => {
    if (typeof window === 'undefined') return 'unsupported'
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    return SR ? 'idle' : 'unsupported'
  })
  const [transcript, setTranscript] = useState('')
  const recRef = useRef<any>(null)

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) { setStatus('unsupported'); return }
    if (status === 'listening') return

    const rec = new SR()
    recRef.current = rec
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.maxAlternatives = 3

    rec.onstart = () => setStatus('listening')

    rec.onresult = (e: any) => {
      // 대안 중 숫자가 가장 많이 나오는 것 선택
      let best = ''
      let bestDigits = ''
      for (let i = 0; i < e.results[0].length; i++) {
        const raw = e.results[0][i].transcript
        const digits = koreanDigitsToArabic(raw)
        if (digits.length > bestDigits.length) {
          best = raw
          bestDigits = digits
        }
      }
      setTranscript(best)
      if (bestDigits.length >= minDigits) {
        onResult(bestDigits, best)
        setStatus('done')
      } else {
        setStatus('error')
      }
      setTimeout(() => setStatus('idle'), 2000)
    }

    rec.onerror = (e: any) => {
      console.warn('[SpeechInput] error:', e.error)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2500)
    }

    rec.onend = () => {
      setStatus(prev => prev === 'listening' ? 'idle' : prev)
    }

    rec.start()
  }, [status, onResult, minDigits])

  const stop = useCallback(() => {
    recRef.current?.stop()
    setStatus('idle')
  }, [])

  return { status, transcript, start, stop }
}
