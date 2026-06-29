import { useEffect, useState } from 'react'

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** PWA 설치 프롬프트 — beforeinstallprompt를 잡아 커스텀 '앱 설치' 버튼 제공 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = async () => {
    if (!deferred) return
    await deferred.prompt()
    try { await deferred.userChoice } catch { /* noop */ }
    setDeferred(null)
  }

  return { canInstall: !!deferred && !installed, promptInstall }
}
