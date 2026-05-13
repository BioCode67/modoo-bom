import { Card, CardContent } from '@/components/ui/card'
import type { RetrievedDoc } from '@/types'
import { FileCheck2, FileX2, ExternalLink, Download, Eye, Calendar, Hash } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`

interface Props {
  docs: RetrievedDoc[]
}

export function DocumentList({ docs }: Props) {
  if (docs.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-16 text-center text-muted-foreground text-sm">
        취득한 서류가 없습니다.
      </CardContent>
    </Card>
  )

  const success = docs.filter((d) => d.success)
  const failed = docs.filter((d) => !d.success)

  return (
    <div className="space-y-5">
      {/* 요약 배너 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200/60 p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <FileCheck2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-700">{success.length}</p>
            <p className="text-xs text-emerald-600 font-medium">자동 취득 완료</p>
          </div>
        </div>
        <div className="rounded-2xl bg-orange-50 border border-orange-200/60 p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
            <FileX2 className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-700">{failed.length}</p>
            <p className="text-xs text-orange-600 font-medium">수동 발급 필요</p>
          </div>
        </div>
      </div>

      {/* 성공 서류 */}
      {success.map((doc) => (
        <Card key={doc.receipt_number ?? doc.doc_name} className="border-emerald-200/60 shadow-sm overflow-hidden">
          <div className="h-1 bg-emerald-400" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <FileCheck2 className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{doc.doc_name}</h3>
                  <p className="text-xs text-muted-foreground">{doc.issuing_org}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold px-2.5 py-1">
                ✓ 취득 완료
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-4 text-xs">
              {[
                { icon: Hash, label: '접수번호', value: doc.receipt_number },
                { icon: Calendar, label: '발급일', value: doc.issued_at?.split('T')[0] },
                { icon: FileCheck2, label: '수령인', value: doc.issued_for },
                { icon: Calendar, label: '유효기간', value: doc.validity_days ? `${doc.validity_days}일` : undefined },
              ].filter(f => f.value).map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground ml-auto truncate">{value}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {doc.preview_url && (
                <a
                  href={`${API_BASE}${doc.preview_url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
                >
                  <Eye className="h-3.5 w-3.5" /> 문서 미리보기
                </a>
              )}
              {doc.download_url && (
                <a
                  href={doc.preview_url ? `${API_BASE}${doc.preview_url}` : doc.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input bg-background text-xs font-semibold hover:bg-accent transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> 인쇄 / PDF 저장
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* 실패 서류 */}
      {failed.map((doc, i) => (
        <Card key={`${doc.doc_name}-${i}`} className="border-orange-200/60 shadow-sm overflow-hidden">
          <div className="h-1 bg-orange-400" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                  <FileX2 className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{doc.doc_name}</h3>
                  <p className="text-xs text-muted-foreground">{doc.error}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-orange-100 text-orange-700 text-[11px] font-semibold px-2.5 py-1">
                {doc.manual_required ? '수동 발급' : '발급 실패'}
              </span>
            </div>

            {doc.fallback_message && (
              <div className="rounded-xl bg-orange-50 border border-orange-100 px-3 py-2 mb-3">
                <p className="text-xs text-orange-700">{doc.fallback_message}</p>
              </div>
            )}

            {doc.fallback_url && (
              <a
                href={doc.fallback_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> 발급 페이지 바로가기
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
