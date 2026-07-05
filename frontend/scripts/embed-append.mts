/**
 * 임베딩 증분 추가 — 시드(정부+민간재단)에 새로 들어온 정책만 임베딩해
 * 기존 public/policy-embeddings.json 에 append 한다.
 *
 * 전체 재생성(npm run embed, ~5,000건)은 수십 분 걸리므로, 시드 몇 건 추가 시엔 이걸 사용.
 * passage 템플릿·양자화(Int16 * 32767)는 embed-policies.mts 와 동일해야 벡터 공간이 일치한다.
 *
 * 실행: node --experimental-strip-types scripts/embed-append.mts
 */
import { pipeline } from '@huggingface/transformers'
import { readFileSync, writeFileSync } from 'node:fs'
import { WELFARE_POLICIES, type Policy } from '../src/data/policies.ts'
import { PRIVATE_POLICIES } from '../src/data/privatePolicies.ts'
import { HOUSING_POLICIES } from '../src/data/housingPolicies.ts'
import { GOV_PROGRAMS } from '../src/data/govPrograms.ts'
import { FINANCIAL_POLICIES } from '../src/data/financialPolicies.ts'

const MODEL = 'Xenova/multilingual-e5-small'
const DIM = 384
const OUT = new URL('../public/policy-embeddings.json', import.meta.url)

// embed-policies.mts 의 passageOf 와 반드시 동일하게 유지
function passageOf(p: Policy): string {
  const parts = [p.target, p.benefit, p.eligibility].map((s) => (s || '').trim()).filter(Boolean)
  const uniq = [...new Set(parts)]
  return `passage: ${p.name}. 분류 ${p.category}. ${uniq.join(' ')}`.slice(0, 800)
}

const existing = JSON.parse(readFileSync(OUT, 'utf-8')) as { model: string; dim: number; count: number; ids: string[]; data: string }
if (existing.model !== MODEL || existing.dim !== DIM) {
  console.error(`[append] 모델/차원 불일치(${existing.model}/${existing.dim}) — 전체 재생성(npm run embed) 필요`)
  process.exit(1)
}
const have = new Set(existing.ids)
// 카탈로그 SEED와 동일하게 — 청년주택(HOU)·정부지원사업(SUP)·정책서민금융(FIN)도 의미검색 대상에 포함
const seeds: Policy[] = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]
// ⚠️ 외부 공공데이터(public/policies.json의 GOV-/LOC-)도 대상 — 이게 빠지면 '5천건 AI검색' 헤드라인이
//    해당 정책에선 거짓이 되고, 상세의 'AI로 비슷한 복지'가 조용히 0건이 된다(감사 실측).
let external: Policy[] = []
try {
  const raw = JSON.parse(readFileSync(new URL('../public/policies.json', import.meta.url), 'utf-8'))
  external = (Array.isArray(raw) ? raw : raw.policies || []) as Policy[]
} catch { /* 외부 파일 없으면 시드만 */ }
const seedNames = new Set(seeds.map((p) => (p.name || '').replace(/\s/g, '')))
// 런타임 catalog.ts dedup과 동일: LOC-는 지역별 동명사업이라 항상 유지, 그 외만 이름중복 제거(시드 우선)
const catalog: Policy[] = [...seeds, ...external.filter((p) =>
  p && p.id && (String(p.id).startsWith('LOC-') || !seedNames.has((p.name || '').replace(/\s/g, ''))))]
const missing = catalog.filter((p) => !have.has(p.id))
if (missing.length === 0) {
  console.log('[append] 누락 시드 없음 — 변경 없이 종료')
  process.exit(0)
}
console.log(`[append] 누락 시드 ${missing.length}건 임베딩: ${missing.map((p) => p.id).join(', ')}`)

console.log(`[append] 모델 로딩: ${MODEL}`)
const extractor = await pipeline('feature-extraction', MODEL)

const oldBuf = Buffer.from(existing.data, 'base64')
const oldArr = new Int16Array(oldBuf.buffer, oldBuf.byteOffset, existing.count * DIM)
const quant = new Int16Array((existing.count + missing.length) * DIM)
quant.set(oldArr, 0)

let n = existing.count
for (const p of missing) {
  const o = await extractor(passageOf(p), { pooling: 'mean', normalize: true })
  const v = o.data as Float32Array
  for (let i = 0; i < DIM; i++) quant[n * DIM + i] = Math.max(-32767, Math.min(32767, Math.round(v[i] * 32767)))
  n++
}

const out = {
  model: MODEL, dim: DIM, count: n,
  ids: [...existing.ids, ...missing.map((p) => p.id)],
  data: Buffer.from(quant.buffer).toString('base64'),
}
writeFileSync(OUT, JSON.stringify(out))
console.log(`[append] 저장 완료: ${existing.count} → ${n}건`)
