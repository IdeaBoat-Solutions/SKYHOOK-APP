import { Stage } from './kit'
import type { Act, Layout } from './kit'
import './crane-lift.css'

/**
 * Stageshow illustration for the empty right pane of the sign-in card.
 *
 * Just the crane: a tower crane rigs a load at Harbour Rd, hoists it, travels
 * the jib and sets it down at Yard B - weight moved from one place to another,
 * which is what the business does. No dashboard chrome, no header, no status
 * text. The picture is corner-bled off the right and bottom of the pane.
 */

type Load = 'hook' | 'dest' | 'none'

type Scene = {
  /** Trolley position: 0 over the source pad, 1 over the destination pad. */
  t: number
  /** Hook position: 0 raised, 1 lowered onto a pad. */
  h: number
  load: Load
  /** Movement duration for the beat in flight, in ms. */
  dur: number
}

// Opening and closing frames are the same: a rigged load waiting at the
// source. The poster is the result - the load delivered at Yard B.
const initial: Scene = { t: 0, h: 1, load: 'hook', dur: 0 }
const poster: Scene = { t: 1, h: 1, load: 'dest', dur: 0 }

const script = async (a: Act<Scene>) => {
  await a.wait(700)
  await a.set({ h: 0, dur: 1000 })
  await a.mark('hoist')
  await a.wait(1050)
  await a.set({ t: 1, dur: 1700 })
  await a.mark('transit')
  await a.wait(1750)
  await a.set({ h: 1, dur: 900 })
  await a.mark('lower')
  await a.wait(950)
  await a.set({ load: 'dest', dur: 350 })
  await a.mark('placed')
  await a.wait(3000)

  // Nothing rewinds in view. The delivered load is absorbed into the pad,
  // the empty hook goes back for the next lift, and a fresh load is rigged.
  await a.set({ load: 'none', dur: 300 })
  await a.wait(320)
  await a.set({ h: 0, dur: 650 })
  await a.wait(680)
  await a.set({ t: 0, dur: 1100 })
  await a.mark('return')
  await a.wait(1120)
  await a.set({ load: 'hook', h: 1, dur: 900 })
  await a.wait(950)
  // The loop's last frame must equal its first, including the timing slot.
  await a.snap({ dur: 0 })
}

type Geo = {
  scene: { left: number; top: number; w: number; h: number }
  mastX: number
  jibL: number
  jibR: number
  jibY: number
  apexY: number
  groundY: number
  srcX: number
  dstX: number
  hookUp: number
  hookDown: number
  /** Gap from the hook block to the top of the load, for the slings. */
  slingDrop: number
  crateW: number
  crateH: number
  trolleyW: number
}

/** Two compositions, not a squeeze: the crane is redrawn closer in the pane
 *  the login card shows at tablet widths. */
const GEO: Record<Layout, Geo> = {
  wide: {
    scene: { left: 24, top: 24, w: 640, h: 452 },
    mastX: 135, jibL: 28, jibR: 520, jibY: 72, apexY: 30, groundY: 420,
    srcX: 230, dstX: 420, hookUp: 150, hookDown: 342,
    crateW: 56, crateH: 38, trolleyW: 26, slingDrop: 34,
  },
  compact: {
    scene: { left: 14, top: 14, w: 470, h: 488 },
    mastX: 88, jibL: 18, jibR: 340, jibY: 66, apexY: 28, groundY: 460,
    srcX: 150, dstX: 268, hookUp: 150, hookDown: 390,
    crateW: 48, crateH: 34, trolleyW: 22, slingDrop: 30,
  },
}

/** The fixed steelwork: mast, jib, counter-jib, ties and ground. Drawn as a
 *  technical schematic in one family of strokes, not a cartoon. */
