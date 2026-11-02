import type { Ring } from './view'

const SIZE = 64
const STROKE = 6
const GAP = 2
const MID = SIZE / 2

/** A ring per window on a dim track, the first outermost, and the fullest window's percentage and
 *  name in the middle. */
export function Donut({ rings, top, label }: { rings: Ring[]; top: Ring | null; label: string }) {
  return (
    <svg className="usage-donut" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
      {rings.map((ring, i) => {
        const r = MID - STROKE / 2 - i * (STROKE + GAP)
        const length = 2 * Math.PI * r
        return (
          <g key={ring.key} className={`ring-${ring.key}`}>
            <circle className="usage-track" cx={MID} cy={MID} r={r} fill="none" strokeWidth={STROKE} />
            {ring.percent > 0 && (
              <circle className="usage-arc" cx={MID} cy={MID} r={r} fill="none" strokeWidth={STROKE}
                strokeDasharray={`${(length * ring.percent) / 100} ${length}`} transform={`rotate(-90 ${MID} ${MID})`} />
            )}
          </g>
        )
      })}
      {top && (
        <>
          <text className={`usage-mid tone-${top.tone}`} x={MID} y={MID - 1} textAnchor="middle">{top.percent}%</text>
          <text className="usage-mid-name" x={MID} y={MID + 10} textAnchor="middle">{top.key}</text>
        </>
      )}
    </svg>
  )
}
