import { useRef, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, RoundedBox, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { SproutMascot } from './SproutMascot'

/** 동전 (복지 혜택 금액) */
function Coin({ position }: { position: [number, number, number] }) {
  return (
    <Float speed={2} rotationIntensity={1.2} floatIntensity={1.4}>
      <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.09, 32]} />
        <meshStandardMaterial color="#facc15" metalness={0.3} roughness={0.35} />
      </mesh>
    </Float>
  )
}

/** 서류 (신청 서류) */
function Document({ position }: { position: [number, number, number] }) {
  return (
    <Float speed={1.6} rotationIntensity={0.8} floatIntensity={1.2}>
      <group position={position} rotation={[0.2, 0.4, 0.1]}>
        <RoundedBox args={[0.55, 0.72, 0.05]} radius={0.04} castShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.6} />
        </RoundedBox>
        {[0.16, 0.04, -0.08].map((y, i) => (
          <mesh key={i} position={[0, y, 0.03]}>
            <boxGeometry args={[0.34, 0.04, 0.01]} />
            <meshStandardMaterial color="#86efac" />
          </mesh>
        ))}
      </group>
    </Float>
  )
}

/** 별 (도움/희망) */
function Star({ position, color = '#38bdf8' }: { position: [number, number, number]; color?: string }) {
  return (
    <Float speed={2.4} rotationIntensity={1.5} floatIntensity={1.6}>
      <mesh position={position} castShadow>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color={color} roughness={0.3} flatShading />
      </mesh>
    </Float>
  )
}

/** 마우스 따라 살짝 기우는 그룹 (패럴랙스) */
function ParallaxGroup({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const { pointer } = useThree()
  useFrame(() => {
    if (!ref.current || !enabled) return
    ref.current.rotation.y += (pointer.x * 0.35 - ref.current.rotation.y) * 0.05
    ref.current.rotation.x += (-pointer.y * 0.2 - ref.current.rotation.x) * 0.05
  })
  return <group ref={ref}>{children}</group>
}

export interface HeroSceneProps {
  animate?: boolean
}

export default function HeroScene({ animate = true }: HeroSceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0.5, 6], fov: 42 }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* 부드러운 하늘/지면 환경광 — 카툰풍을 유지하며 음영을 자연스럽게 */}
      <hemisphereLight args={['#ffffff', '#d7f5e3', 0.9]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[4, 6, 5]} intensity={1.6} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
      />
      <directionalLight position={[-5, 2, -3]} intensity={0.5} color="#bae6fd" />
      <pointLight position={[0, 3, 2]} intensity={0.55} color="#fde68a" />

      <Suspense fallback={null}>
        <ParallaxGroup enabled={animate}>
          <SproutMascot animate={animate} />
          <Coin position={[2.1, 0.6, 0.4]} />
          <Coin position={[-2.3, -0.2, 0.2]} />
          <Document position={[-2.0, 1.2, -0.3]} />
          <Document position={[2.4, -0.8, -0.2]} />
          <Star position={[1.5, 1.6, 0.6]} color="#38bdf8" />
          <Star position={[-1.4, 1.5, 0.3]} color="#facc15" />
          <Star position={[0, -1.9, 0.8]} color="#fb7185" />
        </ParallaxGroup>
        <ContactShadows position={[0, -2.05, 0]} opacity={0.28} scale={9} blur={2.6} far={3.5} color="#16a34a" />
      </Suspense>
    </Canvas>
  )
}
