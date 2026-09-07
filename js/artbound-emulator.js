/**
 * artbound-emulator.js — the WhatsApp phone in the hero.
 *
 * Plays a scripted ArtBound journey inside the real emulator widget: the same
 * parser and the same WhatsappEmulator the Cartaja demo gallery uses
 * (cartaja-website/demos/_artbound.html), reduced to a single journey and a
 * two-button transport, because a landing page is not a demo console.
 *
 * The journey is DATA — journeys/artbound-live-pipeline.emulator.yaml — and is
 * a verbatim copy of Cartaja's, so it can be re-synced when the pipeline's
 * wording changes. Every business line in it is a string the live system sends.
 *
 * Behaviour: the phone opens holding the whole transcript at its FIRST message,
 * so it reads as a populated thread rather than an empty chat. The first time it
 * scrolls into view it rewinds and plays the conversation out turn by turn. Under
 * prefers-reduced-motion it just sits there, fully readable, and never animates.
 *
 * Requires, loaded by the page before this module:
 *   - jQuery (window.jQuery)  — the ntelioUI2 Widget base
 *   - Font Awesome            — the widget renders `fas fa-*` glyphs internally
 */

import { parseScenario, scenarioToDemo } from '../emulator/lib/EmulatorScenario.js'
import { WhatsappEmulator } from '../emulator/widgets/WhatsappEmulator.js'

const $ = window.jQuery

const JOURNEY = 'journeys/artbound-live-pipeline.emulator.yaml'
const REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let demo = null      // scenarioToDemo() output
let emu = null       // the mounted widget
let pinTop = false   // hold the scroll at the first message until the visitor takes over
let started = false  // the in-view autoplay has fired once
let lastVisible = 0    // last transport position, so arriving at the end can be detected
let rainArmed = false  // suppress the celebration on a mount's own first report

/* ─── Mount ─────────────────────────────────────────────────────────── */

function teardown() {
  if (rainStop) rainStop()
  if (emu) {
    emu._cancelled = true
    try { clearTimeout(emu._demoTimer) } catch (e) { /* best-effort */ }
    emu = null
  }
  $('#ab-device').empty()
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.autoplay]  reveal turns one by one, with typing
 * @param {number}  [opts.start]     initial visible-message count
 * @param {boolean} [opts.top]       hold the scroll at the first message
 */
function mount(opts) {
  opts = opts || {}
  teardown()
  const b = demo.business || {}
  emu = new WhatsappEmulator({
    demo: true,
    demoMessages: demo.messages,
    demoAutoplay: opts.autoplay === true,
    demoStart: typeof opts.start === 'number' ? opts.start : undefined,
    // The widget's native cadence, with a short per-length pause after each
    // message. The Demos page runs this at half speed for someone studying a
    // transcript; a hero has to hold a scrolling visitor, so it plays at pace.
    demoPace: 1,
    demoDwellPerChar: 2,
    // Demo mode opens no socket. The host is only used to resolve the chat
    // backdrop, which this site serves itself at /emulator/media/.
    wabaEmulator: window.location.origin,
    companyName: b.displayName || 'ArtBound',
    profilePhotoUrl: b.profilePhotoUrl || null,
    businessSubtitle: b.subtitle || null,
    businessVerified: b.verified,
    phoneNumber: '', // no routing in demo mode
    onDemoUpdate: (pos) => updateTransport(pos)
  })

  // The widget scrolls to the newest bubble after every render — right while a
  // simulation plays, wrong when the whole transcript is placed at once. Nothing
  // upstream exposes the choice, so pin the scroll back until releaseTop().
  pinTop = opts.top === true
  const baseRender = emu.render.bind(emu)
  emu.render = function () {
    baseRender()
    if (!pinTop) return
    const node = emu.find('.nui-wa-messages')[0]
    if (node) node.scrollTop = 0
  }

  rainArmed = false
  emu.appendTo($('#ab-device'))
  updateTransport(emu.demoPosition())
}

function releaseTop() { pinTop = false }

/* ─── Transport ─────────────────────────────────────────────────────── */

/** Back to the first message. Playing → replay from the top; paused → stay
 *  paused there, so you can step forward from the start. */
