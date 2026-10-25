import { useFrame } from '@react-three/fiber'
import { Line, Outlines } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { INK, PAPER, brush, paintStrokes, paintTexture, rng, toTexture } from './paint'

// Big top after the references: straight striped wall, concave roof sweeping up to a finial,
// scalloped valance hanging from the eave, drapes across a door cut into the front of the wall.
const R = 6.5, WALL_H = 4.2, EAVE_R = R + 0.35, EAVE_Y = WALL_H + 0.25, ROOF_H = 5, VAL_H = 0.9
const GAP = THREE.MathUtils.degToRad(20) // half-width of the door, as an angle of the wall
const PEAK = EAVE_Y + ROOF_H
const RED = '#c81d1a', RED_DARK = ['#8f1512', '#7d0f0e'], RED_LIGHT = ['#e2453a']
const CREAM = '#efe0c4', CREAM_DARK = ['#d8c49e', '#c9b088'], CREAM_LIGHT = ['#fff7e6']
const ease = (t) => t * t * (3 - 2 * t)

// Cut-paper rim like the cat cutouts: ink line, cream paper border, ink edge.
// This drei's Outlines thickness is in drawing-buffer pixels (its screenspace flag is inverted);
// the depth offset keeps the rim behind open shells like the tent wall when seen from inside.
export function PaperRim({ s = 1 }) {
  return [[3, INK], [14, PAPER], [18, INK]].map(([px, color]) => (
    <Outlines key={px} thickness={px * s} color={color} polygonOffset polygonOffsetFactor={8} />
  ))
}

// n red bands per canvas over a cream ground, each band hand-cut and marker-filled.
const stripes = (n) => (g, w, h, r) => {
  const sw = w / (n * 2)
  for (let i = 0; i < n; i++) {
    const x = i * 2 * sw + sw / 2
    const left = [], right = []
    for (let y = 0; y <= h; y += h / 8) {
      left.push([x + (r() - 0.5) * 8, y])
      right.push([x + sw + (r() - 0.5) * 8, y])
    }
    const band = new Path2D()
    left.forEach(([px, py]) => band.lineTo(px, py))
    right.reverse().forEach(([px, py]) => band.lineTo(px, py))
    band.closePath()
    g.save()
    g.fillStyle = RED
    g.fill(band)
    g.clip(band)
    paintStrokes(g, w, h, r, brush(RED_DARK, RED_LIGHT))
    g.restore()
    g.strokeStyle = INK
    g.lineWidth = 3
    g.globalAlpha = 0.7
    g.stroke(band)
    g.globalAlpha = 1
  }
}

function valanceTexture() {
  const w = 1024, h = 192, n = 8, sw = w / n, r = rng(41)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  for (let i = 0; i < n; i++) {
    g.save()
    g.beginPath()
    g.rect(i * sw, 0, sw, h)
    g.clip()
    g.fillStyle = i % 2 ? CREAM : RED
    g.fillRect(i * sw, 0, sw, h)
    paintStrokes(g, w, h, r, i % 2 ? brush(CREAM_DARK, CREAM_LIGHT, 0) : brush(RED_DARK, RED_LIGHT, 0))
    g.restore()
  }
  // keep only the band above each scallop
  const top = h * 0.3
  const hem = (shrink) => {
    const p = new Path2D()
    p.moveTo(0, 0)
    p.lineTo(0, top)
    for (let i = 0; i < n; i++) p.ellipse(i * sw + sw / 2, top, (sw / 2) * shrink, h * 0.6 * shrink, 0, Math.PI, 0, true)
    p.lineTo(w, 0)
    p.closePath()
    return p
  }
  g.globalCompositeOperation = 'destination-in'
  g.fill(hem(1))
  g.globalCompositeOperation = 'source-over'
  g.lineWidth = 8
  g.strokeStyle = INK
  g.stroke(hem(1))
  g.lineWidth = 4
  g.strokeStyle = PAPER // the inner loop line under each scallop, as in the engraving
  g.stroke(hem(0.8))
  g.fillStyle = INK
  g.fillRect(0, 0, w, 6)
  return toTexture(c, [5, 1])
}

function useTentTextures() {
  return useMemo(() => {
    const striped = (seed) => paintTexture({ base: CREAM, seed, repeat: [4, 1], strokes: brush(CREAM_DARK, CREAM_LIGHT), draw: stripes(4) })
    return {
      wall: striped(31),
      roof: striped(37),
      // inside is one red curtain with cord swags, the backdrop of the paintings
      inside: paintTexture({
        base: RED, seed: 43, repeat: [4, 1], strokes: brush(RED_DARK, RED_LIGHT),
        draw: (g, w, h) => {
          g.strokeStyle = '#c9a07c'
          g.lineWidth = 9
          for (const y of [h * 0.12, h * 0.18]) {
            g.beginPath()
            g.moveTo(0, y)
            g.quadraticCurveTo(w / 2, y + h * 0.16, w, y)
            g.stroke()
          }
        },
      }),
      valance: valanceTexture(),
      curtain: paintTexture({
        w: 512, h: 1024, base: '#e07a1f', seed: 17, strokes: brush(['#a8460c', '#c25a12'], ['#f4a640', '#f7b955']),
        // the meeting edge gets a cut-paper trim
        draw: (g, w, h) => {
          g.fillStyle = PAPER
          g.fillRect(w - 30, 0, 30, h)
          g.fillStyle = INK
          g.fillRect(w - 8, 0, 8, h)
          g.fillRect(w - 38, 0, 8, h)
          g.fillRect(0, h - 8, w, 8)
        },
      }),
    }
  }, [])
}

