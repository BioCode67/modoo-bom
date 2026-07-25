import { describe, it, expect, afterEach, vi } from 'vitest'
import { requestIssueDoc, takePendingIssue, requestIssueAll, takePendingIssueAll, hasPendingIssue } from './issueBridge'

// 순수 로직 전용(프로젝트 컨벤션: 무DOM) — 이벤트·탭 전환 경로는 desktop-smoke 6.85/6.97이 검증하고,
// 여기선 '발급 명령 좌초 → 나중 탭 진입 때 돌발 실행' 결함(탭 레이아웃 병합 회귀)의 계약만 고정한다:
//  ① hasPendingIssue는 비소비 조회다 — My가 착지 시 '서류 발급' 탭을 열지 판단해도 보류가 증발하지 않는다.
//  ② take*는 1회성 소비다(중복 발급 방지).
//  ③ 유효시간(120초)이 지난 보류는 버려진다 — 예고 없는 브라우저 기동·간편인증 돌발 실행 차단.
describe('issueBridge — 발급 보류의 비소비 조회·1회성 소비·유효시간', () => {
  afterEach(() => {
    vi.useRealTimers()
    // 테스트 간 보류 잔류 방지 — take*로 비운다(모듈 전역 상태)
    takePendingIssue()
    takePendingIssueAll()
  })

  it('보류가 없으면 hasPendingIssue는 false', () => {
    expect(hasPendingIssue()).toBe(false)
  })

  it('단건 보류: hasPendingIssue는 소거하지 않고(비소비), take가 그대로 이어받는다', () => {
    requestIssueDoc('주민등록초본')            // 리스너 없음(무DOM) — 보류만 생존
    expect(hasPendingIssue()).toBe(true)       // My의 초기 탭 판단(조회)
    expect(hasPendingIssue()).toBe(true)       // 여러 번 조회해도 증발 없음
    expect(takePendingIssue()).toBe('주민등록초본') // DocumentCenter가 실제 소비
    expect(takePendingIssue()).toBe('')        // 1회성 — 중복 발급 방지
    expect(hasPendingIssue()).toBe(false)
  })

  it('전체 연쇄 보류(오토파일럿·"전부 발급해줘")도 동일 계약', () => {
    requestIssueAll()
    expect(hasPendingIssue()).toBe(true)
    expect(takePendingIssueAll()).toBe(true)
    expect(takePendingIssueAll()).toBe(false)  // 1회성
    expect(hasPendingIssue()).toBe(false)
  })

  it('유효시간(120초) 안의 보류는 정상 소비된다(착지→즉시 이어받기 경로)', () => {
    vi.useFakeTimers()
    requestIssueDoc('주민등록등본')
    vi.advanceTimersByTime(119_000)
    expect(hasPendingIssue()).toBe(true)
    expect(takePendingIssue()).toBe('주민등록등본')
  })

  it('유효시간이 지난 단건 보류는 버려진다 — 한참 뒤 탭 진입 때 돌발 발급 금지', () => {
    vi.useFakeTimers()
    requestIssueDoc('주민등록등본')
    vi.advanceTimersByTime(121_000)
    expect(hasPendingIssue()).toBe(false)      // 헛 탭 전환도 없음
    expect(takePendingIssue()).toBe('')        // 늦은 자동 RPA 기동 금지
  })

  it('유효시간이 지난 전체 연쇄 보류도 버려진다(브라우저 기동+간편인증 돌발 차단)', () => {
    vi.useFakeTimers()
    requestIssueAll()
    vi.advanceTimersByTime(121_000)
    expect(hasPendingIssue()).toBe(false)
    expect(takePendingIssueAll()).toBe(false)
  })

  it('단건·전체는 독립 채널 — 한쪽 소비가 다른 쪽 보류를 지우지 않는다', () => {
    requestIssueDoc('가족관계증명서')
    requestIssueAll()
    expect(takePendingIssue()).toBe('가족관계증명서')
    expect(hasPendingIssue()).toBe(true)       // 전체 연쇄 보류는 아직 살아 있음
    expect(takePendingIssueAll()).toBe(true)
  })
})
