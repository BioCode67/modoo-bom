import { getRpaBase } from '@/lib/backend'

/**
 * 📦 서류함 ZIP 내려받기 — DocVault·여정 종결 배너가 공유하는 단일 다운로드 경로.
 * docs 를 비우면 종류별 최신 1건 전체. 서버가 정한 파일명(Content-Disposition)을 존중한다.
 * 실패 시 서버의 정직한 사유(detail)를 그대로 throw — 호출부가 사용자에게 보여준다.
 */
export async function downloadDocsBundle(docs: string[] = [], label = ''): Promise<void> {
  const r = await fetch(`${getRpaBase()}/api/documents/bundle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docs, label }),
  })
  if (!r.ok) {
    const d = await r.json().then((x) => x?.detail).catch(() => '')
    throw new Error(d || `서류 묶음 실패(${r.status})`)
  }
  const blob = await r.blob()
  const cd = r.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
  const name = m ? decodeURIComponent(m[1]) : '신청서류.zip'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