function first() {
  releaseTop()
  started = true
  if (!emu || !emu._demo) return mount({ autoplay: true })
  const wasPlaying = emu.demoIsPlaying()
  const pos = emu.demoStepTo(0)
  updateTransport(wasPlaying ? emu.demoPlay() : pos)
}

/** Step one message forward or back. Stepping always takes over from autoplay,
 *  so pause first — that moves the cursor to whatever is on screen; without it
 *  demoNext() would read the null cursor as "all" and jump to the end. */
function step(delta) {
  releaseTop()
  started = true
  if (!emu || !emu._demo) return
  emu.demoPause()
  updateTransport(delta > 0 ? emu.demoNext() : emu.demoPrev())
}

/** Skip to the whole transcript, no waiting. */
function last() {
  releaseTop()
  started = true
  if (!emu || !emu._demo) return
  updateTransport(emu.demoEnd())
}

/** Play / pause. At the end, play means replay — rewind first. */
function togglePlay() {
  releaseTop()
  started = true
  if (!emu || !emu._demo) return mount({ autoplay: true })
  if (emu.demoIsPlaying()) return updateTransport(emu.demoPause())
  const pos = emu.demoPosition()
  if (pos.visible >= pos.total) emu.demoStepTo(0)
  updateTransport(emu.demoPlay())
}

function updateTransport(pos) {
  if (!pos) return
  const playing = pos.playing === true
  const atEnd = pos.visible >= pos.total
  const atStart = pos.visible <= 0
  const label = playing ? 'Pause' : (atEnd ? 'Replay' : 'Play')
  $('#ab-counter').text(pos.visible + ' / ' + pos.total)
  $('#ab-play')
    .attr('aria-label', playing ? 'Pause the session' : (atEnd ? 'Replay the session' : 'Play the session'))
    .attr('data-state', playing ? 'playing' : 'paused')
    .find('span').text(label).end()
    .find('i').attr('class', 'fas fa-' + (playing ? 'pause' : (atEnd ? 'rotate-left' : 'play')))
  $('#ab-first, #ab-prev').prop('disabled', atStart)
  $('#ab-next, #ab-last').prop('disabled', atEnd)

  // Arriving at the end — the hammer — brings the heads down, however you got
  // there: autoplay running out, or skipping/stepping onto the last message.
  // Not on the first update, which is just the initial mount reporting itself.
  // They keep falling for as long as the visitor stays on that last message.
  if (rainArmed && atEnd && pos.total > 0 && lastVisible < pos.total) rainHeads()
  else if (!atEnd && rainFade) rainFade()
  lastVisible = pos.visible
  rainArmed = true
}

/* ─── The rain ──────────────────────────────────────────────────────────
 *
 * When the session reaches the hammer, bowler-hatted heads fall down the phone
 * — the Matrix-cart transition from cartaja.com/the-story.html, in ArtBound's
 * mark. The mark is drawn in its own colours and always upright.
 *
 * Each head is turned on its vertical axis, as though looking left or right.
 * Canvas 2D only has affine transforms, and a plain horizontal scale reads as a
 * squashed picture rather than a turned object — the giveaway is that both edges
 * stay the same height. So a turn is built as a real perspective projection: the
 * mark is cut into vertical slices, each slice placed and scaled by
 *
 *     z = x·sin(yaw)          depth of that slice once turned
 *     s = D / (D + z)         perspective foreshortening, D = focal length
 *
 * which makes the near edge taller and wider and the far edge smaller — a
 * trapezoid, not a rectangle. That is the whole difference between "rotated" and
 * "squooshed".
 *
 * The poses are pre-rendered once into sprites, because slicing every head on
 * every frame would be ~2,000 draw calls a frame. A head's pose is fixed when it
 * spawns and never animates — a head that turns while it falls stops reading as
 * a head.
 *
 * The run lasts RAIN_MS and then tapers. Leaving the last message early — Replay,
 * or a step back — tapers it there instead.
 *
 * Depth comes from size, in five discrete bands. Heads are drawn smallest band
 * first, so near heads overlap far ones, and the far bands lose CONTRAST — their
 * ink blended toward the chat background, not made transparent. The heads stay
 * fully opaque and still occlude what they pass over; they just carry less tonal
 * weight, which is what distance actually does. The top two bands get no
 * treatment at all: they are the foreground and read at full strength.
 */

