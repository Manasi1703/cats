import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls, Outlines, Sparkles } from '@react-three/drei'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import gsap from 'gsap'
import { INK, PAPER, brush, cardTexture, cutout, paintTexture } from './paint'
import { PaperRim, Tent } from './Tent'

const START = new THREE.Vector3(0, 3.6, 20)
const LOOK_OUT = new THREE.Vector3(0, 4.5, 0)
const LOOK_IN = new THREE.Vector3(0, 1.7, 0) // orbit target: table centre
const ENTRY = new THREE.CatmullRomCurve3([
  START,
  new THREE.Vector3(0, 2.6, 10),
  new THREE.Vector3(0, 1.9, 5.5),
  new THREE.Vector3(0, 1.9, 1.5), // seat at the table edge; orbit radius = this distance to LOOK_IN
])
const SEAT_R = 1.9
// cut = fraction of the painting kept above its own painted table
const CATS = [
  { src: import.meta.env.BASE_URL + 'cats/wizard.jpg', angle: Math.PI / 3, cut: 0.6, keepW: 0.76 },
  { src: import.meta.env.BASE_URL + 'cats/vampire.jpg', angle: Math.PI, cut: 0.72 },
  { src: import.meta.env.BASE_URL + 'cats/queen.jpg', angle: -Math.PI / 3, cut: 0.77 },
]
const TABLE_TOP = 1.15
const TABLE_R = 1.1
// globe beside the birthday-hat cat, on the viewer's right, as in its painting
const GLOBE_ANGLE = CATS[0].angle - 0.45
// as in the vampire's painting: lying across the table in front of him, right of centre, silver tip pointing left
const WAND_POS = [Math.sin(CATS[1].angle) * 0.5 + 0.4, TABLE_TOP + 0.035, Math.cos(CATS[1].angle) * 0.5]
// Tweened by GSAP, read every frame by the curtains and the camera.
const anim = { curtain: 0, walk: 0 }

function useTextures() {
  return useMemo(() => ({
    cloth: paintTexture({ base: '#4433b0', repeat: [3, 1], seed: 11, strokes: brush(['#2c1d80', '#33238f'], ['#6a55d6', '#5a46c8'], Math.PI / 2, 0.5) }),
    clothTop: paintTexture({ w: 512, h: 512, base: '#4433b0', seed: 13, strokes: brush(['#2c1d80', '#3a2a9c'], ['#5a46c8', '#6a55d6'], 0.3, 1.2) }),
    floor: paintTexture({ w: 512, h: 512, base: '#3e4a5e', repeat: [10, 10], seed: 5, strokes: brush(['#2c3646', '#34405a'], ['#56637a', '#62708a'], 0.1, 0.6) }),
    // crystal ball and its brass stand, in the wizard painting's palette
    globe: paintTexture({
      w: 512, h: 256, base: '#9fe3dd', seed: 23, strokes: [
        { count: 90, colors: ['#5fd3c9', '#3aa9b8', '#7fd8d0'], angle: 0.8, jitter: 1, len: 120, width: 22, alpha: 0.6 },
        { count: 30, colors: ['#f4f0a0'], angle: 0.8, jitter: 1, len: 80, width: 14, alpha: 0.6 },
        { count: 25, colors: ['#ffffff'], angle: 0.8, jitter: 0.8, len: 70, width: 8, alpha: 0.8 },
        { count: 15, colors: ['#1f6f78'], angle: 0.8, jitter: 0.6, len: 60, width: 3, alpha: 0.5 },
      ],
    }),
    wand: paintTexture({ w: 256, h: 64, base: '#141414', seed: 47, strokes: [{ count: 25, colors: ['#3a3a3a', '#5a5a5a'], angle: 0, jitter: 0.2, len: 90, width: 6, alpha: 0.6 }] }),
    brass: paintTexture({ w: 256, h: 128, base: '#d9a425', seed: 29, strokes: brush(['#4f8f3a', '#e46d1f'], ['#f4d35e'], 0, 0.8) }),
    cards: [1, 2, 3, 4, 5, 6, 7].map(cardTexture),
  }), [])
}

