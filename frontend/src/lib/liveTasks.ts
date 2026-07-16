// 진행 중 RPA 태스크의 '세션 연속성' — 새로고침·뷰 이탈 후에도 발급/신청 추적을 복원한다.
//   문제(감사 확정): rpa 상태가 useState뿐이라 화면을 떠나면 추적이 끊김 — 백엔드 브라우저는 계속 도는데
//   앱은 백지가 됨. 해결: 시작 시 taskId+토큰을 sessionStorage에 기억 → 마운트 시 폴링 재개.
//   sessionStorage 선택 이유: 새로고침·뷰 전환은 견디되 브라우저(세션) 종료 시엔 소멸 —
//   토큰·진행정보가 다음 사용자(공용 PC)에게 남지 않는다(PII 최소잔존, localStorage 부적합).

export type LiveKind = 'doc' | 'apply' | 'journey'

export interface LiveTask {
  taskId: string
  token: string
  at: number
  /** journey 전용 — 서버가 수락한 서류 목록(복원 시 카드 매핑 재구성용) */
  docs?: string[]
}

const KEY = 'modoobom-live-v1'
const TTL_MS = 45 * 60 * 1000 // 백엔드 태스크 타임아웃(≤30분)보다 넉넉히 — 그 뒤엔 어차피 태스크가 없다

type Store = Record<LiveKind, Record<string, LiveTask>>

// sessionStorage 불가 환경(시크릿 모드 저장 차단·테스트 노드 등) 폴백 — 같은 페이지 세션 안에서의
// 뷰 전환 연속성은 메모리로도 유지된다(새로고침 복원만 포기, 기능 자체는 무손실).
let memory: string | null = null
const storage = {
  get(): string | null {
    try { return sessionStorage.getItem(KEY) } catch { return memory }
  },
  set(v: string) {
    try { sessionStorage.setItem(KEY, v) } catch { /* 아래 메모리에 항상 저장 */ }
    memory = v
  },
  remove() {
    try { sessionStorage.removeItem(KEY) } catch { /* noop */ }
    memory = null
  },
}

function read(): Store {
  try {
    const raw = storage.get()
    const s = raw ? (JSON.parse(raw) as Store) : null
    const base: Store = { doc: {}, apply: {}, journey: {} }
    if (!s || typeof s !== 'object') return base
    const now = Date.now()
    for (const kind of ['doc', 'apply', 'journey'] as LiveKind[]) {
      const m = s[kind]
      if (!m || typeof m !== 'object') continue
      for (const [k, v] of Object.entries(m)) {
        if (v && typeof v.taskId === 'string' && typeof v.at === 'number' && now - v.at < TTL_MS) base[kind][k] = v
      }
    }
    return base
  } catch {
    return { doc: {}, apply: {}, journey: {} }
  }
}

function write(s: Store) {
  storage.set(JSON.stringify(s))
}

/** 진행 시작을 기억 — 종결(forget) 전까지 복원 대상 */
export function rememberLive(kind: LiveKind, key: string, task: Omit<LiveTask, 'at'>) {
  const s = read()
  s[kind][key] = { ...task, at: Date.now() }
  write(s)
}

/** 종결(완료·오류·취소·404) 시 제거 — 좀비 복원 방지 */
export function forgetLive(kind: LiveKind, key: string) {
  const s = read()
  if (s[kind][key]) { delete s[kind][key]; write(s) }
}

/** 복원 대상 나열(TTL 지난 항목은 read에서 걸러짐) */
export function listLive(kind: LiveKind): Record<string, LiveTask> {
  return read()[kind]
}

/** '다음 분 상담' 등 전체 초기화 */
export function clearLive() {
  storage.remove()
}
