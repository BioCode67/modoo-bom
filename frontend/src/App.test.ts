import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * App 셸 소스 계약 — 루트 lazy 위젯 4종(챗·새싹이 가이드·음성 투어·인쇄 요약)은 반드시
 * 위젯별 개별 WidgetBoundary(+Suspense)로 감싼다.
 *
 * 배경(회귀 고정): 부속 위젯 청크 1건의 네트워크 실패(첫 방문 프리캐시 전 불안정 회선·
 * 재배포로 옛 해시 청크 소멸)가 루트 ErrorBoundary까지 전파되면, 정상 동작 중이던 앱 전체가
 * 전면 오류 카드로 교체되고 그 화면의 [초기화 후 새로고침]이 modoobom-store(담은 복지·
 * 신청상태·발급 기록)까지 지우게 유도한다 — 부속 위젯은 실패 시 조용히 사라지는 것이 옳다.
 * 컴포넌트 렌더 테스트 대신 소스 계약으로 잠근다(backend test_rpa_honesty.py 선례, 포매팅 무관).
 */
const src = readFileSync(new URL('./App.tsx', import.meta.url), 'utf-8')

const LAZY_WIDGETS = ['ChatWidget', 'SproutGuide', 'VoiceGuide', 'PrintSummary'] as const

describe('App 셸 — 부속 위젯 에러 바운더리 계약', () => {
  it('네 위젯이 여전히 lazy 청크다(청크 로드 실패라는 결함 클래스의 전제)', () => {
    for (const w of LAZY_WIDGETS) {
      expect(src, `${w} 는 lazy(() => import(...)) 로 로드돼야 이 계약의 대상`).toMatch(
        new RegExp(`const ${w} = lazy\\(`),
      )
    }
  })

  it('각 위젯은 자기만의 <WidgetBoundary><Suspense>…</Suspense></WidgetBoundary> 로 감싼다', () => {
    for (const w of LAZY_WIDGETS) {
      // 바운더리가 Suspense '바깥'이어야 lazy 거부(렌더 중 throw)를 잡는다.
      // 여닫음이 위젯 하나로 즉시 닫혀야 개별 래핑(한 위젯 실패가 다른 위젯을 지우지 않음).
      const wrapped = new RegExp(
        `<WidgetBoundary>\\s*<Suspense[^>]*>\\s*<${w}\\s*/>\\s*</Suspense>\\s*</WidgetBoundary>`,
      )
      expect(src, `${w} 는 개별 WidgetBoundary(바깥)+Suspense(안) 래핑이어야 한다`).toMatch(wrapped)
    }
  })

  it('WidgetBoundary 는 실패 시 조용히 null 강등 — 오류 UI·데이터 초기화 유도 금지', () => {
    const cls = src.match(/class WidgetBoundary[\s\S]*?\n\}/)?.[0] ?? ''
    expect(cls, 'WidgetBoundary 클래스가 App.tsx 에 있어야 한다').not.toBe('')
    // 실패 플래그 전환
    expect(cls).toMatch(/getDerivedStateFromError\(\)\s*\{\s*return\s*\{\s*failed:\s*true\s*\}/)
    // 실패 시 children 대신 null — 부속 위젯은 사라지고 앱 본체·사용자 데이터는 산다
    expect(cls).toMatch(/failed\s*\?\s*null\s*:/)
    // 전면 오류 카드·스토어 삭제 유도 같은 실해 유발 동작 금지(루트 ErrorBoundary와 역할 구분)
    expect(cls).not.toMatch(/localStorage|reload|초기화/)
  })
})
