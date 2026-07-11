/**
 * 정책 임베딩 사전계산 — 온디바이스 AI 의미 검색용.
 *
 * multilingual-e5-small(384dim)로 통합 카탈로그(시드 + 공공데이터 public/policies.json)를
 * 임베딩해 public/policy-embeddings.json 으로 저장한다. 런타임에는 '질의'만 임베딩(빠름)하고
 * 이 사전계산 벡터와 코사인 유사도로 랭킹한다. 다국어(한/영/베트남어…) 교차검색 가능.
 *
 * 시드와 이름이 겹치는 외부 정책은 스킵(런타임 카탈로그 병합 규칙과 일치 → id가 MAP에 존재).
 *
 * 실행: npm run embed  (node --experimental-strip-types scripts/embed-policies.mts)
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

// ── 통합 카탈로그 구성(런타임 catalog.ts 병합 규칙과 동일: 시드 우선, 외부 동명 스킵) ──
// 시드 = 정부(POL)+민간재단(PRV)+청년주택(HOU)+정부지원사업(SUP)+정책서민금융(FIN) — catalog.ts SEED_POLICIES와 일치
const SEEDS: Policy[] = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]
const policies: Policy[] = [...SEEDS]
const seedNames = new Set(SEEDS.map((p) => p.name.replace(/\s/g, '')))
try {
  const ext = JSON.parse(readFileSync(new URL('../public/policies.json', import.meta.url), 'utf-8'))
  const list: Policy[] = Array.isArray(ext) ? ext : ext.policies || []
  for (const raw of list) {
    const name = String(raw?.name || '')
    const id = String(raw?.id || '')
    if (!id || !name) continue
    if (seedNames.has(name.replace(/\s/g, ''))) continue // 시드 동명 스킵
    policies.push(raw as Policy)
  }
  console.log(`[embed] 통합 카탈로그: 시드 ${WELFARE_POLICIES.length} + 외부 → 총 ${policies.length}건`)
} catch (e) {
  console.log(`[embed] 외부 policies.json 없음/실패 — 시드만 임베딩 (${(e as Error).message})`)
}

console.log(`[embed] 모델 로딩: ${MODEL}`)
const extractor = await pipeline('feature-extraction', MODEL)

async function embed(text: string): Promise<Float32Array> {
  const o = await extractor(text, { pooling: 'mean', normalize: true })
  return o.data as Float32Array
}

// 정책의 정체성을 담되 중복 문구(공공데이터는 target=benefit=eligibility 인 경우多)는 정리.
// ⚠️ 전체를 .slice(0,800)로 꼬리 절단하면 긴 정책에서 eligibility(자격)가 통째로 유실된다 →
//    필드별 예산(대상 300·혜택 260·자격 240자)을 배분해 세 필드가 항상 패시지에 대표되게 한다.
//    남는 예산은 앞 필드부터 재사용(짧은 정책은 기존과 동일한 전문 포함).
function passageOf(p: Policy): string {
  const head = `passage: ${p.name}. 분류 ${p.category}. `
  const parts = [p.target, p.benefit, p.eligibility].map((s) => (s || '').trim())
  const uniq: string[] = []
  for (const s of parts) if (s && !uniq.includes(s)) uniq.push(s)
  const budgets = [300, 260, 240]
  let spare = 0
  const cut = uniq.map((s, i) => {
    const b = (budgets[i] ?? 200) + spare
    const t = s.slice(0, b)
    spare = Math.max(0, b - t.length)
    return t
  })
  return (head + cut.join(' ')).slice(0, 800)
}

const ids: string[] = []
const quant = new Int16Array(policies.length * DIM)
let n = 0
for (const p of policies) {
  const v = await embed(passageOf(p))
  for (let i = 0; i < DIM; i++) quant[n * DIM + i] = Math.max(-32767, Math.min(32767, Math.round(v[i] * 32767)))
  ids.push(p.id)
  n++
  if (n % 200 === 0) console.log(`[embed] ${n}/${policies.length}`)
}

const b64 = Buffer.from(quant.buffer).toString('base64')
const out = { model: MODEL, dim: DIM, count: ids.length, ids, data: b64 }
writeFileSync(new URL('../public/policy-embeddings.json', import.meta.url), JSON.stringify(out))
console.log(`[embed] 저장 완료: public/policy-embeddings.json (${ids.length}건, ${(b64.length / 1024 / 1024).toFixed(1)}MB base64)`)
