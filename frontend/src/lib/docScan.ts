// 서류 촬영 → 제출용 문서 만들기 — 전부 브라우저 안에서 처리(서버 전송 없음, 프라이버시).
//   ① 자동 대비/흑백 보정으로 폰 사진을 '스캔처럼' 읽기 좋게, ② 여러 장을 A4 PDF 한 장씩으로 합쳐 저장.
//   ⚠️ 원근 자동보정('네 귀 인식') 같은 건 넣지 않는다 — 없는 기능을 있는 척하지 않는다(정직성).

/** 자동 대비 경계(저/고 퍼센타일)를 명도 히스토그램에서 구한다 — 스캔 느낌의 대비 스트레치용. */
export function contrastBounds(hist: number[], total: number, cut = 0.02): { lo: number; hi: number } {
  let acc = 0
  let lo = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v] || 0
    if (acc >= total * cut) { lo = v; break }
  }
  acc = 0
  let hi = 255
  for (let v = 255; v >= 0; v--) {
    acc += hist[v] || 0
    if (acc >= total * cut) { hi = v; break }
  }
  if (hi <= lo) { lo = 0; hi = 255 } // 균일 이미지 보호(0 나눗셈 방지)
  return { lo, hi }
}

/** 폰 사진 보정 — 명도 히스토그램 스트레치(자동 대비) + 선택적 흑백. ImageData 제자리 수정 후 반환.
 *  흑백 모드는 계약서·인쇄물 가독을 높이고, 컬러 모드는 신분증(색·홀로그램)을 보존한다. */
export function enhanceImageData(img: { data: Uint8ClampedArray | number[]; width: number; height: number }, opts: { grayscale?: boolean } = {}): typeof img {
  const d = img.data
  const n = d.length
  const hist = new Array(256).fill(0)
  for (let i = 0; i < n; i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    hist[y < 0 ? 0 : y > 255 ? 255 : y]++
  }
  const total = n / 4
  const { lo, hi } = contrastBounds(hist, total)
  const scale = 255 / (hi - lo)
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let i = 0; i < n; i += 4) {
    if (opts.grayscale) {
      const y = clamp((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 - lo) * scale)
      d[i] = d[i + 1] = d[i + 2] = y
    } else {
      d[i] = clamp((d[i] - lo) * scale)
      d[i + 1] = clamp((d[i + 1] - lo) * scale)
      d[i + 2] = clamp((d[i + 2] - lo) * scale)
    }
    // 알파(d[i+3])는 유지
  }
  return img
}

/** data URL('data:image/jpeg;base64,...')에서 순수 바이트 추출. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  if (/;base64/i.test(meta)) {
    const bin = atob(data)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(data))
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

export interface PdfPage { jpeg: Uint8Array; width: number; height: number }

/** 여러 JPEG 페이지를 A4 PDF 한 장씩으로 합친다. JPEG 바이트를 DCTDecode로 '그대로' 임베드(재인코딩 없음 →
 *  화질 손실·용량 증가 없음). 각 페이지는 A4에 여백 두고 비율 유지로 가운데 배치. 표준 PDF 1.3 구조. */
export function jpegPagesToPdf(pages: PdfPage[]): Uint8Array {
  const A4W = 595, A4H = 842, M = 24 // A4(pt), 여백
  const enc = (s: string) => new TextEncoder().encode(s)
  const chunks: Uint8Array[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (u: Uint8Array) => { chunks.push(u); offset += u.length }
  const pushObj = (num: number, body: Uint8Array) => {
    offsets[num] = offset
    push(enc(`${num} 0 obj\n`))
    push(body)
    push(enc(`\nendobj\n`))
  }

  const objs: { num: number; body: Uint8Array }[] = []
  const kids: number[] = []
  let next = 3 // 1=catalog, 2=pages
  for (const { jpeg, width, height } of pages) {
    const maxW = A4W - 2 * M, maxH = A4H - 2 * M
    const s = Math.min(maxW / width, maxH / height)
    const w = width * s, h = height * s
    const x = (A4W - w) / 2, y = (A4H - h) / 2
    const imgNum = next++, contentNum = next++, pageNum = next++
    kids.push(pageNum)
    objs.push({ num: imgNum, body: concatBytes([
      enc(`<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n`),
      jpeg,
      enc(`\nendstream`),
    ]) })
    const content = enc(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`)
    objs.push({ num: contentNum, body: concatBytes([enc(`<</Length ${content.length}>>\nstream\n`), content, enc(`\nendstream`)]) })
    objs.push({ num: pageNum, body: enc(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${A4W} ${A4H}]/Resources<</XObject<</Im0 ${imgNum} 0 R>>>>/Contents ${contentNum} 0 R>>`) })
  }

  const allObjs = [
    { num: 1, body: enc(`<</Type/Catalog/Pages 2 0 R>>`) },
    { num: 2, body: enc(`<</Type/Pages/Kids[${kids.map((k) => `${k} 0 R`).join(' ')}]/Count ${pages.length}>>`) },
    ...objs,
  ].sort((a, b) => a.num - b.num)

  push(enc(`%PDF-1.3\n`))
  for (const o of allObjs) pushObj(o.num, o.body)
  const xrefOffset = offset
  const count = allObjs.length + 1 // 0번(free) 포함
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(enc(xref))
  push(enc(`trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`))
  return concatBytes(chunks)
}
