import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

/**
 * 모두봄 마스코트 — 화분에서 자라는 귀여운 새싹.
 * three 프리미티브만 사용(외부 에셋 X) → 오프라인/정적 배포 안전.
 */
export function SproutMascot({ animate = true }: { animate?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const leftLeaf = useRef<THREE.Mesh>(null)
  const rightLeaf = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!animate) return
    const t = state.clock.elapsedTime
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.4) * 0.12
      group.current.rotation.z = Math.sin(t * 0.8) * 0.04
    }
    // 잎사귀 살랑살랑
    if (leftLeaf.current) leftLeaf.current.rotation.z = 0.5 + Math.sin(t * 2) * 0.12
    if (rightLeaf.current) rightLeaf.current.rotation.z = -0.5 - Math.sin(t * 2 + 0.6) * 0.12
  })

  return (
    <group ref={group} scale={1.15}>
      {/* 화분 (아래가 좁은 사다리꼴) */}
      <mesh position={[0, -1.05, 0]} castShadow>
        <cylinderGeometry args={[0.95, 0.7, 0.95, 32]} />
        <meshStandardMaterial color="#fb923c" roughness={0.55} />
      </mesh>
      {/* 화분 테두리 */}
      <mesh position={[0, -0.58, 0]} castShadow>
        <cylinderGeometry args={[1.02, 1.0, 0.28, 32]} />
        <meshStandardMaterial color="#f97316" roughness={0.5} />
      </mesh>
      {/* 흙 */}
      <mesh position={[0, -0.46, 0]}>
        <cylinderGeometry args={[0.93, 0.93, 0.12, 32]} />
        <meshStandardMaterial color="#6b4423" roughness={0.9} />
      </mesh>

      {/* 줄기 */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1.2, 16]} />
        <meshStandardMaterial color="#22c55e" roughness={0.4} />
      </mesh>

      {/* 새싹 몸통(둥근 머리) */}
      <mesh position={[0, 0.85, 0]} castShadow>
        <sphereGeometry args={[0.62, 32, 32]} />
        <meshStandardMaterial color="#4ade80" roughness={0.35} />
      </mesh>

      {/* 잎사귀 좌/우 (납작한 구체) */}
      <mesh ref={leftLeaf} position={[-0.6, 0.55, 0]} rotation={[0, 0, 0.5]} scale={[0.55, 0.28, 0.4]} castShadow>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial color="#22c55e" roughness={0.4} />
      </mesh>
      <mesh ref={rightLeaf} position={[0.6, 0.55, 0]} rotation={[0, 0, -0.5]} scale={[0.55, 0.28, 0.4]} castShadow>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial color="#22c55e" roughness={0.4} />
      </mesh>

      {/* 눈 */}
      <mesh position={[-0.22, 0.92, 0.55]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#1f3d2b" />
      </mesh>
      <mesh position={[0.22, 0.92, 0.55]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#1f3d2b" />
      </mesh>
      {/* 눈 하이라이트 */}
      <mesh position={[-0.19, 0.96, 0.61]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.25, 0.96, 0.61]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* 볼터치 */}
      <mesh position={[-0.36, 0.78, 0.5]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#fb7185" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0.36, 0.78, 0.5]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#fb7185" transparent opacity={0.6} />
      </mesh>

      {/* 입 — 2D 로고와 동일한 '웃는 곡선'(아래로 볼록한 반원 호).
          z는 머리 구(r0.62, y0.85 중심) 표면(z≈0.618)보다 앞이어야 보인다 — 0.62. */}
      <mesh position={[0, 0.8, 0.62]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.09, 0.022, 8, 20, Math.PI]} />
        <meshStandardMaterial color="#1f3d2b" />
      </mesh>

      {/* 머리 위 작은 새싹 잎 */}
      <mesh position={[0, 1.5, 0]} rotation={[0, 0, 0.2]} scale={[0.22, 0.4, 0.18]} castShadow>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial color="#86efac" roughness={0.4} />
      </mesh>

      {/* 떠다니는 작은 하트(애정) — RoundedBox로 귀엽게 */}
      <RoundedBox args={[0.22, 0.22, 0.22]} radius={0.08} position={[0.95, 1.3, 0.2]} rotation={[0, 0, 0.78]}>
        <meshStandardMaterial color="#fb7185" roughness={0.3} />
      </RoundedBox>
    </group>
  )
}
