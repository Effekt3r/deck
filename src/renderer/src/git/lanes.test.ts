import { describe, expect, it } from 'vitest'
import { layoutGraph, type Segment } from './lanes'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })
const seg = (s: Segment[]) => s.map((x) => `${x.from}>${x.to}`).sort()
const view = (commits: ReturnType<typeof c>[]) =>
  layoutGraph(commits).map((r) => ({ lane: r.lane, up: seg(r.up), down: seg(r.down) }))

describe('layoutGraph', () => {
  it('linear history stays in lane 0', () => {
    expect(view([c('c3', 'c2'), c('c2', 'c1'), c('c1')])).toEqual([
      { lane: 0, up: [], down: ['0>0'] },
      { lane: 0, up: ['0>0'], down: ['0>0'] },
      { lane: 0, up: ['0>0'], down: [] },
    ])
  })
  it('a merge forks a lane and the branches join again at their base', () => {
    expect(view([c('M', 'A', 'B'), c('B', 'C'), c('A', 'C'), c('C')])).toEqual([
      { lane: 0, up: [], down: ['0>0', '0>1'] },
      { lane: 1, up: ['0>0', '1>1'], down: ['0>0', '1>1'] },
      { lane: 0, up: ['0>0', '1>1'], down: ['0>0', '1>1'] },
      { lane: 0, up: ['0>0', '1>0'], down: [] },
    ])
  })
  it('an unmerged branch tip gets its own lane', () => {
    expect(view([c('F2', 'F1'), c('M2', 'M1'), c('F1', 'M1'), c('M1')])).toEqual([
      { lane: 0, up: [], down: ['0>0'] },
      { lane: 1, up: ['0>0'], down: ['0>0', '1>1'] },
      { lane: 0, up: ['0>0', '1>1'], down: ['0>0', '1>1'] },
      { lane: 0, up: ['0>0', '1>0'], down: [] },
    ])
  })
  it('a freed lane is reused by the next tip, with a new colour', () => {
    const rows = layoutGraph([c('A', 'B'), c('X', 'Y'), c('B'), c('Z'), c('Y')])
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0, 1])
    expect(rows.map((r) => r.color)).toEqual([0, 1, 0, 2, 1])
    expect(seg(rows[2].down)).toEqual(['1>1'])
    expect(seg(rows[3].up)).toEqual(['1>1'])
  })
  it('an octopus merge fans out to every parent', () => {
    expect(view([c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')]).map((r) => [r.lane, r.down])).toEqual([
      [0, ['0>0', '0>1', '0>2']], [0, ['1>1', '2>2']], [1, ['2>2']], [2, []],
    ])
  })
  it('a merge parent already in another lane gets a curve into that lane', () => {
    expect(view([c('Y', 'B'), c('X', 'A', 'B'), c('A', 'B'), c('B')])).toEqual([
      { lane: 0, up: [], down: ['0>0'] },
      { lane: 1, up: ['0>0'], down: ['0>0', '1>0', '1>1'] },
      { lane: 1, up: ['0>0', '1>1'], down: ['0>0', '1>1'] },
      { lane: 0, up: ['0>0', '1>0'], down: [] },
    ])
  })
  it('colours: curves into a dot keep the colour they come from, curves to a merged parent take its lane colour', () => {
    const col = (s: Segment[]) => s.map((x) => `${x.from}>${x.to}:${x.color}`).sort()
    const rows = layoutGraph([c('M', 'A', 'B'), c('B', 'C'), c('A', 'C'), c('C')])
    expect(rows.map((r) => r.color)).toEqual([0, 1, 0, 0])
    expect(col(rows[0].down)).toEqual(['0>0:0', '0>1:1'])
    expect(col(rows[1].up)).toEqual(['0>0:0', '1>1:1'])
    expect(col(rows[3].up)).toEqual(['0>0:0', '1>0:1'])
    const joined = layoutGraph([c('Y', 'B'), c('X', 'A', 'B'), c('A', 'B'), c('B')])
    expect(col(joined[1].down)).toEqual(['0>0:0', '1>0:0', '1>1:1'])
  })
  it('reports how many lanes each row spans', () => {
    expect(layoutGraph([c('M', 'A', 'B'), c('B', 'C'), c('A', 'C'), c('C')]).map((r) => r.width)).toEqual([2, 2, 2, 2])
  })
  it('lays out 10,000 commits quickly', () => {
    const commits = Array.from({ length: 10_000 }, (_, i) =>
      c(`h${i}`, ...(i + 1 < 10_000 ? [`h${i + 1}`] : []), ...(i % 50 === 0 && i + 25 < 10_000 ? [`h${i + 25}`] : [])))
    const t = performance.now()
    expect(layoutGraph(commits)).toHaveLength(10_000)
    expect(performance.now() - t).toBeLessThan(500)
  })
})