function Table({ tex }) {
  const fans = useMemo(() => CATS.flatMap((c, ci) => [-2, -1, 0, 1, 2].map((k) => {
    const a = c.angle + k * 0.16
    return { a, tex: tex.cards[(ci * 5 + k + 2) % tex.cards.length], pos: [Math.sin(a) * (TABLE_R - 0.3), TABLE_TOP + 0.01 + k * 0.002, Math.cos(a) * (TABLE_R - 0.3)] }
  })), [tex])
  return (
    <group>
      <mesh position={[0, TABLE_TOP / 2, 0]}>
        <cylinderGeometry args={[TABLE_R, TABLE_R + 0.15, TABLE_TOP, 64, 1]} />
        <meshLambertMaterial map={tex.cloth} />
        <PaperRim s={0.7} />
      </mesh>
      <mesh position={[0, TABLE_TOP + 0.001, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[TABLE_R, 64]} />
        <meshLambertMaterial map={tex.clothTop} />
      </mesh>
      {fans.map((f, i) => (
        <mesh key={i} position={f.pos} rotation={[-Math.PI / 2, 0, f.a]}>
          <planeGeometry args={[0.22, 0.34]} />
          <meshLambertMaterial map={f.tex} />
        </mesh>
      ))}
      {/* globe sits in the gap between two seats: it drops out of frame when you face the cat across from it */}
      <group position={[Math.sin(GLOBE_ANGLE) * 0.8, 0, Math.cos(GLOBE_ANGLE) * 0.8]}>
        <mesh position={[0, TABLE_TOP + 0.06, 0]}>
          <cylinderGeometry args={[0.13, 0.19, 0.12, 24]} />
          <meshLambertMaterial map={tex.brass} />
          <Outlines thickness={3} color={INK} />
        </mesh>
        <mesh position={[0, TABLE_TOP + 0.34, 0]}>
          <sphereGeometry args={[0.22, 48, 32]} />
          <meshLambertMaterial map={tex.globe} emissive="#3fb8ae" emissiveIntensity={0.3} />
          <PaperRim s={0.5} />
        </mesh>
      </group>
      {/* the black wand with a silver tip from the paintings, lying across the gap */}
      <group position={WAND_POS} rotation-y={CATS[1].angle}>
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.03, 0.03, 0.8, 16]} />
          <meshLambertMaterial map={tex.wand} />
          <Outlines thickness={3} color={INK} />
        </mesh>
        <mesh position-x={0.46} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.034, 0.034, 0.14, 16]} />
          <meshLambertMaterial color="#d6d6d6" />
          <Outlines thickness={3} color={INK} />
        </mesh>
      </group>
    </group>
  )
}