const MARK_SRC = 'assets/images/artbound-mark.svg'
const RAIN_MS = 10000       // how long heads keep falling once the hammer lands
const RAIN_FADE_MS = 500    // the taper, at the end of the run or on leaving it

const POSE_PX = 180         // pose sprite resolution; heads draw at or below this
const POSE_SLICES = 72      // vertical cuts per pose — enough to hide the seams
const FOCAL = 1.75          // focal length in card widths; lower = stronger perspective
// The mark is drawn at this fraction of the sprite, leaving room for the near
// edge, which perspective pushes taller than the flat mark. At FOCAL 1.75 and
// the widest yaw the near edge reaches 1.30x — 0.76 * 1.30 just fits.
const POSE_BASE = 0.76
// Yaw in degrees. 0 is face-on and is picked far more often than the rest, so a
// good share of the heads look straight out at you.
const POSE_YAWS = [-55, -42, -29, -17, 0, 17, 29, 42, 55]
const FACE_ON = POSE_YAWS.indexOf(0)

// The chat area is the doodle wallpaper under a 90% white veil, so this is what
// "toward the background" means here. Contrast is lost by blending the mark's
// own ink toward this, which keeps the head opaque — unlike fading it out.
const CHAT_BG = '#f6f4f1'

/**
 * The depth bands, near to far. `size` is the figure in px (before the
 * POSE_BASE padding is added back); `fade` is how far its ink is carried toward
 * CHAT_BG; `roam` lets a band ignore the column grid; `weight` is how many of
 * that band appear relative to the others.
 *
 * Only the frontmost band is fade-free — it is the foreground and should look
 * like the mark, untouched. Everything behind it gives up some contrast, and the
 * ramp steepens as the bands recede rather than sliding evenly front to back.
 * `flat` holds the frontmost band
 * face-on: at that size a turn is large enough on screen to read as a distortion
 * of the logo rather than as depth.
 *
 * `speed` runs slowest at the front and roughly 1.4x faster with each band back,
 * and `delay` opens the run with the two front bands and lets the deeper ones
 * arrive after. Note this is parallax inverted: in the physical version the near
 * plane is the fast one. Slow-front is the look asked for here — the foreground
 * settles while the depths tear past behind it.
 *
 * Speed is ONE value per band, not a range. Heads in a band therefore fall in
 * lockstep, so their relative positions never change — which is what lets the
 * placement below promise that two heads of the same band will not run into each
 * other. Given per-head speeds they would drift together sooner or later.
 */
const HEAD_TIERS = [
  { size: 124, fade: 0.00, speed:  2.0, delay:    0, flat: true,  weight: 1 },
  { size:  96, fade: 0.16, speed:  3.0, delay:    0, flat: false, weight: 2 },
  { size:  74, fade: 0.30, speed:  4.4, delay:  340, flat: false, weight: 3 },
  { size:  56, fade: 0.52, speed:  6.4, delay:  760, flat: false, weight: 4 },
  { size:  42, fade: 0.70, speed:  9.2, delay: 1220, flat: false, weight: 5 }
]
const ENTRY_JITTER_MS = 260   // so a band doesn't arrive as one rank
const ENTRY_PREROLL = 45      // frames of travel a head may start above the top
const HEAD_GAP = 10           // clear space demanded between two heads of a band
// Flattened weights, so picking a band is one array lookup.
const TIER_PICK = HEAD_TIERS.reduce(
  (acc, t, i) => acc.concat(new Array(t.weight).fill(i)), []
)

let poses = null      // [HTMLCanvasElement] — one per yaw, built once
// Rain state, in three positions: idle (both null), falling (both set), and
// fading out (rainStop set, rainFade cleared — nothing left to ask it to stop).
let rainStop = null   // immediate teardown
let rainFade = null   // graceful stop: no new heads, fade the rest out
let rainPending = false  // a start is in flight, awaiting the pose sprites

/**
 * Project the mark at one yaw into a sprite, slice by slice.
 * @param {HTMLCanvasElement} base  the mark, rasterised square
 * @param {number} deg              yaw in degrees; sign picks the direction
 */
