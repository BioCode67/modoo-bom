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
import { getPolicyMap, getCatalog } from '@/data/catalog'
import { queryConcepts, relevance } from './search'

export type SemanticProgress = (info: { stage: string; pct?: number }) => void
export interface SemanticHit { policy: Policy; score: number }

interface EmbedFile { model: string; dim: number; count: number; ids: string[]; data: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: any = null
let _vecs: Float32Array[] | null = null
let _ids: string[] = []
let _model = ''
let _embLoading: Promise<void> | null = null
let _modelLoading: Promise<void> | null = null

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

/** 사전계산 임베딩(JSON)만 로드 — AI 모델 없이도 '비슷한 복지' 등에 사용. 실패 시 throw. */
async function ensureEmbeddings(onProgress?: SemanticProgress): Promise<void> {
  if (_vecs) return
  if (_embLoading) return _embLoading
  _embLoading = (async () => {
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
    _model = ef.model
  })()
  try {
    await _embLoading
  } catch (e) {
    _embLoading = null
    throw e
  }
}

/** AI 임베딩 모델(transformers.js) 로드 — 질의 임베딩용. 실패 시 throw. */
async function ensureModel(onProgress?: SemanticProgress): Promise<void> {
  if (_extractor) return
  if (_modelLoading) return _modelLoading
  _modelLoading = (async () => {
    onProgress?.({ stage: 'AI 모델 다운로드', pct: 0 })
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false // HuggingFace CDN에서 로드
    // ⚠️ onnxruntime-web 안정화(간헐 'no available backend found' 수정):
    //   멀티스레드 WASM은 SharedArrayBuffer=cross-origin isolation(COOP/COEP 헤더)이 필요한데
    //   gh-pages는 그 헤더를 못 보낸다 → 스레드 백엔드가 간헐적으로 초기화 실패(특히 한국어 외 질의).
    //   단일 스레드 + 프록시(blob 워커) 비활성으로 강제 → 어느 언어·연속 질의에도 안정. 질의는 짧아 충분히 빠름.
    try {
      const wasm = env.backends?.onnx?.wasm
      if (wasm) { wasm.numThreads = 1; wasm.proxy = false }
    } catch { /* env 구조가 바뀌어도 치명적 아님 */ }
    _extractor = await pipeline('feature-extraction', _model || 'Xenova/multilingual-e5-small', {
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
    await _modelLoading
  } catch (e) {
    _modelLoading = null
    throw e
  }
}

/** 임베딩 + 모델 모두 로드(질의 검색용). */
async function ensureLoaded(onProgress?: SemanticProgress): Promise<void> {
  await ensureEmbeddings(onProgress)
  await ensureModel(onProgress)
}

// 질의 임베딩 직렬화 큐. onnxruntime-web(WASM) 추출기는 '재진입 불가' —
// 빠른 연속 질의(디바운스를 넘긴 겹침)나 워밍업과 겹치면 런타임이 깨져 간헐적으로 실패한다
// (Node에선 재현 안 됨=브라우저 WASM 한정). 모든 추출 호출을 한 줄로 세워 겹침을 원천 차단.
let _embedChain: Promise<unknown> = Promise.resolve()

async function embedQuery(text: string): Promise<Float32Array> {
  const run = _embedChain.then(async () => {
    try {
      const out = await _extractor(`query: ${text}`, { pooling: 'mean', normalize: true })
      return out.data as Float32Array
    } catch {
      // 일시적 WASM 실패는 1회 재시도(직렬화 덕에 이 시점엔 다른 추출이 없음)
      const out = await _extractor(`query: ${text}`, { pooling: 'mean', normalize: true })
      return out.data as Float32Array
    }
  })
  _embedChain = run.catch(() => {}) // 체인 자체는 실패해도 다음 호출을 막지 않게
  return run
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
  const qv = await embedQuery(q) // 직렬화+재시도(WASM 재진입 방지)
  const pmap = getPolicyMap()
  // 대표(시드 POL-) 정책 소폭 가점 — 전국 5천건 중 지역 소규모 사업에 대표 국가제도가
  // 묻히지 않게(기초연금·긴급복지 등이 상위에 오도록). 유사도 격차보다 작아 강제 override는 아님.
  const SEED_BOOST = 0.04
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < _ids.length; i++) {
    const pv = _vecs![i]
    let s = 0
    for (let j = 0; j < pv.length; j++) s += qv[j] * pv[j] // 정규화 벡터 → dot=코사인
    // ⚠️ 'P'로 시작하는 id엔 민간재단(PRV-)도 있으므로 POL-만 부스트 — 심사·선발형(PRV)을 랭킹에서 밀어올리지 않음(정직성)
    if (_ids[i].startsWith('POL-')) s += SEED_BOOST
    scored.push({ id: _ids[i], score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const hits: SemanticHit[] = []
  // 카탈로그에 없는 stale id(embed 후 정책 삭제·이름디듑)가 topK 슬롯을 차지해 결과가 적게 나오지 않도록 — 필터 후 제한.
  // 이름 디듑: 시드 동명 중복이 결과에 카드 2장으로 뜨던 것 방지(감사 확정). 지자체(LOC-)는 지역별 별개라 유지.
  const seenNames = new Set<string>()
  for (const { id, score } of scored) {
    const policy = pmap[id]
    if (!policy) continue
    if (!id.startsWith('LOC-')) {
      const nm = policy.name.replace(/[\s()（）]/g, '')
      if (seenNames.has(nm)) continue
      seenNames.add(nm)
    }
    hits.push({ policy, score })
    if (hits.length >= topK) break
  }
  return hits
}

/**
 * 하이브리드 검색 — 신경망 의미 랭킹과 키워드(개념) 랭킹을 RRF(Reciprocal Rank Fusion)로 융합.
 *
 * 임베딩 단독의 약점(정책 '고유명사' 질의: "기초연금"을 의미상 비슷한 다른 연금이 이길 수 있음)과
 * 키워드 단독의 약점(생활어·다국어: "tiền hỗ trợ sinh con"은 사전에 없음)을 서로 보완한다.
 * RRF는 점수 스케일이 다른 두 랭킹을 순위만으로 합치므로 별도 정규화·튜닝이 필요 없다(k=60 표준).
 * 키워드 랭킹이 비어 있으면(외국어 질의 등) 자연히 의미 랭킹만 남는다 — 다국어 검색 무손상.
 */
export async function hybridSearch(
  query: string,
  topK = 12,
  onProgress?: SemanticProgress,
): Promise<SemanticHit[]> {
  const q = query.trim()
  if (!q) return []
  // 융합 풀은 넉넉히(topK의 4배, 최소 60) — 한쪽 랭킹의 후순위가 다른 쪽 상위로 승격될 여지 확보
  const pool = Math.max(topK * 4, 60)
  const sem = await semanticSearch(q, pool, onProgress)
  return fuseRrf(sem, keywordLane(q, pool), topK)
}

/**
 * 하이브리드의 키워드 레인 — '한글이 포함된 질의'에만 켠다.
 * relevance/queryConcepts 는 한국어 도메인 랭커라, 영어 문장의 관사·대명사(a/I)가 1글자 사용자어
 * 예외로 정책명의 라틴 문자('(AI·디지털)'·'MRI' 등)에 오매칭돼 잡음이 상위에 인터리브된다(적대 리뷰 확정).
 * 외국어 질의는 의미 레인 단독이 정답 — 다국어 검색 무손상.
 */
export function keywordLane(q: string, pool: number): Policy[] {
  if (!/[가-힣]/.test(q)) return []
  const concepts = queryConcepts(q)
  if (!concepts.length) return []
  return getCatalog()
    .map((p) => ({ p, s: relevance(p, concepts, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, pool)
    .map((x) => x.p)
}

/**
 * RRF 융합(순수 함수) — 두 랭킹을 순위 역수 합으로 결합. k=60 표준.
 * 반환 score는 UI가 유사도(0~1)로 표시하므로 의미 유사도를 유지(융합점수로 신뢰도 날조 금지) —
 * 키워드 랭킹에만 있던 정책은 의미 풀 최하위 유사도로 보수적으로 표기.
 */
export function fuseRrf(sem: SemanticHit[], kw: Policy[], topK: number, K = 60): SemanticHit[] {
  const fused = new Map<string, { policy: Policy; score: number; semScore?: number }>()
  sem.forEach((h, i) => {
    fused.set(h.policy.id, { policy: h.policy, score: 1 / (K + i + 1), semScore: h.score })
  })
  kw.forEach((p, i) => {
    const cur = fused.get(p.id)
    const add = 1 / (K + i + 1)
    if (cur) cur.score += add
    else fused.set(p.id, { policy: p, score: add })
  })
  const floor = sem.length ? sem[sem.length - 1].score : 0.8
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => ({ policy: x.policy, score: x.semScore ?? floor }))
}

/**
 * 특정 정책과 의미가 비슷한 복지 — 사전계산 임베딩만 사용(AI 모델 다운로드 불필요).
 * 정책 상세에서 "비슷한 복지 찾기"에 사용. 이름 중복 제거, 자기 자신 제외.
 */
export async function relatedPolicies(policyId: string, topK = 6): Promise<SemanticHit[]> {
  await ensureEmbeddings()
  const idx = _ids.indexOf(policyId)
  if (idx < 0) return []
  const base = _vecs![idx]
  const pmap = getPolicyMap()
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < _ids.length; i++) {
    if (i === idx) continue
    const pv = _vecs![i]
    let s = 0
    for (let j = 0; j < pv.length; j++) s += base[j] * pv[j]
    scored.push({ id: _ids[i], score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const hits: SemanticHit[] = []
  const seen = new Set<string>()
  for (const { id, score } of scored) {
    if (hits.length >= topK) break
    const policy = pmap[id]
    if (!policy) continue
    const nm = policy.name.replace(/\s/g, '')
    if (seen.has(nm)) continue
    seen.add(nm)
    hits.push({ policy, score })
  }
  return hits
}

/**
 * 프로필 의미 발견 — 사용자가 이미 '자격 있는' 정책들의 임베딩 평균(centroid)에 의미가 가까운
 * 정책을 전체 5천여 건에서 찾아준다. 키워드 규칙이 못 잡은 '숨은 복지'를 AI로 surfacing.
 * ⚠️ AI 모델 다운로드 불필요(사전계산 임베딩만) → 빠르고 항상 동작. 서버 전송 없음.
 *
 * @param seedIds 사용자가 자격 있는 정책 id들(centroid 기준)
 * @param opts.topK 반환 개수, opts.excludeNames 이미 보여준 정책명(공백제거), opts.keep 추가 필터(지역·소득 등)
 */
export async function semanticDiscover(
  seedIds: string[],
  opts: { topK?: number; excludeNames?: Set<string>; keep?: (p: Policy) => boolean } = {},
): Promise<SemanticHit[]> {
  const { topK = 8, excludeNames = new Set(), keep } = opts
  await ensureEmbeddings()
  if (!_vecs) return []
  const dim = _vecs[0]?.length || 0
  const idxOf = new Map(_ids.map((id, i) => [id, i]))
  // centroid = 시드 벡터 평균 → 정규화
  const c = new Float32Array(dim)
  let used = 0
  for (const id of seedIds) {
    const i = idxOf.get(id)
    if (i == null) continue
    const v = _vecs[i]
    for (let j = 0; j < dim; j++) c[j] += v[j]
    used++
  }
  if (used === 0) return []
  let norm = 0
  for (let j = 0; j < dim; j++) norm += c[j] * c[j]
  norm = Math.sqrt(norm) || 1
  for (let j = 0; j < dim; j++) c[j] /= norm
  const pmap = getPolicyMap()
  const seedSet = new Set(seedIds)
  const seen = new Set(excludeNames)
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < _ids.length; i++) {
    const id = _ids[i]
    if (seedSet.has(id)) continue
    const v = _vecs[i]
    let s = 0
    for (let j = 0; j < dim; j++) s += c[j] * v[j]
    scored.push({ id, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const hits: SemanticHit[] = []
  for (const { id, score } of scored) {
    if (hits.length >= topK) break
    if (score < 0.85) break // 의미 유사도 하한(잡음 컷)
    const policy = pmap[id]
    if (!policy) continue
    const nm = policy.name.replace(/\s/g, '')
    if (seen.has(nm)) continue
    if (keep && !keep(policy)) continue
    seen.add(nm)
    hits.push({ policy, score })
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
