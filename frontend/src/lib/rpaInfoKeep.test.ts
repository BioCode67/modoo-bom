import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isKeepOn, setKeepOn, saveKept, loadKept, clearKept } from './rpaInfoKeep'

const FLAG_KEY = 'modoobom-rpainfo-keep'
const DATA_KEY = 'modoobom-rpainfo-session'

const INFO = { name: '홍길동', birth_date: '19600101', phone: '01012345678', carrier: 'SKT', sido: '', sigungu: '', auth_provider: 'kakao' }

/** node 테스트 환경엔 sessionStorage가 없다 — Map 기반 최소 스텁(titleBadge 테스트와 같은 방식) */
function makeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  } as Storage
}

describe('rpaInfoKeep — 인증정보 탭-기억 옵트인', () => {
  beforeEach(() => { vi.stubGlobal('sessionStorage', makeStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('기본은 OFF — 플래그 없음·로드 null', () => {
    expect(isKeepOn()).toBe(false)
    expect(loadKept()).toBeNull()
  })

  it('OFF 상태의 saveKept는 흔적을 만들지 않는다(no-op)', () => {
    saveKept(INFO)
    expect(sessionStorage.getItem(DATA_KEY)).toBeNull()
    expect(loadKept()).toBeNull()
  })

  it('켜면 즉시 보관 + 라운드트립, 입력 변경도 반영된다', () => {
    setKeepOn(true, INFO)
    expect(isKeepOn()).toBe(true)
    expect(loadKept()).toMatchObject({ name: '홍길동', birth_date: '19600101', phone: '01012345678' })
    saveKept({ ...INFO, phone: '01099998888' })
    expect(loadKept()?.phone).toBe('01099998888')
  })

  it('끄면 보관분도 즉시 삭제된다(옵트아웃 흔적 미잔류)', () => {
    setKeepOn(true, INFO)
    setKeepOn(false)
    expect(isKeepOn()).toBe(false)
    expect(sessionStorage.getItem(DATA_KEY)).toBeNull()
  })

  it('손상 JSON·이물 키·비문자열은 조용히 버린다(폼이 깨지지 않게)', () => {
    setKeepOn(true)
    sessionStorage.setItem(DATA_KEY, '{corrupt')
    expect(loadKept()).toBeNull()
    sessionStorage.setItem(DATA_KEY, JSON.stringify({ name: '김복순', evil: '<script>', phone: 123, __proto__x: 'x' }))
    const kept = loadKept()
    expect(kept).toEqual({ name: '김복순' }) // phone(숫자)·미지 키 제거
  })

  it('플래그가 꺼져 있으면 남은 데이터가 있어도 로드하지 않는다', () => {
    sessionStorage.setItem(DATA_KEY, JSON.stringify({ name: '홍길동' }))
    expect(loadKept()).toBeNull()
  })

  it('clearKept는 데이터+플래그를 모두 지운다(다음 분 상담 경로)', () => {
    setKeepOn(true, INFO)
    clearKept()
    expect(isKeepOn()).toBe(false)
    expect(sessionStorage.getItem(FLAG_KEY)).toBeNull()
    expect(sessionStorage.getItem(DATA_KEY)).toBeNull()
  })

  it('🔒 주민번호 뒷자리·부모 성명은 탭-기억을 켜도 절대 보관되지 않는다(FIELDS 제외 계약)', () => {
    // 가족관계증명서용 민감정보 — 옵트인 보관(sessionStorage)에도 남기지 않는다는 프라이버시 약속을 고정.
    // (뒷자리 예시는 INFO.phone 과 겹치지 않는 수열로 — 오탐 방지)
    setKeepOn(true, { ...INFO, rrn_back: '9876543', parent_kind: '부', parent_name: '김상식' } as never)
    saveKept({ ...INFO, rrn_back: '9876543', parent_name: '김상식' } as never)
    const raw = sessionStorage.getItem(DATA_KEY) || ''
    expect(raw).not.toContain('9876543')
    expect(raw).not.toContain('김상식')
    const kept = loadKept() as Record<string, unknown>
    expect(kept.rrn_back).toBeUndefined()
    expect(kept.parent_name).toBeUndefined()
  })
})
