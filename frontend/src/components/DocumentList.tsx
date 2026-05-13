import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { RetrievedDoc } from '@/types'
import { FileCheck2, FileX2, ExternalLink, Download } from 'lucide-react'

interface Props {
  docs: RetrievedDoc[]
}

export function DocumentList({ docs }: Props) {
  if (docs.length === 0) return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">취득한 서류가 없습니다.</CardContent>
    </Card>
  )

  const success = docs.filter((d) => d.success)
  const failed = docs.filter((d) => !d.success)

  return (
    <div className="space-y-4">
      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{success.length}</p>
          <p className="text-sm text-green-600">자동 취득 완료</p>
        </div>
        <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 text-center">
          <p className="text-2xl font-bold text-orange-700">{failed.length}</p>
          <p className="text-sm text-orange-600">수동 발급 필요</p>
        </div>
      </div>

      {/* 성공 서류 */}
      {success.map((doc) => (
        <Card key={doc.receipt_number ?? doc.doc_name} className="border-green-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-green-600" />
                <CardTitle className="text-base">{doc.doc_name}</CardTitle>
              </div>
              <Badge variant="success">취득 완료</Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
              <span>발급기관</span><span className="text-foreground">{doc.issuing_org}</span>
              <span>수령인</span><span className="text-foreground">{doc.issued_for}</span>
              <span>접수번호</span><span className="text-foreground font-mono text-xs">{doc.receipt_number}</span>
              <span>발급일</span><span className="text-foreground">{doc.issued_at?.split('T')[0]}</span>
              <span>유효기간</span><span className="text-foreground">{doc.validity_days}일</span>
            </div>
            {doc.download_url && (
              <a href={doc.download_url} className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline">
                <Download className="h-3 w-3" /> 다운로드
              </a>
            )}
          </CardContent>
        </Card>
      ))}

      {/* 실패 서류 */}
      {failed.map((doc, i) => (
        <Card key={`${doc.doc_name}-${i}`} className="border-orange-200 bg-orange-50/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileX2 className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-base">{doc.doc_name}</CardTitle>
              </div>
              <Badge variant="warning">{doc.manual_required ? '수동 발급' : '발급 실패'}</Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>{doc.error}</p>
            {doc.fallback_message && <p className="text-orange-700">{doc.fallback_message}</p>}
            {doc.fallback_url && (
              <a href={doc.fallback_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> 발급 페이지 바로가기
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
