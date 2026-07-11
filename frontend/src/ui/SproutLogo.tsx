/** 모두봄 새싹 마스코트 — SVG (로고 + 3D 미사용 시 폴백) */
export function SproutLogo({ className = '', withFace = false }: { className?: string; withFace?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="모두봄 새싹 마스코트" fill="none">
      {/* 화분 (+흙 — 3D 마스코트와 동일 구성) */}
      <path d="M18 44 H46 L43 60 H21 Z" fill="#fb923c" />
      <rect x="15" y="40" width="34" height="6" rx="3" fill="#f97316" />
      <ellipse cx="32" cy="41" rx="14" ry="2" fill="#6b4423" />
      {/* 줄기 — 3D와 같은 밝은 초록(#22c55e) */}
      <rect x="30" y="22" width="4" height="20" rx="2" fill="#22c55e" />
      {/* 잎 */}
      <ellipse cx="20" cy="30" rx="10" ry="5" transform="rotate(-28 20 30)" fill="#22c55e" />
      <ellipse cx="44" cy="30" rx="10" ry="5" transform="rotate(28 44 30)" fill="#22c55e" />
      {/* 새싹 머리 */}
      <circle cx="32" cy="18" r="11" fill="#4ade80" />
      <path d="M32 7 q4 -4 7 0 q-3 3 -7 2 Z" fill="#86efac" />
      {withFace && (
        <>
          <circle cx="28.5" cy="18" r="1.6" fill="#1f3d2b" />
          <circle cx="35.5" cy="18" r="1.6" fill="#1f3d2b" />
          {/* 눈 하이라이트 — 3D와 동일 */}
          <circle cx="29.1" cy="17.4" r="0.55" fill="#ffffff" />
          <circle cx="36.1" cy="17.4" r="0.55" fill="#ffffff" />
          <circle cx="26" cy="21" r="2" fill="#fb7185" opacity="0.6" />
          <circle cx="38" cy="21" r="2" fill="#fb7185" opacity="0.6" />
          <path d="M30 22 q2 2 4 0" stroke="#1f3d2b" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