// One drape. `anim.curtain` (0 closed → 1 open) is tweened by GSAP; the cloth follows it with the
// rod (top) leading and the hem trailing, pleats bunching as it gathers and a ripple running through
// it while it travels. u: 0 at the wall side → 1 at the meeting edge; v: floor → rod.
function Curtain({ side, anim, tex }) {
  const { geo, A, B, C, D, n } = useMemo(() => {
    const z = R * Math.cos(GAP), x = side * R * Math.sin(GAP)
    const A = new THREE.Vector3(x, 0, z), B = new THREE.Vector3(0, 0, z)
    const C = new THREE.Vector3(0, WALL_H, z), D = new THREE.Vector3(x, WALL_H, z)
    return { geo: new THREE.PlaneGeometry(1, 1, 40, 20), A, B, C, D, n: new THREE.Vector3(0, 0, 1) }
  }, [side])
  const p = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime, pos = geo.attributes.position, uv = geo.attributes.uv
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i)
      const k = ease(THREE.MathUtils.clamp(anim.curtain * 1.45 - 0.45 * (1 - v), 0, 1))
      const travel = Math.sin(Math.PI * k)
      const gu = u * (1 - 0.86 * k)
      const pleat = Math.sin(u * Math.PI * 12) * (0.05 + 0.2 * k)
      const ripple = Math.sin(u * 7 - t * 3 + v * 2) * 0.12 * travel * (1 - v)
      const billow = 0.3 * travel * (1 - v) ** 2
      const breeze = Math.sin(t * 1.3 + u * 5 + side) * 0.03 * (1 - v)
      p.lerpVectors(A, B, gu)
      q.lerpVectors(D, C, gu)
      p.lerp(q, v).addScaledVector(n, pleat + ripple + billow + breeze)
      pos.setXYZ(i, p.x, p.y, p.z)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere() // keeps the drape clickable as it moves
  })

  return (
    <mesh geometry={geo}>
      <meshLambertMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function Tent({ anim, interactive, onOpen }) {
  const tex = useTentTextures()
  const roofGeo = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      pts.push(new THREE.Vector2(EAVE_R * (1 - t) ** 1.7 + 0.06 * t, EAVE_Y + ROOF_H * t))
    }
    return new THREE.LatheGeometry(pts, 96)
  }, [])
  const wallGeo = useMemo(() => new THREE.CylinderGeometry(R, R, WALL_H, 96, 1, true, GAP, Math.PI * 2 - GAP * 2), [])
  // guy ropes, skipping the front so they never cross the door
  const ropes = useMemo(() => Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 4 + (i / 9) * (Math.PI * 1.5)
    return [[Math.sin(a) * EAVE_R, EAVE_Y, Math.cos(a) * EAVE_R], [Math.sin(a) * (R + 3.5), 0, Math.cos(a) * (R + 3.5)]]
  }), [])
  const cursor = (c) => () => { if (interactive) document.body.style.cursor = c }

  return (
    <group onClick={(e) => { e.stopPropagation(); onOpen() }} onPointerOver={cursor('pointer')} onPointerOut={cursor('auto')}>
      {/* stripes face out, the red curtain faces in: same shell, one mesh per side */}
      <mesh position={[0, WALL_H / 2, 0]} geometry={wallGeo}>
        <meshLambertMaterial map={tex.wall} />
        <PaperRim />
      </mesh>
      <mesh position={[0, WALL_H / 2, 0]} geometry={wallGeo}>
        <meshLambertMaterial map={tex.inside} side={THREE.BackSide} />
      </mesh>
      <mesh geometry={roofGeo}>
        <meshLambertMaterial map={tex.roof} />
        <PaperRim />
      </mesh>
      <mesh geometry={roofGeo}>
        <meshLambertMaterial map={tex.inside} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, EAVE_Y - VAL_H / 2, 0]}>
        <cylinderGeometry args={[EAVE_R, EAVE_R, VAL_H, 128, 1, true]} />
        <meshLambertMaterial map={tex.valance} alphaTest={0.5} />
      </mesh>
      {/* seals the strip between wall top and eave when seen from inside */}
      <mesh position={[0, EAVE_Y - VAL_H / 2, 0]}>
        <cylinderGeometry args={[EAVE_R, EAVE_R, VAL_H, 128, 1, true]} />
        <meshLambertMaterial map={tex.inside} side={THREE.BackSide} />
      </mesh>
      <Curtain side={1} anim={anim} tex={tex.curtain} />
      <Curtain side={-1} anim={anim} tex={tex.curtain} />
      {/* finial: brass disc and striped spire */}
      <mesh position={[0, PEAK - 0.35, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 0.1, 48]} />
        <meshLambertMaterial color="#e3a23a" />
        <PaperRim s={0.5} />
      </mesh>
      <mesh position={[0, PEAK + 0.4, 0]}>
        <coneGeometry args={[0.22, 1.4, 32]} />
        <meshLambertMaterial map={tex.roof} />
        <Outlines thickness={3} color={INK} />
      </mesh>
      {ropes.map((pts, i) => <Line key={i} points={pts} color={INK} lineWidth={1.5} />)}
    </group>
  )
}