function CraneStructure({ g }: { g: Geo }) {
  const { mastX: m, jibY: jy, jibL, jibR, apexY, groundY } = g
  const braces: React.ReactNode[] = []
  for (let y = jy + 12; y < groundY - 24; y += 30) {
    braces.push(<path key={`l${y}`} d={`M${m - 13} ${y} L${m + 13} ${Math.min(y + 30, groundY)}`} className="cl-brace" />)
    braces.push(<path key={`r${y}`} d={`M${m + 13} ${y} L${m - 13} ${Math.min(y + 30, groundY)}`} className="cl-brace" />)
  }
  const jibBraces: React.ReactNode[] = []
  for (let x = m; x < jibR - 24; x += 36) {
    jibBraces.push(<path key={`j${x}`} d={`M${x} ${jy - 6} L${Math.min(x + 36, jibR)} ${jy + 6}`} className="cl-brace" />)
  }
  for (let x = jibL; x < m - 24; x += 36) {
    jibBraces.push(<path key={`c${x}`} d={`M${x} ${jy + 6} L${Math.min(x + 36, m)} ${jy - 6}`} className="cl-brace" />)
  }

  return (
    <svg className="cl-steel" width={g.scene.w} height={g.scene.h} viewBox={`0 0 ${g.scene.w} ${g.scene.h}`} aria-hidden>
      <line x1={16} y1={groundY} x2={jibR + 46} y2={groundY} className="cl-ground" />
      {/* two pads, one per place the load belongs */}
      <rect x={g.srcX - 38} y={groundY - 14} width={76} height={14} rx={4} className="cl-pad cl-pad--src" />
      <rect x={g.dstX - 38} y={groundY - 14} width={76} height={14} rx={4} className="cl-pad cl-pad--dst" />
      <path d={`M${g.srcX + 38} ${groundY - 7} H${g.dstX - 38}`} className="cl-route" />
      <path d={`M${g.dstX - 46} ${groundY - 11} l6 4 -6 4`} className="cl-route" />
      {/* mast */}
      <path d={`M${m - 13} ${jy + 10} V${groundY} M${m + 13} ${jy + 10} V${groundY}`} className="cl-member" />
      {braces}
      <path d={`M${m - 26} ${groundY} L${m - 13} ${groundY - 22} M${m + 26} ${groundY} L${m + 13} ${groundY - 22} M${m - 30} ${groundY} H${m + 30}`} className="cl-member" />
      {/* slewing unit and cab */}
      <rect x={m - 15} y={jy - 14} width={31} height={17} rx={3} className="cl-cab" />
      <path d={`M${m + 6} ${jy - 11} h7 v8 h-7`} className="cl-brace" />
      {/* tower top and ties */}
      <path d={`M${m} ${apexY} L${m - 15} ${jy - 14} M${m} ${apexY} L${m + 15} ${jy - 14}`} className="cl-member" />
      <path d={`M${m} ${apexY} L${m + 188} ${jy - 6} M${m} ${apexY} L${jibL + 34} ${jy - 6}`} className="cl-tie" />
      {/* jib and counter-jib */}
      <path d={`M${m} ${jy - 6} H${jibR} M${m} ${jy + 6} H${jibR} M${jibL} ${jy - 6} H${m} M${jibL} ${jy + 6} H${m}`} className="cl-member" />
      {jibBraces}
      <rect x={jibL} y={jy - 7} width={28} height={20} rx={3} className="cl-weight" />
      <path d={`M${jibR} ${jy - 6} v12`} className="cl-member" />
    </svg>
  )
}

export function CraneLiftShowcase() {
  return (
    <Stage<Scene>
      className="cranelift"
      width={560}
      height={372}
      compact={{ below: 440, width: 358, height: 392 }}
      initial={initial}
      poster={poster}
      play="loop"
      script={script}
      fidelity="standard"
      greys="cool"
      accent="#237ead"
      tokens={{ '--ss-radius-window': '12px' }}
    >
      {(s, _rect, layout) => {
        const g = GEO[layout]
        const trolleyX = g.srcX + (g.dstX - g.srcX) * s.t
        const hookY = g.hookUp + (g.hookDown - g.hookUp) * s.h
        const move = { transitionDuration: `${s.dur}ms` }
        const rigW = g.crateW + 24
        const ropeTop = g.jibY + 12
        const labelHalf = layout === 'compact' ? 74 : 88

        return (
          <div
            className="cl-scene"
            style={{ left: g.scene.left, top: g.scene.top, width: g.scene.w, height: g.scene.h }}
          >
            <div className="cl-art">
              <CraneStructure g={g} />

              <span className="cl-pad-label" style={{ left: g.srcX - labelHalf, top: g.groundY + 8 }}>Harbour Rd</span>
              <span className="cl-pad-label" style={{ left: g.dstX - labelHalf, top: g.groundY + 8 }}>Yard B</span>

              <span
                className="cl-trolley"
                style={{ width: g.trolleyW, transform: `translate(${trolleyX - g.trolleyW / 2}px, ${g.jibY - 11}px)`, ...move }}
              />
              <span
                className="cl-rope"
                style={{ left: trolleyX - 1, top: ropeTop, height: Math.max(0, hookY + 4 - ropeTop), ...move }}
              />

              <svg
                className="cl-rig"
                width={rigW}
                height="46"
                viewBox={`0 0 ${rigW} 46`}
                style={{ transform: `translate(${trolleyX - rigW / 2}px, ${hookY}px)`, ...move }}
                aria-hidden
              >
                <g transform={`translate(${rigW / 2}, 0)`}>
                  <rect x={-8} y={2} width={16} height={12} rx={3} className="cl-block" />
                  <path d="M0 14 v5 a5 5 0 1 0 9 -1" className="cl-hook" />
                  <path d={`M-5 16 L${-g.crateW / 2 + 6} ${g.slingDrop} M5 16 L${g.crateW / 2 - 6} ${g.slingDrop}`} className="cl-sling" />
                </g>
              </svg>

              <div
                className="cl-crate cl-crate--hook"
                data-on={s.load === 'hook' || undefined}
                style={{
                  width: g.crateW,
                  height: g.crateH,
                  transform: `translate(${trolleyX - g.crateW / 2}px, ${hookY + g.slingDrop}px)`,
                  ...move,
                }}
              >
                <span className="cl-weight">12.4 t</span>
              </div>
              <div
                className="cl-crate cl-crate--dest"
                data-on={s.load === 'dest' || undefined}
                style={{
                  width: g.crateW,
                  height: g.crateH,
                  transform: `translate(${g.dstX - g.crateW / 2}px, ${g.hookDown + g.slingDrop}px)`,
                }}
              >
                <span className="cl-weight">12.4 t</span>
              </div>
            </div>
          </div>
        )
      }}
    </Stage>
  )
}

export default CraneLiftShowcase
