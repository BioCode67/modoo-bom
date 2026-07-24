import { getRpaBase } from '@/lib/backend'

/**
 * 백엔드 스마트 웹 에이전트(/api/webagent/run) 프론트 클라이언트.
 * webAgent.ts 플래너가 '계획'이라면, 여기는 실제 백엔드 실행을 호출하는 '실행' 경로다.
 * 백엔드가 없거나(정적 배포) 실패하면 null → 호출부는 공식 링크 폴백으로 이어간다(무너지지 않음).
 *
 * 순수 정규화(normalizeWebAgentResult)와 네트워크(runWebAgentRemote)를 분리해, fetch 주입으로 테스트한다.
 */

export interface WebAgentRunResult {
  goal: string
  success: boolean
  status: string        // done|needs_human_auth|needs_human_submit|route|fallback|error
  engine: string        // deterministic|browser_use|builtin|none
  steps: number
  message: string
  fallbackUrl?: string
  needsHuman: string | null   // 'auth'|'submit'|null
  extracted: Record<string, unknown>
  error: string | null
}

/** 백엔드 WebAgentResult(dict·snake_case)를 프론트 타입으로 방어적으로 정규화. */
export function normalizeWebAgentResult(d: unknown, goal: string): WebAgentRunResult {
  const o = d && typeof d === 'object' ? (d as Record<string, unknown>) : {}
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    goal: str('goal') || goal,
    success: o.success === true,
    status: str('status') || 'error',
    engine: str('engine') || 'none',
    steps: typeof o.steps === 'number' ? o.steps : 0,
    message: str('message'),
    fallbackUrl: str('fallback_url') || undefined,
    needsHuman: typeof o.needs_human === 'string' ? (o.needs_human as string) : null,
    extracted: o.extracted && typeof o.extracted === 'object' ? (o.extracted as Record<string, unknown>) : {},
    error: typeof o.error === 'string' ? (o.error as string) : null,
  }
}

export interface RunOpts {
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * 백엔드 웹 에이전트 /run 호출.
 * 흐름: ① base(감지된 RPA 서버) 없거나 목표 공백이면 null → ② POST /api/webagent/run →
 *       ③ 실패(non-2xx·네트워크·JSON 오류)면 null(호출부 폴백) → ④ 성공이면 정규화 결과.
 */
export async function runWebAgentRemote(goal: string, opts: RunOpts = {}): Promise<WebAgentRunResult | null> {
  const base = opts.baseUrl ?? getRpaBase()
  const g = (goal || '').trim()
  if (!base || !g) return null
  const f = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  if (!f) return null
  try {
    const res = await f(`${base.replace(/\/$/, '')}/api/webagent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: g }),
      signal: opts.signal,
    })
    if (!res.ok) return null
    return normalizeWebAgentResult(await res.json(), g)
  } catch {
    return null
  }
}
