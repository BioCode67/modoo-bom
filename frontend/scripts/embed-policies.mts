/**
 * 정책 임베딩 사전계산 — 온디바이스 AI 의미 검색용.
 *
 * multilingual-e5-small(384dim)로 시드 정책(정밀 검증 120건)을 임베딩해
 * public/policy-embeddings.json 으로 저장한다. 런타임에는 '질의'만 임베딩(빠름)하고
 * 이 사전계산 벡터와 코사인 유사도로 랭킹한다. 다국어(한/영/베트남어…) 교차검색 가능.
 *
 * 실행: node --experimental-strip-types scripts/embed-policies.mts
 * (또는 npm run embed)
 */
import { pipeline } from '@huggingface/transformers'
import { writeFileSync } from 'node:fs'
import { WELFARE_POLICIES } from '../src/data/policies.ts'

const MODEL = 'Xenova/multilingual-e5-small'
const DIM = 384

console.log(`[embed] 모델 로딩: ${MODEL}`)
const extractor = await pipeline('feature-extraction', MODEL)

async function embed(text: string): Promise<Float32Array> {
  const o = await extractor(text, { pooling: 'mean', normalize: true })
  return o.data as Float32Array
}

const ids: string[] = []
// int16 양자화(정규화 벡터라 [-1,1]) → 용량 축소
const quant = new Int16Array(WELFARE_POLICIES.length * DIM)

let n = 0
for (const p of WELFARE_POLICIES) {
  // e5는 'passage: ' 프리픽스 필요. 정책의 정체성+대상+혜택을 함께 임베딩.
  const text = `passage: ${p.name}. 분류 ${p.category}. 대상 ${p.target}. ${p.benefit} ${p.eligibility}`
  const v = await embed(text)
  for (let i = 0; i < DIM; i++) quant[n * DIM + i] = Math.max(-32767, Math.min(32767, Math.round(v[i] * 32767)))
  ids.push(p.id)
  n++
  if (n % 20 === 0) console.log(`[embed] ${n}/${WELFARE_POLICIES.length}`)
}

const b64 = Buffer.from(quant.buffer).toString('base64')
const out = { model: MODEL, dim: DIM, count: ids.length, ids, data: b64 }
const path = new URL('../public/policy-embeddings.json', import.meta.url)
writeFileSync(path, JSON.stringify(out))
console.log(`[embed] 저장 완료: public/policy-embeddings.json (${ids.length}건, ${(b64.length / 1024).toFixed(0)}KB base64)`)