function buildPose(base, deg) {
  const c = document.createElement('canvas')
  c.width = c.height = POSE_PX
  const g = c.getContext('2d')
  const W = POSE_PX * POSE_BASE, H = POSE_PX * POSE_BASE
  const cx = POSE_PX / 2, cy = POSE_PX / 2
  if (deg === 0) { g.drawImage(base, cx - W / 2, cy - H / 2, W, H); return c }

  const yaw = deg * Math.PI / 180
  const sin = Math.sin(yaw), cos = Math.cos(yaw)
  const sliceW = base.width / POSE_SLICES

  // Where the vertical line at normalised x (−0.5 … 0.5) lands once turned.
  const project = (u) => {
    const x = u - 0.5
    const s = FOCAL / (FOCAL + x * sin)
    return { X: cx + x * cos * s * W, S: s }
  }

  for (let i = 0; i < POSE_SLICES; i++) {
    const a = project(i / POSE_SLICES)
    const b = project((i + 1) / POSE_SLICES)
    const dx = Math.min(a.X, b.X)
    // Half a pixel of overlap, or the slices show as hairline seams.
    const dw = Math.abs(b.X - a.X) + 0.5
    const dh = H * (a.S + b.S) / 2
    g.drawImage(base, i * sliceW, 0, sliceW, base.height, dx, cy - dh / 2, dw, dh)
  }
  return c
}

/**
 * Drop a pose's contrast by carrying its ink toward the chat background.
 *
 * `source-atop` paints only where the sprite already has coverage and leaves its
 * alpha untouched, so the head keeps occluding whatever it falls across — the
 * whole difference between losing contrast and going transparent.
 *
 * @param {HTMLCanvasElement} pose
 * @param {number} k  0 = untouched, 1 = the background itself
 */
function fadePose(pose, k) {
  if (!k) return pose
  const c = document.createElement('canvas')
  c.width = pose.width; c.height = pose.height
  const g = c.getContext('2d')
  g.drawImage(pose, 0, 0)
  g.globalCompositeOperation = 'source-atop'
  g.globalAlpha = k
  g.fillStyle = CHAT_BG
  g.fillRect(0, 0, c.width, c.height)
  return c
}

/**
 * Rasterise the mark, project every yaw, then hold one set of poses per distinct
 * fade in the tier table. Resolves to `{ [fade]: canvas[] }`, or null.
 */
function loadPoses() {
  if (poses) return Promise.resolve(poses)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // Rasterise the SVG square and large first: slicing a 149px-wide source
      // into 72 strips would sample two pixels per strip.
      const base = document.createElement('canvas')
      base.width = base.height = POSE_PX * 2
      const bg = base.getContext('2d')
      const scale = Math.min(base.width / img.naturalWidth, base.height / img.naturalHeight)
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale
      bg.drawImage(img, (base.width - w) / 2, (base.height - h) / 2, w, h)

      const sharp = POSE_YAWS.map((deg) => buildPose(base, deg))
      poses = {}
      HEAD_TIERS.forEach((t) => {
        if (poses[t.fade]) return           // bands sharing a fade share a set
        poses[t.fade] = sharp.map((p) => fadePose(p, t.fade))
      })
      resolve(poses)
    }
    img.onerror = () => resolve(null)   // no rain is fine; a broken hero is not
    img.src = MARK_SRC
  })
}

/**
 * Lanes for one band: as many as fit the figure's own width plus a gap.
 *
 * Measured on tier.size, the FIGURE, not on the sprite box — the sprite carries
 * POSE_BASE worth of transparent padding, and spacing heads by the padded box
 * would leave the band looking thin.
 */
function laneLayout(w, tier) {
  const n = Math.max(1, Math.floor(w / (tier.size + HEAD_GAP)))
  return { n, laneW: w / n }
}

