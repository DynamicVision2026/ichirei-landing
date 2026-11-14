import { CORD_COLORS, CORD_PATHS, CORD_VIEW } from '../order/mizuhiki.ts'

// The mizuhiki cord across the seal (gift ceremony ticket, part 4): a thin double gold cord tied in an awaji knot (a remembrance: silver-grey). `state` drives the CSS: tied · untying (the cord loosens and slides off).
export default function Cord({ memorial, state = 'tied' }: { memorial: boolean; state?: 'tied' | 'untying' | 'gone' }) {
  const c = memorial ? CORD_COLORS.silver : CORD_COLORS.gold
  const hi = memorial ? CORD_COLORS.silverLight : CORD_COLORS.goldLight
  const common = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg className="gf-cord" data-testid="gift-cord" data-state={state} data-memorial={memorial ? 'yes' : 'no'} viewBox={`0 0 ${CORD_VIEW.w} ${CORD_VIEW.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <g className="gf-cord-lines">
        {CORD_PATHS.lines.map((d, i) => <path key={i} d={d} stroke={c} strokeWidth={1.7} {...common} />)}
      </g>
      <g className="gf-cord-knot">
        {CORD_PATHS.loops.map((d, i) => <path key={i} d={d} stroke={c} strokeWidth={1.95} {...common} />)}
        <path d={CORD_PATHS.ring} stroke={hi} strokeWidth={2.4} {...common} />
      </g>
      <g className="gf-cord-tails">
        {CORD_PATHS.tails.map((d, i) => <path key={i} d={d} stroke={c} strokeWidth={1.7} {...common} />)}
      </g>
    </svg>
  )
}
