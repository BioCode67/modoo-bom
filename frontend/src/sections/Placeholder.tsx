import { StaticMascot } from '@/three/MascotCanvas'

/** P2~P4에서 실제 화면으로 대체될 임시 자리표시 */
export function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="page-container py-20 text-center">
      <div className="mx-auto h-40 w-40"><StaticMascot /></div>
      <h2 className="mt-4 text-2xl font-extrabold">{title}</h2>
      <p className="mt-2 text-muted-foreground">{desc}</p>
      <span className="chip-sprout mt-4 inline-flex">곧 만나요 🌱</span>
    </div>
  )
}
