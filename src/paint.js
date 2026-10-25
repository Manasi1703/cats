import * as THREE from 'three'

export const INK = '#1a0707'
export const PAPER = '#efe4c8'

// Seeded RNG so every reload paints the same strokes.
export const rng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// The paintings' recipe: fat translucent marker strokes, thinner highlights, then ink hatching.
export const brush = (dark, light, angle = Math.PI / 2, jitter = 0.3) => [
  { count: 150, colors: dark, angle, jitter, len: 260, width: 28, alpha: 0.6 },
  { count: 90, colors: light, angle, jitter, len: 170, width: 11, alpha: 0.55 },
  { count: 45, colors: [INK], angle, jitter: jitter * 0.6, len: 110, width: 3, alpha: 0.4 },
]

export function paintStrokes(g, w, h, r, strokes) {
  g.lineCap = 'round'
  for (const s of strokes) {
    for (let i = 0; i < s.count; i++) {
      const x = r() * w, y = r() * h
      const len = s.len * (0.5 + r()), a = s.angle + (r() - 0.5) * s.jitter
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len
      g.strokeStyle = s.colors[Math.floor(r() * s.colors.length)]
      g.globalAlpha = s.alpha * (0.6 + r() * 0.4)
      g.lineWidth = s.width * (0.5 + r())
      g.beginPath()
      g.moveTo(x, y)
      g.quadraticCurveTo((x + ex) / 2 + (r() - 0.5) * len * 0.25, (y + ey) / 2 + (r() - 0.5) * len * 0.25, ex, ey)
      g.stroke()
    }
  }
  g.globalAlpha = 1
}

export const toTexture = (canvas, repeat = [1, 1]) => {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  return t
}

// Marker/gouache look from the paintings: flat base, then translucent strokes in a dominant direction.
export function paintTexture({ w = 1024, h = 512, base, strokes, seed = 7, repeat, draw }) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const r = rng(seed)
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  paintStrokes(g, w, h, r, strokes)
  draw?.(g, w, h, r)
  return toTexture(c, repeat)
}

const blur = (src, cols, rows, passes) => {
  let d = src
  for (let p = 0; p < passes; p++) {
    const o = new Float32Array(d.length)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0, n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) {
              s += d[yy * cols + xx]
              n++
            }
          }
        }
        o[y * cols + x] = s / n
      }
    }
    d = o
  }
  return d
}

// Painted curtain (reds, beige cords) and tablecloth (purples) are background.
const isBackground = (R, G, B) =>
  (R > G * 1.5 && R > B * 1.5) ||
  (B > R * 1.1 && B > G * 1.3) ||
  (R > 150 && R - G > 25 && R - G < 90 && G - B > 5 && G - B < 45 && R > B * 1.35)

