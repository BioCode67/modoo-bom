import { Component, type ReactNode } from 'react'
import { SproutLogo } from '@/ui/SproutLogo'

interface State { error: Error | null }

/** 예기치 못한 렌더 오류 시 화이트스크린 대신 친절한 폴백 + 복구 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // 운영 로깅 훅 지점 (콘솔만 — 외부 전송 없음)
    console.error('[모두봄] 렌더 오류:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="card-cute max-w-md w-full p-8 text-center">
            <SproutLogo withFace className="h-20 w-20 mx-auto mb-3" />
            <h1 className="text-xl font-extrabold">잠시 문제가 생겼어요</h1>
            <p className="text-sm text-muted-foreground mt-2">
              화면을 불러오는 중 오류가 발생했어요. 새로고침하면 대부분 해결돼요.
            </p>
            <div className="mt-5 flex gap-2 justify-center">
              <button onClick={() => window.location.reload()} className="btn-primary">새로고침</button>
              <button
                onClick={() => { try { localStorage.removeItem('modoobom-store') } catch { /* noop */ } window.location.reload() }}
                className="btn-secondary"
              >
                초기화 후 새로고침
              </button>
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">문제가 계속되면 복지로 ☎ 129로 문의하세요.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