/**
 * Place a head so it clears every other head of its own band.
 *
 * Two heads of a band collide only if they share a lane, since lanes are a
 * figure-width apart, and only if they are within a figure-height of each other,
 * since a band falls in lockstep. So: pick a lane, and if its topmost head is
 * not yet clear of the entry point, start above that head instead of at the
 * random offset. Lanes are tried in random order and the emptiest is the
 * fallback, which spreads the band out instead of favouring one side.
 *
 * @param {boolean} opening  true for the run's first fill, which staggers the
 *   bands in by depth; false for a respawn, which re-enters immediately.
 * @param {object[]} heads   the live heads, to place clear of
 */
function makeHead(w, h, opening, heads) {
  const tierIndex = TIER_PICK[Math.floor(Math.random() * TIER_PICK.length)]
  const tier = HEAD_TIERS[tierIndex]
  // Scaled up by 1/POSE_BASE: the figure occupies only that fraction of its
  // sprite, and tier.size is the size the figure itself should end up.
  const size = tier.size / POSE_BASE
  const { n, laneW } = laneLayout(w, tier)

  // The topmost live head of this band in each lane.
  const topOf = new Array(n).fill(Infinity)
  for (let i = 0; i < heads.length; i++) {
    const o = heads[i]
    if (o.tier !== tierIndex) continue
    if (o.y < topOf[o.lane]) topOf[o.lane] = o.y
  }

  // Always entered from above: nothing is seeded mid-screen, or the staggered
  // opening would be hidden behind heads that were already there. The head start
  // is measured in TIME, not pixels — a fixed pixel offset would take the slow
  // front band several seconds to reach the top edge while the fast back bands
  // cleared it instantly.
  const wanted = -size - Math.random() * tier.speed * ENTRY_PREROLL
  const clear = tier.size + HEAD_GAP     // vertical room one head needs

  let lane = 0, best = -Infinity
  const order = []
  for (let i = 0; i < n; i++) order.push(i)
  for (let i = order.length - 1; i > 0; i--) {          // shuffle
    const j = Math.floor(Math.random() * (i + 1))
    const t = order[i]; order[i] = order[j]; order[j] = t
  }
  for (let i = 0; i < order.length; i++) {
    const l = order[i]
    if (topOf[l] - wanted >= clear) { lane = l; best = Infinity; break }
    if (topOf[l] > best) { best = topOf[l]; lane = l }   // emptiest so far
  }
  // Either the lane was free at the entry point, or we go in above its topmost.
  const y = best === Infinity ? wanted : Math.min(wanted, topOf[lane] - clear)

  // Whatever the lane has spare after the figure and its gap, spent on jitter so
  // a band doesn't read as a rigid grid. On the tight bands this is a pixel or
  // two; the vertical spread carries the variety there.
  const slack = Math.max(0, laneW - tier.size - HEAD_GAP)
  return {
    x: lane * laneW + (laneW - size) / 2 + (Math.random() - 0.5) * slack,
    y,
    size,
    lane,
    tier: tierIndex,
    // Held until its band's turn, and only on the opening fill.
    startAt: opening ? tier.delay + Math.random() * ENTRY_JITTER_MS : 0,
    speed: tier.speed,
    fade: tier.fade,
    pose: (tier.flat || Math.random() < 0.32)
      ? FACE_ON
      : Math.floor(Math.random() * POSE_YAWS.length)
  }
}