// Cuts the cat out of its painting: flood-fills background from the borders (so red noses and
// pink ears inside the cat survive), then bulges the cutout like a stuffed paper relief.
export function cutout(img, cut, height, relief = 0.45) {
  const W = img.width, H = Math.round(img.height * cut)
  const full = document.createElement('canvas')
  full.width = W
  full.height = H
  full.getContext('2d').drawImage(img, 0, 0)

  const cols = 160, rows = Math.round((cols * H) / W)
  const small = document.createElement('canvas')
  small.width = cols
  small.height = rows
  const sg = small.getContext('2d', { willReadFrequently: true })
  sg.drawImage(full, 0, 0, cols, rows)
  const px = sg.getImageData(0, 0, cols, rows).data

  const fg = new Float32Array(cols * rows).fill(1)
  const stack = []
  const seed = (x, y) => {
    const i = y * cols + x
    if (fg[i] && isBackground(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) {
      fg[i] = 0
      stack.push(i)
    }
  }
  for (let x = 0; x < cols; x++) { seed(x, 0); seed(x, rows - 1) }
  for (let y = 0; y < rows; y++) { seed(0, y); seed(cols - 1, y) }
  while (stack.length) {
    const i = stack.pop(), x = i % cols, y = (i / cols) | 0
    if (x > 0) seed(x - 1, y)
    if (x < cols - 1) seed(x + 1, y)
    if (y > 0) seed(x, y - 1)
    if (y < rows - 1) seed(x, y + 1)
  }

  // Erode first so thin painted cords touching the cat drop out, then soften:
  // alphaTest 0.5 = cut line, lower threshold = paper border around it.
  const eroded = blur(fg, cols, rows, 2).map((v) => (v > 0.7 ? 1 : 0))
  const soft = blur(eroded, cols, rows, 2)
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = cols
  maskCanvas.height = rows
  const mg = maskCanvas.getContext('2d')
  const data = mg.createImageData(cols, rows)
  soft.forEach((v, i) => {
    data.data.set([v * 255, v * 255, v * 255, 255], i * 4)
  })
  mg.putImageData(data, 0, 0)

  const h = height * cut, w = (h * W) / H
  const depth = blur(fg, cols, rows, 14)
  const geo = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setZ(i, depth[i] * relief)
  geo.computeVertexNormals()

  const alpha = new THREE.CanvasTexture(maskCanvas)
  return { map: toTexture(full), alpha, geo, w, h }
}

// Roman numerals lettered as scratchy brush strokes, like the corners of the painted cards.
const GLYPHS = {
  I: [[[0.5, 0], [0.5, 1]]],
  V: [[[0, 0], [0.5, 1]], [[0.5, 1], [1, 0]]],
  X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
}
function letter(g, text, x, y, size, r) {
  g.lineWidth = size * 0.16
  for (const ch of text) {
    const cw = ch === 'I' ? size * 0.35 : size * 0.7
    for (const [[x0, y0], [x1, y1]] of GLYPHS[ch]) {
      const j = () => (r() - 0.5) * size * 0.12
      g.beginPath()
      g.moveTo(x + x0 * cw + j(), y + y0 * size + j())
      g.lineTo(x + x1 * cw + j(), y + y1 * size + j())
      g.stroke()
    }
    x += cw + size * 0.1
  }
}

// A wobbly hand-drawn rectangle: ink dragged around the card edge, twice, never quite closing.
function wobblyRect(g, x, y, w, h, r) {
  for (let pass = 0; pass < 2; pass++) {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
    g.beginPath()
    pts.forEach(([px, py], i) => {
      const jx = px + (r() - 0.5) * 8, jy = py + (r() - 0.5) * 8
      i ? g.lineTo(jx, jy) : g.moveTo(jx, jy)
    })
    g.stroke()
  }
}

// Tarot card as painted in the pictures: off-white stock with grey marker shading, a loose ink border,
// a sitting black cat blotted in with a fat brush, and the numeral scratched in a corner.
export function cardTexture(seed) {
  const numerals = ['I', 'II', 'V', 'IX', 'XI', 'XVII', 'XX']
  return paintTexture({
    w: 256, h: 400, base: '#f4f1ea', seed,
    strokes: [{ count: 30, colors: ['#c9c6c0', '#dcd9d2'], angle: Math.PI / 2, jitter: 0.6, len: 140, width: 16, alpha: 0.5 }],
    draw: (g, w, h, r) => {
      g.strokeStyle = g.fillStyle = INK
      g.lineCap = g.lineJoin = 'round'
      g.lineWidth = 9
      wobblyRect(g, 12, 12, w - 24, h - 24, r)

      const cx = w / 2 + (r() - 0.5) * 30, cy = h * 0.62, s = 0.9 + r() * 0.25
      const cat = new Path2D()
      cat.ellipse(cx, cy, 52 * s, 78 * s, (r() - 0.5) * 0.3, 0, Math.PI * 2) // body
      cat.ellipse(cx, cy - 92 * s, 36 * s, 32 * s, 0, 0, Math.PI * 2) // head
      cat.moveTo(cx - 34 * s, cy - 100 * s); cat.lineTo(cx - 26 * s, cy - 146 * s); cat.lineTo(cx - 6 * s, cy - 118 * s) // ears
      cat.moveTo(cx + 34 * s, cy - 100 * s); cat.lineTo(cx + 26 * s, cy - 146 * s); cat.lineTo(cx + 6 * s, cy - 118 * s)
      g.fill(cat)
      // brush the silhouette's edge so it reads as paint, not a stamp
      g.save()
      g.clip(cat)
      paintStrokes(g, w, h, r, [{ count: 40, colors: [INK, '#2b2b2b'], angle: Math.PI / 2, jitter: 0.8, len: 70, width: 22, alpha: 0.9 }])
      g.restore()
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2
        g.lineWidth = 6 + r() * 8
        g.beginPath()
        g.moveTo(cx + Math.cos(a) * 46 * s, cy + Math.sin(a) * 70 * s)
        g.lineTo(cx + Math.cos(a) * (54 + r() * 10) * s, cy + Math.sin(a) * (80 + r() * 12) * s)
        g.stroke()
      }
      g.lineWidth = 14 * s // tail curling round the feet
      g.beginPath()
      g.moveTo(cx + 40 * s, cy + 60 * s)
      g.quadraticCurveTo(cx + 95 * s, cy + 40 * s, cx + 70 * s, cy - 10 * s)
      g.stroke()

      letter(g, numerals[seed % numerals.length], 34, 34, 34, r)
    },
  })
}
