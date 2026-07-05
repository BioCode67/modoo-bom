import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// 폰트 비차단 적용(CSP 강화로 인라인 onload 제거 — 번들에서 media 전환).
// 시스템 폰트로 먼저 그리고, CSS 로드 후 전체 적용(swap과 동일 효과).
{
  const fontCss = document.getElementById('pretendard-css') as HTMLLinkElement | null
  if (fontCss) {
    const apply = () => { fontCss.media = 'all' }
    if (fontCss.sheet) apply()
    else { fontCss.addEventListener('load', apply, { once: true }); setTimeout(apply, 3000) /* 안전망 */ }
  }
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
