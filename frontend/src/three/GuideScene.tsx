import { Canvas } from '@react-three/fiber'
import { FrameCap } from './FrameCap'
import { SproutMascot } from './SproutMascot'

export interface GuideSceneProps { onContextLost?: () => void }

/**
 * 구석 가이드용 초경량 3D — 새싹이만. 히어로(HeroScene)와 달리 부유 소품·그림자·패럴랙스가
 * 없고 dpr 상한 1.5라 구형 PC에서도 부담이 작다. three 청크는 히어로와 공유(추가 다운로드 없음).
 */
export default function GuideScene({ onContextLost }: GuideSceneProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0.35, 6.6], fov: 38 }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => {
        // GPU 컨텍스트 상실 시 빈 원으로 남지 않게 2D 새싹으로 폴백(히어로와 동일 방어)
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.() }, { once: true })
      }}
    >
      <FrameCap fps={24} />
      <hemisphereLight args={['#ffffff', '#d7f5e3', 0.9]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 5]} intensity={1.4} />
      <SproutMascot animate />
    </Canvas>
  )
}