function Cat({ src, angle, cut, keepW }) {
  const img = useLoader(THREE.ImageLoader, src)
  const c = useMemo(() => cutout(img, cut, 3.0, keepW), [img, cut, keepW])
  return (
    <group position={[Math.sin(angle) * SEAT_R, 0.75, Math.cos(angle) * SEAT_R]} rotation-y={angle + Math.PI}>
      <mesh geometry={c.geo} position-y={c.h / 2}>
        <meshBasicMaterial map={c.map} alphaMap={c.alpha} alphaTest={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* paper border: same soft mask, lower threshold, a hair behind */}
      <mesh geometry={c.geo} position={[0, c.h / 2, -0.03]}>
        <meshBasicMaterial color={PAPER} alphaMap={c.alpha} alphaTest={0.12} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function CameraRig({ phase }) {
  const { camera, scene, pointer, gl } = useThree()
  const look = useMemo(() => LOOK_OUT.clone(), [])
  // scroll down zooms out, scroll up zooms in; lens zoom, so it never fights the rig or the orbit
  useEffect(() => {
    const zoom = { v: camera.zoom }
    const onWheel = (e) => {
      e.preventDefault()
      gsap.to(zoom, {
        v: THREE.MathUtils.clamp(zoom.v * Math.exp(-e.deltaY * 0.0015), 0.8, 2.5),
        duration: 0.6, ease: 'power2.out', overwrite: true,
        onUpdate: () => { camera.zoom = zoom.v; camera.updateProjectionMatrix() },
      })
    }
    gl.domElement.addEventListener('wheel', onWheel, { passive: false })
    return () => gl.domElement.removeEventListener('wheel', onWheel)
  }, [camera, gl])
  useFrame(() => {
    if (phase === 'outside') {
      // pointer parallax on the closed tent
      camera.position.lerp(new THREE.Vector3(START.x + pointer.x * 1.6, START.y + pointer.y * 0.8, START.z), 0.05)
      camera.lookAt(LOOK_OUT)
    } else if (phase === 'entering') {
      camera.position.copy(ENTRY.getPoint(anim.walk))
      camera.lookAt(look.lerpVectors(LOOK_OUT, LOOK_IN, anim.walk))
    }
    // fog closes in once inside, so far cats sink into the haze
    scene.fog.near = THREE.MathUtils.lerp(14, 3, anim.walk)
    scene.fog.far = THREE.MathUtils.lerp(48, 13, anim.walk)
  })
  return null
}

export default function App() {
  const [phase, setPhase] = useState('outside') // outside → entering → inside
  const started = useRef(false)
  const enter = useCallback(() => {
    if (started.current) return
    started.current = true
    document.body.style.cursor = 'auto'
    setPhase('entering')
    // drapes part, the walk-in overlaps their last stretch, then they fall shut behind you
    gsap.timeline()
      .to(anim, { curtain: 1, duration: 2.6, ease: 'power2.inOut' })
      .to(anim, { walk: 1, duration: 3.2, ease: 'power2.inOut', onComplete: () => setPhase('inside') }, 1.4)
      .to(anim, { curtain: 0, duration: 2.4, ease: 'power2.inOut' })
  }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') enter() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enter])

  return (
    <>
      <Canvas flat dpr={[1, 2]} camera={{ position: START.toArray(), fov: 50 }}>
        <color attach="background" args={['#140d22']} />
        <fog attach="fog" args={['#140d22', 14, 48]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[-6, 10, 12]} intensity={1.4} color="#cfd8ff" />
        <pointLight position={[0, 4.6, 0]} intensity={14} decay={1} color="#ffb86b" />
        <Suspense fallback={null}>
          <World phase={phase} onOpen={enter} />
        </Suspense>
        <CameraRig phase={phase} />
        <OrbitControls enabled={phase === 'inside'} target={LOOK_IN.toArray()} enableZoom={false} enablePan={false}
          enableDamping dampingFactor={0.05} rotateSpeed={0.45} minPolarAngle={1.4} maxPolarAngle={1.75} />
      </Canvas>
      <p className="hint">
        {phase === 'outside' && 'click the curtains (or press enter)'}
        {phase === 'inside' && 'drag to look around the table'}
      </p>
    </>
  )
}

function World({ phase, onOpen }) {
  const tex = useTextures()
  return (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[60, 64]} />
        <meshLambertMaterial map={tex.floor} />
      </mesh>
      <Tent anim={anim} interactive={phase === 'outside'} onOpen={onOpen} />
      <Table tex={tex} />
      {CATS.map((c) => <Cat key={c.src} {...c} />)}
      <mesh position={[0, 4.6, 0]}>
        <octahedronGeometry args={[0.22]} />
        <meshBasicMaterial color="#ffd27a" />
        <Outlines thickness={4} color={INK} />
      </mesh>
      <Sparkles count={70} scale={[5, 3.5, 5]} position={[0, 2.6, 0]} size={2.5} speed={0.25} color="#ffd9a0" />
      <Sparkles count={160} scale={[60, 20, 60]} position={[0, 14, -10]} size={3} speed={0.1} color="#f2e35a" />
    </>
  )
}
