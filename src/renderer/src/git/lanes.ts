// Graph lanes for a commit list in `git log --date-order` order (newest first,
// no parent before all of its children). Pure: the view draws the result.

export interface Segment { from: number; to: number; color: number }
export interface GraphRow {
  /** Lane of this commit's dot. */
  lane: number
  /** Colour index of the dot (its lane's chain). */
  color: number
  /** Upper half: lane `from` at the row's top edge → lane `to` at its middle. */
  up: Segment[]
  /** Lower half: lane `from` at the middle → lane `to` at the bottom edge. */
  down: Segment[]
  /** Lanes the row spans (highest occupied lane + 1, before or after the commit). */
  width: number
}

/** One pass, newest first. Each lane remembers the commit it expects next and
 *  its chain's colour; a lane keeps its index until it's freed, so a branch is
 *  a straight line until it forks off or joins. Colours are a running count
 *  (the view picks `color % palette size`). Segment colours: a straight piece
 *  and a curve into the dot take the colour of the lane they come down from; a
 *  curve out to a merged parent takes the colour of the lane it goes into. */
export function layoutGraph(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const expect: (string | null)[] = [] // null: free; no trailing nulls between rows
  const colors: number[] = []
  // The straight piece of each lane's current chain, shared by every row it
  // passes through (a wide graph over 10k rows would otherwise be millions of objects).
  const straight: Segment[] = []
  let nextColor = 0

  const firstFree = () => {
    const i = expect.indexOf(null)
    return i < 0 ? expect.length : i
  }
  const occupy = (i: number, hash: string) => {
    const color = nextColor++
    expect[i] = hash
    colors[i] = color
    straight[i] = { from: i, to: i, color }
  }
  const trim = () => {
    let n = expect.length
    while (n > 0 && expect[n - 1] === null) n--
    expect.length = n
  }

  const rows: GraphRow[] = new Array(commits.length)
  for (let r = 0; r < commits.length; r++) {
    const { hash, parents } = commits[r]

    // 1. The first lane expecting this commit; none: a branch tip in the first free lane.
    let lane = expect.indexOf(hash)
    const tip = lane < 0
    if (tip) {
      lane = firstFree()
      occupy(lane, hash)
    }
    const color = colors[lane]
    const before = expect.length

    // 2. Upper half, over the lanes as they were when the row was reached.
    // 3. Lanes other than `lane` that expected this commit end here.
    const up: Segment[] = []
    for (let i = 0; i < expect.length; i++) {
      const e = expect[i]
      if (e === null) continue
      if (e !== hash) up.push(straight[i])
      else if (i === lane) {
        if (!tip) up.push(straight[i])
      } else {
        up.push({ from: i, to: lane, color: colors[i] })
        expect[i] = null
      }
    }

    // 4. The first parent continues this lane; each further parent is a merge
    // target: the lane already expecting it, or a new lane with a new colour.
    expect[lane] = parents.length ? parents[0] : null
    let merges: number[] | null = null
    let fresh: number[] | null = null
    for (let p = 1; p < parents.length; p++) {
      let i = expect.indexOf(parents[p])
      if (i < 0) {
        i = firstFree()
        occupy(i, parents[p])
        ;(fresh ??= []).push(i)
      }
      ;(merges ??= []).push(i)
    }
    trim()

    // 5. Lower half.
    const down: Segment[] = []
    for (let i = 0; i < expect.length; i++) {
      if (expect[i] === null) continue
      if (i !== lane && merges?.includes(i)) {
        down.push({ from: lane, to: i, color: colors[i] })
        if (!fresh?.includes(i)) down.push(straight[i]) // that lane also carries on past the dot
      } else down.push(straight[i])
    }

    rows[r] = { lane, color, up, down, width: Math.max(before, expect.length) }
  }
  return rows
}
