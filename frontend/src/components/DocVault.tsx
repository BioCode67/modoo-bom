import { Fragment, useCallback, useEffect, useState } from 'react'
import { Eye, FolderOpen, RefreshCw, Trash2, FileText, Image as ImageIcon, Paperclip, FolderDown } from 'lucide-react'
import { getRpaBase } from '@/lib/backend'
import { downloadDocsBundle } from '@/lib/bundleDocs'
import { groupVaultDocs } from '@/lib/vaultGroups'
import { cn } from '@/lib/utils'

/** 서류함 항목(백엔드 /api/documents/list 응답) */
interface VaultDoc {
  filename: string
  display: string
  doc_type: string
  ext: string
  size: number
  mtime: number
  age_days: number
  /** 발급형 증명서만 계산됨(통상 '발급 3개월 이내' 제출 요구) — 소지 서류(계약서·신분증)는 null */
  validity: 'fresh' | 'aging' | 'stale' | null
  attach_candidate: boolean
}

/** registerBlob·발급 완료 후 서류함을 즉시 갱신시키는 커스텀 이벤트 이름 */
export const DOCS_CHANGED_EVENT = 'modoobom:docs-changed'
export function notifyDocsChanged() {
  try { window.dispatchEvent(new Event(DOCS_CHANGED_EVENT)) } catch { /* SSR 등 무시 */ }
}

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : b >= 1024 ? `${Math.round(b / 1024)}KB` : `${b}B`)
const fmtWhen = (mtime: number) => {
  const diff = Date.now() / 1000 - mtime
  if (diff < 90) return '방금'
  if (diff < 3600) return `${Math.round(diff / 60)}분 전`
  if (diff < 86400) return `${Math.round(diff / 3600)}시간 전`
  const d = new Date(mtime * 1000)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 🗂 내 서류함 — 이 PC의 발급/등록 서류를 앱 안에서 가시화(데스크탑 에이전트 전용).
 * '지금 신청하면 자동으로 첨부될 후보'를 서버 기준(attach_candidate)으로 보여줘, 자동첨부가
 * 보이지 않는 마법이 아니라 확인 가능한 상태가 되게 한다. 삭제로 잘못된/지난 서류(PII)도 즉시 정리.
 */
export function DocVault() {
  const [docs, setDocs] = useState<VaultDoc[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null) // 파일명 — 2탭 확인(오삭제 방지)
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({}) // 종류별 '이전 버전' 펼침 상태

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${getRpaBase()}/api/documents/list`)
      if (!r.ok) throw new Error(`목록 실패(${r.status})`)
      const j = await r.json()
      setDocs(Array.isArray(j.documents) ? j.documents : [])
      setErr('')
    } catch {
      setErr('서류함을 불러오지 못했어요 — 아래 "폴더 열기"로 직접 확인할 수 있어요.')
      setDocs([])
    }
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(DOCS_CHANGED_EVENT, load)
    // 정부 사이트 탭에서 발급을 마치고 돌아온 순간에도 갱신(발급물이 폴더에 새로 생겼을 수 있음)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener(DOCS_CHANGED_EVENT, load); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const del = async (filename: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`${getRpaBase()}/api/documents/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }),
      })
      if (!r.ok) { const d = await r.json().then((x) => x?.detail).catch(() => ''); throw new Error(d || '삭제 실패') }
      setConfirmDel(null)
      notifyDocsChanged() // 자체 목록 + 문서센터의 '서류함 보유' 인덱스(부족분만 발급)까지 함께 갱신
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  const openFolder = () => { fetch(`${getRpaBase()}/api/documents/open-folder`, { method: 'POST' }).catch(() => {}) }

  // 📦 종류별 최신 1건씩 ZIP — 복지로 수동 첨부·이메일 제출처럼 '흩어진 발급물을 한 번에' 옮길 때
  const [zipBusy, setZipBusy] = useState(false)
  const bundleAll = async () => {
    if (zipBusy) return
    setZipBusy(true)
    try {
      await downloadDocsBundle() // 종류별 최신 1건 전체 — 파일명은 서버 Content-Disposition 존중
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '서류 묶음에 실패했어요.')
    } finally {
      setZipBusy(false)
    }
  }

  if (docs === null) return null // 첫 로드 전엔 자리 차지하지 않음
  const candidates = docs.filter((d) => d.attach_candidate)
  // 종류별 그룹 — 화면도 묶음ZIP·자동첨부와 같은 '종류별 최신 1건' 기준으로 정리(재발급이 쌓여도 깔끔)
  const groups = groupVaultDocs(docs)

  const row = (d: VaultDoc, old = false) => (
    <li key={d.filename} className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sky2-100 bg-white px-3 py-1.5', old && 'ml-5 border-dashed bg-sky2-50/40')}>
      {d.ext === 'pdf' ? <FileText className="h-4 w-4 shrink-0 text-sky2-500" /> : <ImageIcon className="h-4 w-4 shrink-0 text-sky2-500" />}
      <span className={cn('min-w-[8rem] flex-1 text-xs font-semibold break-all', old && 'text-muted-foreground')}>{d.display}</span>
      {old && <span title="같은 종류의 더 새 발급본이 있어요 — 묶음 ZIP·자동첨부는 최신본만 써요" className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">이전 버전</span>}
      {!old && d.attach_candidate && <span title="지금 신청하면 자동첨부 후보" className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-sprout-100 px-1.5 py-0.5 text-[10px] font-bold text-sprout-700"><Paperclip className="h-3 w-3" /> 첨부 후보</span>}
      {d.validity === 'stale' && <span title={`발급 ${d.age_days}일 지남 — 관공서 제출용 증명서는 통상 '발급 3개월 이내'를 요구해요(기관별 상이). 다시 발급을 권해요.`} className="shrink-0 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">⚠️ 3개월 지남</span>}
      {d.validity === 'aging' && <span title={`발급 ${d.age_days}일째 — 제출처가 '3개월 이내'를 요구하면 곧 만료돼요. 제출 예정이면 유효기간을 확인하세요.`} className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">유효 확인</span>}
      <span className="shrink-0 text-[10px] text-muted-foreground">{d.ext.toUpperCase()} · {fmtSize(d.size)} · {fmtWhen(d.mtime)}</span>
      {/* 👁 제출 전 눈으로 확인 — 새 탭 인라인 열람(본인 PC 전용 엔드포인트) */}
      <a href={`${getRpaBase()}/api/documents/file?name=${encodeURIComponent(d.filename)}`}
        target="_blank" rel="noopener noreferrer" aria-label={`${d.display} 보기`} title="새 탭에서 열어 내용 확인(제출 전 점검)"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-sky2-50 hover:text-sky2-600">
        <Eye className="h-3.5 w-3.5" />
      </a>
      {confirmDel === d.filename ? (
        <span className="shrink-0 inline-flex items-center gap-1">
          <button onClick={() => del(d.filename)} disabled={busy} className="rounded-md bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-600 disabled:opacity-50">삭제</button>
          <button onClick={() => setConfirmDel(null)} className="rounded-md border border-sky2-200 px-2 py-0.5 text-[10px] font-semibold">취소</button>
        </span>
      ) : (
        <button onClick={() => setConfirmDel(d.filename)} aria-label={`${d.display} 삭제`} title="이 서류 삭제(내 PC에서 제거)"
          className={cn('shrink-0 rounded-md p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-500', busy && 'opacity-50')}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )

  return (
    <div className="mt-4 rounded-2xl border-2 border-sky2-100 bg-sky2-50/40 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold flex items-center gap-1.5">🗂 내 서류함 <span className="text-xs font-semibold text-muted-foreground">({groups.length}종 {docs.length}건 · 이 PC에만 저장)</span></p>
        <div className="ml-auto flex gap-1.5">
          <button onClick={load} title="새로고침" aria-label="서류함 새로고침" className="rounded-lg border border-sky2-200 bg-white p-1.5 text-sky2-700 hover:bg-sky2-50"><RefreshCw className="h-3.5 w-3.5" /></button>
          {docs.length > 0 && (
            <button onClick={bundleAll} disabled={zipBusy}
              title="서류 종류별 최신 1건씩 ZIP 한 파일로 — 복지로 수동 첨부·이메일 제출용"
              className="rounded-lg border border-sky2-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky2-700 hover:bg-sky2-50 inline-flex items-center gap-1 disabled:opacity-50">
              <FolderDown className="h-3.5 w-3.5" /> {zipBusy ? '묶는 중…' : '묶음 받기(ZIP)'}
            </button>
          )}
          <button onClick={openFolder} className="rounded-lg border border-sky2-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky2-700 hover:bg-sky2-50 inline-flex items-center gap-1"><FolderOpen className="h-3.5 w-3.5" /> 폴더 열기</button>
        </div>
      </div>
      {/* 자동첨부 가시화 — '보이지 않는 마법' 대신 확인 가능한 상태로 */}
      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
        {candidates.length > 0
          ? <>📎 지금 에이전트로 신청하면 <b className="text-sky2-700">{candidates.length}종</b>이 자동첨부 후보예요: {candidates.slice(0, 4).map((d) => d.display).join(' · ')}{candidates.length > 4 ? ' 외' : ''} <span className="text-muted-foreground">(신청 양식의 첨부칸 이름과 맞는 것만 실제로 붙어요)</span></>
          : docs.length > 0
            ? '최근 발급/등록분이 없어 자동첨부 후보가 없어요 — 신청 직전에 발급·등록하면 자동첨부돼요.'
            : '아직 서류가 없어요 — 위에서 자동발급하거나 📷 촬영·📎 파일로 등록하면 여기에 모여요.'}
      </p>
      {docs.some((d) => d.validity === 'stale') && (
        <p className="mt-1 text-[11px] font-semibold text-rose-600">
          ⚠️ {docs.filter((d) => d.validity === 'stale').length}건은 발급 3개월이 지났어요 — 제출처에 따라 재발급이 필요할 수 있어요(위 [자동발급]으로 다시 뗄 수 있어요).
        </p>
      )}
      {err && <p className="mt-1 text-[11px] font-medium text-rose-600">{err}</p>}
      {groups.length > 0 && (
        <ul className="mt-2 space-y-1">
          {groups.slice(0, 8).map((g) => (
            <Fragment key={g.type}>
              {row(g.latest)}
              {g.older.length > 0 && (
                <li className="ml-5 flex items-center gap-3">
                  <button onClick={() => setOpenTypes((s) => ({ ...s, [g.type]: !s[g.type] }))}
                    aria-expanded={!!openTypes[g.type]}
                    className="text-[11px] font-semibold text-sky2-700 hover:underline">
                    {openTypes[g.type] ? '▾ 이전 버전 접기' : `▸ 이전 버전 ${g.older.length}건 보기`}
                  </button>
                  {/* 🧹 지난 발급본 일괄 정리 — 최신본은 남기고 이전본만(재발급이 쌓인 PII 파일 청소) */}
                  <button
                    onClick={async () => {
                      if (busy) return
                      if (!window.confirm(`「${g.type}」 이전 버전 ${g.older.length}건을 지울까요?\n(최신본은 그대로 남아요 — 지운 파일은 되돌릴 수 없어요)`)) return
                      setBusy(true)
                      try {
                        for (const old of g.older) {
                          await fetch(`${getRpaBase()}/api/documents/delete`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: old.filename }),
                          }).catch(() => { /* 개별 실패는 목록 갱신으로 드러남(은폐 없음) */ })
                        }
                        notifyDocsChanged()
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="text-[11px] font-semibold text-muted-foreground/80 hover:text-rose-600 hover:underline disabled:opacity-50"
                    disabled={busy}>
                    🧹 이전 버전 정리
                  </button>
                </li>
              )}
              {openTypes[g.type] && g.older.map((d) => row(d, true))}
            </Fragment>
          ))}
          {groups.length > 8 && <li className="text-center text-[11px] text-muted-foreground">… 외 {groups.length - 8}종은 폴더에서 확인</li>}
        </ul>
      )}
    </div>
  )
}
