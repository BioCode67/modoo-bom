// 헤드라인 검증 — 온디바이스 다국어 AI 의미검색 실품질.
// 모델(multilingual-e5-small)을 node에서 로드해 다국어 질의를 임베딩하고,
// 사전계산 정책 벡터(public/policy-embeddings.json)와 코사인 상위매칭을 출력.
// 런타임(semanticSearch.ts)과 동일 방식: query: 접두사 + POL- 시드 소폭 가점(0.04).
import { pipeline, env } from '@huggingface/transformers'
import { readFileSync } from 'node:fs'

env.allowLocalModels = false
const ef = JSON.parse(readFileSync(new URL('../public/policy-embeddings.json', import.meta.url), 'utf-8'))
const pub = JSON.parse(readFileSync(new URL('../public/policies.json', import.meta.url), 'utf-8'))
const pubList = Array.isArray(pub) ? pub : pub.policies
// 이름 조회용: 공공데이터 + (시드는 id만 있으면 표시) — 여기선 공공+id 표기로 충분
const nameById = {}
for (const p of pubList) nameById[p.id] = p.name
// 시드(POL/PRV) 이름은 .ts에서 정규식으로 추출(id 다음에 나오는 name 매칭)
for (const f of ['../src/data/policies.ts', '../src/data/privatePolicies.ts']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf-8')
  const re = /id:\s*'((?:POL|PRV)-[^']+)'[\s\S]{0,120}?name:\s*'([^']+)'/g
  let m
  while ((m = re.exec(src)) !== null) nameById[m[1]] = m[2]
}

// int16 base64 → Float32 벡터
const bin = Buffer.from(ef.data, 'base64')
const q16 = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2)
const dim = ef.dim, n = ef.count
function vec(i) { const v = new Float32Array(dim); for (let j = 0; j < dim; j++) v[j] = q16[i * dim + j] / 32767; return v }
const vecs = []; for (let i = 0; i < n; i++) vecs.push(vec(i))

console.log(`정책 벡터 ${n}건 로드. 모델 다운로드/로드 중…`)
const extractor = await pipeline('feature-extraction', ef.model || 'Xenova/multilingual-e5-small')

const QUERIES = [
  ['한국어', '일자리를 잃어서 당장 생활비가 없어요'],
  ['English', 'I lost my job and I have no money to live'],
  ['Tiếng Việt', 'Tôi bị mất việc và không có tiền sinh hoạt'],
  ['한국어', '혼자 아이를 키우는데 도움이 필요해요'],
  ['English', 'I am a single mother raising a child alone'],
  ['한국어', '나이가 많고 소득이 적은 노인이에요'],
  ['中文', '我是残疾人，需要医疗费用支持'],
]

async function embed(q) {
  const out = await extractor(`query: ${q}`, { pooling: 'mean', normalize: true })
  return out.data
}

for (const [lang, q] of QUERIES) {
  const qv = await embed(q)
  const scored = []
  for (let i = 0; i < n; i++) {
    const pv = vecs[i]; let s = 0
    for (let j = 0; j < dim; j++) s += qv[j] * pv[j]
    if (ef.ids[i].charCodeAt(0) === 80) s += 0.04 // POL 가점
    scored.push([ef.ids[i], s])
  }
  scored.sort((a, b) => b[1] - a[1])
  console.log(`\n[${lang}] "${q}"`)
  scored.slice(0, 5).forEach(([id, s]) => console.log(`   ${s.toFixed(3)} ${id.split('-')[0]} ${nameById[id] || id}`))
}
console.log('\n(POL/PRV 시드 이름은 public에 없어 id로 표시될 수 있음 — 의미 매칭 방향성 확인용)')
