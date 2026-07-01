/**
 * 온디바이스 AI 의미 검색 — multilingual-e5-small 임베딩(브라우저 내 실행).
 *
 * - 정책 벡터는 빌드 시 사전계산(public/policy-embeddings.json, int16·base64).
 * - 런타임에는 '질의'만 임베딩(짧아서 빠름)하고 코사인 유사도로 랭킹.
 * - 다국어 교차검색: 한국어/영어/베트남어 등 어떤 언어로 물어도 한국 복지를 의미로 매칭.
 * - 서버 전송 없음(프라이버시). 모델은 최초 1회 HuggingFace CDN에서 다운로드 후 캐시.
 *
 * transformers.js는 무겁기 때문에 이 모듈과 라이브러리는 사용자가 AI 검색을 켤 때만
 * 동적 import 되어 로드된다(초기 번들·로딩에 영향 없음).
 */
import type { Policy } from '@/data/policies'
import { getPolicyMap } from '@/data/catalog'

export type SemanticProgress = (info: { stage: string; pct?: number }) => void
export interface SemanticHit { policy: Policy; score: number }

interface EmbedFile { model: string; dim: number; count: number; ids: string[]; data: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: any = null
let _vecs: Float32Array[] | null = null
let _ids: string[] = []
let _loading: Promise<void> | null = null

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

/** 임베딩 데이터 + AI 모델을 1회 로드(진행률 콜백). 실패 시 throw → 호출부에서 폴백. */
async function ensureLoaded(onProgress?: SemanticProgress): Promise<void> {
  if (_extractor && _vecs) return
  if (_loading) return _loading
  _loading = (async () => {
    onProgress?.({ stage: '복지 데이터 준비' })
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}policy-embeddings.json`)
    if (!res.ok) throw new Error(`임베딩 데이터 로드 실패(${res.status})`)
    const ef: EmbedFile = await res.json()
    const q = base64ToInt16(ef.data)
    const vecs: Float32Array[] = []
    for (let i = 0; i < ef.count; i++) {
      const v = new Float32Array(ef.dim)
      for (let j = 0; j < ef.dim; j++) v[j] = q[i * ef.dim + j] / 32767
      vecs.push(v)
    }
    _vecs = vecs
    _ids = ef.ids

    onProgress?.({ stage: 'AI 모델 다운로드', pct: 0 })
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false // HuggingFace CDN에서 로드
    _extractor = await pipeline('feature-extraction', ef.model, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && typeof p?.progress === 'number') {
          onProgress?.({ stage: 'AI 모델 다운로드', pct: Math.round(p.progress) })
        }
      },
    })
    onProgress?.({ stage: '준비 완료', pct: 100 })
  })()
  try {
    await _loading
  } catch (e) {
    _loading = null // 실패 시 재시도 허용
    throw e
  }
}

/** 질의(모든 언어)로 정책을 의미 기반 랭킹. 상위 topK의 정책+점수 반환. */
export async function semanticSearch(
  query: string,
  topK = 12,
  onProgress?: SemanticProgress,
): Promise<SemanticHit[]> {
  const q = query.trim()
  if (!q) return []
  await ensureLoaded(onProgress)
  const out = await _extractor(`query: ${q}`, { pooling: 'mean', normalize: true })
  const qv = out.data as Float32Array
  const pmap = getPolicyMap()
  // 대표(시드 POL-) 정책 소폭 가점 — 전국 5천건 중 지역 소규모 사업에 대표 국가제도가
  // 묻히지 않게(기초연금·긴급복지 등이 상위에 오도록). 유사도 격차보다 작아 강제 override는 아님.
  const SEED_BOOST = 0.04
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < _ids.length; i++) {
    const pv = _vecs![i]
    let s = 0
    for (let j = 0; j < pv.length; j++) s += qv[j] * pv[j] // 정규화 벡터 → dot=코사인
    if (_ids[i].charCodeAt(0) === 80 /* 'P' (POL-) */) s += SEED_BOOST
    scored.push({ id: _ids[i], score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const hits: SemanticHit[] = []
  for (const { id, score } of scored.slice(0, topK)) {
    const policy = pmap[id]
    if (policy) hits.push({ policy, score })
  }
  return hits
}

/** 미리 로드(모델 워밍업). UI에서 토글 켤 때 호출. */
export async function warmupSemantic(onProgress?: SemanticProgress): Promise<void> {
  await ensureLoaded(onProgress)
}

export function isSemanticReady(): boolean {
  return !!(_extractor && _vecs)
}
