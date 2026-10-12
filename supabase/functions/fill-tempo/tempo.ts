/* Estimation du tempo d'un extrait audio (mono, Float32) :
   flux spectral (attaques) → autocorrélation → tempo le plus marqué, avec une préférence douce autour de 120 BPM */
const FRAME = 1024, HOP = 512

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}

export function estimateBpm(pcm: Float32Array, sampleRate: number): number {
  const frames = Math.floor((pcm.length - FRAME) / HOP)
  if (frames < 200) return 0
  const win = new Float32Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME))
  const bins = FRAME / 2, maxBin = Math.min(bins, Math.round(8000 * FRAME / sampleRate))
  let prev = new Float32Array(maxBin)
  const env = new Float32Array(frames)
  const re = new Float32Array(FRAME), im = new Float32Array(FRAME)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) { re[i] = pcm[f * HOP + i] * win[i]; im[i] = 0 }
    fft(re, im)
    const cur = new Float32Array(maxBin)
    let flux = 0
    for (let k = 1; k < maxBin; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = cur[k] - prev[k]
      if (d > 0) flux += d
    }
    env[f] = flux; prev = cur
  }
  /* On retire la tendance lente (moyenne glissante ~1 s) */
  const fps = sampleRate / HOP, w = Math.round(fps / 2)
  const on = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0, n = 0
    for (let j = Math.max(0, f - w); j <= Math.min(frames - 1, f + w); j++) { s += env[j]; n++ }
    on[f] = Math.max(0, env[f] - s / n)
  }
  /* Autocorrélation sur les retards de 50 à 220 BPM */
  const lagMin = Math.floor(fps * 60 / 220), lagMax = Math.ceil(fps * 60 / 50)
  const ac = new Float32Array(lagMax * 4 + 2)
  for (let lag = lagMin; lag < ac.length && lag < frames; lag++) {
    let s = 0
    for (let f = lag; f < frames; f++) s += on[f] * on[f - lag]
    ac[lag] = s / (frames - lag)
  }
  /* Peigne : un vrai tempo résonne aussi à 2× et 4× le retard ; préférence log-normale autour de 120 BPM */
  let best = 0, bestLag = 0
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const comb = ac[lag] + 0.5 * (ac[2 * lag] || 0) + 0.25 * (ac[4 * lag] || 0)
    const bpm = 60 * fps / lag
    const score = comb * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    if (score > best) { best = score; bestLag = lag }
  }
  if (!bestLag) return 0
  /* Retard affiné par interpolation parabolique */
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1]
  const shift = (a - 2 * b + c) !== 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0
  return Math.round(60 * fps / (bestLag + Math.max(-0.5, Math.min(0.5, shift))))
}