async function rainHeads() {
  if (REDUCE || rainPending) return
  if (rainStop && rainFade) return   // already falling
  if (rainStop) rainStop()           // a fade still in flight — replace it outright
  const screen = document.getElementById('ab-device')
  if (!screen) return
  // Claimed before the await: the sprites are cached after the first build, so a
  // second call can otherwise slip through while this one is still suspended.
  rainPending = true
  const set = await loadPoses()
  rainPending = false
  if (!set) return

  const canvas = document.createElement('canvas')
  const st = canvas.style
  st.position = 'absolute'; st.inset = '0'; st.width = '100%'; st.height = '100%'
  st.zIndex = '20'; st.pointerEvents = 'none'; st.opacity = '1'
  screen.appendChild(canvas)

  const w = screen.clientWidth, h = screen.clientHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  // Each head is placed clear of its own band, so this is an upper bound rather
  // than a literal on-screen count: a band with no room left simply starts its
  // next head higher up, and the fall thins itself out.
  const heads = []
  const count = Math.round(w / 54 * 2.4)
  for (let i = 0; i < count; i++) heads.push(makeHead(w, h, true, heads))

  let raf = 0
  let falling = true
  let t0 = 0
  const frame = (now) => {
    if (!t0) t0 = now
    const elapsed = now - t0
    // Cleared every frame, so the heads stay discrete and the chat shows through.
    ctx.clearRect(0, 0, w, h)
    // Painter's algorithm: smallest first, so near heads overlap far ones.
    heads.sort((a, b) => a.size - b.size)
    let due = 0
    for (let i = 0; i < heads.length; i++) {
      const d = heads[i]
      if (elapsed < d.startAt) continue      // this band hasn't opened yet
      ctx.drawImage(set[d.fade][d.pose], d.x, d.y, d.size, d.size)
      d.y += d.speed
      if (d.y > h + d.size) {
        heads.splice(i, 1); i--
        // Once the run is over, let the stragglers fall off rather than respawn.
        if (falling) due++
      }
    }
    // Re-placed only after the sweep, and only against the heads that remain:
    // a head still in the array would otherwise be an obstacle to its own
    // replacement, pushing every respawn a lane-height further up each cycle.
    for (let k = 0; k < due; k++) heads.push(makeHead(w, h, false, heads))
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  let endTimer = 0
  let runTimer = 0
  rainStop = () => {
    cancelAnimationFrame(raf)
    clearTimeout(endTimer); clearTimeout(runTimer)
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    rainStop = null
    rainFade = null
  }
  // Cut the supply of new heads and fade what is still on screen, so neither the
  // end of the run nor leaving the last message snaps the rain off mid-fall.
  rainFade = () => {
    falling = false
    rainFade = null   // from here the run is fading; only rainStop applies
    clearTimeout(runTimer)
    canvas.style.transition = 'opacity ' + RAIN_FADE_MS + 'ms ease'
    canvas.style.opacity = '0'
    endTimer = setTimeout(() => rainStop && rainStop(), RAIN_FADE_MS)
  }
  runTimer = setTimeout(() => rainFade && rainFade(), RAIN_MS)
}

/* ─── Boot ──────────────────────────────────────────────────────────── */

/** Is the phone far enough into the viewport to be worth playing to? */
function inView() {
  const el = document.getElementById('ab-device')
  if (!el) return false
  const r = el.getBoundingClientRect()
  const h = window.innerHeight || document.documentElement.clientHeight
  const shown = Math.min(r.bottom, h) - Math.max(r.top, 0)
  return shown > 0 && shown / r.height >= 0.4
}

/**
 * Start the simulation the first time the phone scrolls properly into view.
 *
 * This REMOUNTS with autoplay rather than calling demoStepTo(0) + demoPlay() on
 * the widget in place. The widget applies its demo options inside an async
 * init(), so driving the transport from outside can land before init and get
 * overwritten by it; passing `demoAutoplay` through the constructor is the only
 * race-free way in.
 */
function watchForView() {
  if (REDUCE || started || !('IntersectionObserver' in window)) return
  const el = document.getElementById('ab-device')
  if (!el) return
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting || started) return
      started = true
      io.disconnect()
      mount({ autoplay: true })
    })
  }, { threshold: 0.4 })
  io.observe(el)
}

async function boot() {
  const $stage = $('#ab-stage')
  try {
    const res = await fetch(JOURNEY, { cache: 'no-cache' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    demo = scenarioToDemo(parseScenario(await res.text()))
  } catch (err) {
    // The hero must not become a broken box. Drop the whole stage and let the
    // headline have the width back.
    console.error('[artbound] could not load the journey', err)
    $stage.remove()
    document.body.classList.add('no-demo')
    return
  }

  $('#ab-play').on('click', togglePlay)
  $('#ab-first').on('click', first)
  $('#ab-prev').on('click', () => step(-1))
  $('#ab-next').on('click', () => step(1))
  $('#ab-last').on('click', last)

  // Above the fold on a desktop load: play it out from the first message. Lower
  // down (or under reduced motion): hold the whole thread at its top, readable,
  // and let scrolling into view start it.
  if (!REDUCE && inView()) {
    started = true
    mount({ autoplay: true })
  } else {
    mount({ start: demo.messages.length, top: true })
    watchForView()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
