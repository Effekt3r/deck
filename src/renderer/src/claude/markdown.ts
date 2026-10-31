// A small, safe markdown parser for Claude's replies. It only builds data: the
// renderer (Markdown.tsx) turns it into React elements, so no HTML from a reply
// ever reaches the page. Covers what Claude writes: paragraphs, headings, fenced
// code, lists, quotes, rules, GitHub tables, inline code, emphasis and links.

export type Block =
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'code'; lang: string; text: string }
  /** Nested lists are flat: an inner list follows its parent item with `depth` 1, 2, …
   *  and the outer list carries on in a new block with `start` (ordered lists). */
  | { type: 'list'; ordered: boolean; items: Inline[][]; start?: number; depth?: number }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'rule' }
  | { type: 'table'; rows: Inline[][][] } // header row first

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*?))?[ \t]*$/
const FENCE = /^( *)(`{3,}|~{3,})(.*)$/
const DELIMITER_ROW = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/
/** Only these become links; anything else keeps its text. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:)\S/i
const BARE_URL = /^https?:\/\/[^\s<>`]+/i
const LINK_TEXT_MAX = 1000
const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

const isBlank = (line: string) => line.trim() === ''
const indentOf = (line: string) => line.length - line.replace(/^[ \t]+/, '').length

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const fence = openFence(line)
    if (fence) {
      i = readFence(lines, i, fence, out)
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const content = (heading[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '')
      out.push({ type: 'heading', level: heading[1].length, inlines: parseInlines(content) })
      i++
      continue
    }
    if (RULE.test(line)) {
      out.push({ type: 'rule' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      for (; i < lines.length; i++) {
        const m = QUOTE.exec(lines[i])
        if (!m) break
        quoted.push(m[1].trim())
      }
      out.push({ type: 'quote', inlines: parseInlines(quoted.join('\n')) })
      continue
    }
    if (isTableStart(lines, i)) {
      i = readTable(lines, i, out)
      continue
    }
    if (ITEM.test(line)) {
      i = readList(lines, i, out)
      continue
    }
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !interrupts(lines, i))) para.push(lines[i++].trim())
    out.push({ type: 'paragraph', inlines: parseInlines(para.join('\n')) })
  }
  return out
}

/** A line that ends a paragraph and starts a block of its own. Only lists that
 *  start at 1 interrupt one ("… the number of windows is\n14. …" stays text). */
function interrupts(lines: string[], i: number): boolean {
  const line = lines[i]
  if (openFence(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || isTableStart(lines, i)) return true
  const item = ITEM.exec(line)
  return item !== null && (!/\d/.test(item[2]) || parseInt(item[2], 10) === 1)
}

interface Fence {
  indent: number
  marker: string
  lang: string
}

function openFence(line: string): Fence | null {
  const m = FENCE.exec(line)
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null // ```inline``` on one line is code, not a fence
  return { indent: m[1].length, marker: m[2], lang: m[3].trim().split(/\s+/)[0] ?? '' }
}

/** Fenced code from line `start`: verbatim, less the fence's own indentation. Unclosed runs to the end. */
function readFence(lines: string[], start: number, fence: Fence, out: Block[]): number {
  const body: string[] = []
  let i = start + 1
  for (; i < lines.length; i++) {
    const line = lines[i]
    const close = /^ *(`{3,}|~{3,})[ \t]*$/.exec(line)
    if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
      i++
      break
    }
    body.push(line.slice(Math.min(fence.indent, indentOf(line))))
  }
  out.push({ type: 'code', lang: fence.lang, text: body.join('\n') })
  return i
}

/** Bullet and numbered lists, with nesting by indentation (see Block). Items take
 *  their continuation lines; an indented fence becomes a code block in between. */
function readList(lines: string[], start: number, out: Block[]): number {
  const levels: { indent: number }[] = []
  let block: { ordered: boolean; depth: number; start: number; items: string[][] } | null = null
  /** Text after a code block inside an item. */
  let para: string[] | null = null
  /** Where continuation lines go: the last item, or `para`. */
  let target: string[] | null = null
  const flushBlock = () => {
    if (!block) return
    const list: Block = { type: 'list', ordered: block.ordered, items: block.items.map((lines) => parseInlines(lines.join('\n'))) }
    if (block.ordered && block.start !== 1) list.start = block.start
    if (block.depth > 0) list.depth = block.depth
    out.push(list)
    block = null
  }
  const flushPara = () => {
    if (para) out.push({ type: 'paragraph', inlines: parseInlines(para.join('\n').trim()) })
    para = null
  }

  let blank = false
  let i = start
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (isBlank(line)) {
      blank = true
      continue
    }
    const indent = indentOf(line)
    const item = RULE.test(line) ? null : ITEM.exec(line)
    if (item) {
      while (levels.length > 1 && indent < levels[levels.length - 1].indent) levels.pop()
      const top = levels[levels.length - 1]
      if (!top || indent >= top.indent + 2) levels.push({ indent })
      const depth = levels.length - 1
      const ordered = /\d/.test(item[2])
      const current = block as { ordered: boolean; depth: number } | null
      if (!current || current.depth !== depth || current.ordered !== ordered) {
        flushBlock()
        flushPara()
        block = { ordered, depth, start: ordered ? parseInt(item[2], 10) : 1, items: [] }
      }
      target = [taskBox(item[3] ?? '')]
      block!.items.push(target)
      blank = false
      continue
    }
    const inside = indent >= levels[0].indent + 2
    const fence = openFence(line)
    if (fence && inside) {
      flushBlock()
      flushPara()
      i = readFence(lines, i, fence, out) - 1
      target = null
      blank = false
      continue
    }
    // A paragraph after a blank line belongs to the item only when indented; any
    // other block start (heading, quote, …) ends the list.
    if (!inside && (blank || !target || interrupts(lines, i))) break
    if (!target) target = para = []
    if (blank) target.push('')
    target.push(line.trim())
    blank = false
  }
  flushBlock()
  flushPara()
  return i
}

/** GitHub task boxes; ☑ asks for text presentation (Windows would draw a colour emoji). */
const taskBox = (text: string) => text.replace(/^\[([ xX])\][ \t]+/, (_, mark: string) => (mark === ' ' ? '☐ ' : '☑\uFE0E '))

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i]
  const delimiter = lines[i + 1]
  if (!head.includes('|') || delimiter === undefined || !delimiter.includes('|') || !DELIMITER_ROW.test(delimiter)) return false
  return splitRow(head).length === splitRow(delimiter).length
}

function readTable(lines: string[], start: number, out: Block[]): number {
  const header = splitRow(lines[start])
  const rows = [header]
  let i = start + 2
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (isBlank(line) || !line.includes('|') || openFence(line) || HEADING.test(line) || QUOTE.test(line)) break
    const cells = splitRow(line).slice(0, header.length)
    while (cells.length < header.length) cells.push('')
    rows.push(cells)
  }
  // Tables can't hold line breaks, so people write <br>.
  out.push({ type: 'table', rows: rows.map((cells) => cells.map((cell) => parseInlines(cell.replace(/<br\s*\/?>/gi, '\n')))) })
  return i
}

/** Cells of `| a | b |`, split on pipes that aren't escaped (`\|` is a pipe in the cell, even in code). */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += s[i]
  }
  cells.push(cell.trim())
  return cells
}

// ------------------------------------------------------------------ inlines

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Inline code first (it binds tightest), then emphasis, links and bare URLs.
 *  Markers without a partner stay literal. Searches that found nothing are
 *  remembered, so thousands of unclosed markers still parse in linear time. */
export function parseInlines(s: string): Inline[] {
  /** `${key}:${end}` → a search from this position (or later) up to `end` finds nothing. */
  const failed = new Map<string, number>()
  const knownMiss = (key: string, from: number, end: number) => {
    const at = failed.get(`${key}:${end}`)
    return at !== undefined && from >= at
  }
  const miss = (key: string, from: number, end: number) => {
    const k = `${key}:${end}`
    const at = failed.get(k)
    if (at === undefined || from < at) failed.set(k, from)
    return -1
  }

  const run = (i: number, c: string, end: number) => {
    let j = i
    while (j < end && s[j] === c) j++
    return j - i
  }

  /** Start of the next run of exactly `n` backticks in [from, end), or -1. */
  const closingTicks = (from: number, end: number, n: number): number => {
    if (knownMiss(`\`${n}`, from, end)) return -1
    for (let j = from; j < end; j++) {
      if (s[j] !== '`') continue
      const r = run(j, '`', end)
      if (r === n) return j
      j += r - 1
    }
    return miss(`\`${n}`, from, end)
  }

  /** Where `n` closing delimiters `d` start in [from, end), skipping code spans and escapes. */
  const closer = (d: string, n: 1 | 2, from: number, end: number): number => {
    if (knownMiss(`${d}${n}`, from, end)) return -1
    for (let j = from; j < end; j++) {
      const c = s[j]
      if (c === '\\') {
        j++
        continue
      }
      if (c === '`') {
        const r = run(j, '`', end)
        const close = closingTicks(j + r, end, r)
        j = (close >= 0 ? close + r : j + r) - 1
        continue
      }
      if (c !== d) continue
      const r = run(j, d, end)
      const valid = j > from && !isSpace(s[j - 1]) && (d !== '_' || !isAlnum(s[j + r]))
      if (valid) {
        if (n === 2 && r >= 2) return j + r - 2
        if (n === 1 && r === 1) return j
        if (n === 1 && r >= 3) return j + r - 1 // *a **b***
      }
      j += r - 1 // a pair inside belongs to a nested emphasis
    }
    return miss(`${d}${n}`, from, end)
  }

  /** `]` matching the `[` at `open`, or -1. Link texts are short: the search stops after
   *  LINK_TEXT_MAX characters (a miss can't be remembered: `[a [b]` fails at 0, not at 3). */
  const closeBracket = (open: number, end: number): number => {
    let depth = 0
    const stop = Math.min(end, open + LINK_TEXT_MAX)
    for (let j = open + 1; j < stop; j++) {
      const c = s[j]
      if (c === '\\') j++
      else if (c === '`') {
        const r = run(j, '`', end)
        const close = closingTicks(j + r, end, r)
        j = (close >= 0 ? close + r : j + r) - 1
      } else if (c === '[') depth++
      else if (c === ']') {
        if (depth === 0) return j
        depth--
      }
    }
    return -1
  }

  /** `[text](href "title")` or `![alt](src)` at i: the nodes and where parsing goes on. */
  const link = (i: number, end: number): { nodes: Inline[]; next: number } | null => {
    const image = s[i] === '!'
    const open = image ? i + 1 : i
    const close = closeBracket(open, end)
    if (close < 0 || close + 1 >= end || s[close + 1] !== '(') return null
    let j = close + 2
    while (j < end && s[j] === ' ') j++
    let href = ''
    if (s[j] === '<') {
      const gt = s.indexOf('>', j)
      if (gt < 0 || gt >= end) return null
      href = s.slice(j + 1, gt)
      j = gt + 1
    } else {
      const from = j
      let parens = 0
      for (; j < end && !isSpace(s[j]); j++) {
        if (s[j] === '\\') j++
        else if (s[j] === '(') parens++
        else if (s[j] === ')') {
          if (parens === 0) break
          parens--
        }
      }
      href = s.slice(from, j).replace(/\\(.)/g, '$1')
    }
    while (j < end && s[j] === ' ') j++
    const quote = s[j]
    if (quote === '"' || quote === "'") {
      const q = s.indexOf(quote, j + 1)
      if (q < 0 || q >= end) return null
      j = q + 1
      while (j < end && s[j] === ' ') j++
    }
    if (j >= end || s[j] !== ')') return null
    const label = s.slice(open + 1, close)
    const safe = SAFE_HREF.test(href)
    const children = image ? (label ? [{ type: 'text' as const, text: label }] : safe ? [{ type: 'text' as const, text: href }] : []) : parse(open + 1, close)
    return { nodes: safe ? [{ type: 'link', href, children }] : children, next: j + 1 }
  }

  const parse = (start: number, end: number): Inline[] => {
    const out: Inline[] = []
    let buf = ''
    const flush = () => {
      if (buf) push(out, { type: 'text', text: buf })
      buf = ''
    }
    let i = start
    while (i < end) {
      const c = s[i]
      if (c === '\\' && i + 1 < end && PUNCTUATION.has(s[i + 1])) {
        buf += s[i + 1]
        i += 2
        continue
      }
      if (c === '`') {
        const n = run(i, '`', end)
        const close = closingTicks(i + n, end, n)
        if (close < 0) {
          buf += s.slice(i, i + n)
          i += n
          continue
        }
        let body = s.slice(i + n, close).replace(/\n/g, ' ')
        if (body.length > 2 && body[0] === ' ' && body[body.length - 1] === ' ' && body.trim()) body = body.slice(1, -1)
        flush()
        out.push({ type: 'code', text: body })
        i = close + n
        continue
      }
      if (c === '*' || c === '_') {
        const n = run(i, c, end)
        const opens = !isSpace(s[i + n]) && i + n < end && (c !== '_' || !isAlnum(s[i - 1]))
        if (opens) {
          const strongClose = n >= 2 ? closer(c, 2, i + 2, end) : -1
          if (strongClose >= 0) {
            flush()
            out.push({ type: 'strong', children: parse(i + 2, strongClose) })
            i = strongClose + 2
            continue
          }
          const emClose = n === 1 ? closer(c, 1, i + 1, end) : -1
          if (emClose >= 0) {
            flush()
            out.push({ type: 'em', children: parse(i + 1, emClose) })
            i = emClose + 1
            continue
          }
        }
        // No partner: one marker is text, and the rest of the run gets its own chance (**a* → *<em>a</em>).
        buf += c
        i++
        if (!opens) {
          buf += s.slice(i, i + n - 1)
          i += n - 1
        }
        continue
      }
      if (c === '[' || (c === '!' && s[i + 1] === '[')) {
        const found = link(i, end)
        if (found) {
          flush()
          for (const node of found.nodes) push(out, node)
          i = found.next
          continue
        }
      }
      if (c === '<') {
        const gt = s.indexOf('>', i)
        const inner = gt > i && gt < end ? s.slice(i + 1, gt) : ''
        if (SAFE_HREF.test(inner) && !/[\s<]/.test(inner)) {
          flush()
          out.push({ type: 'link', href: inner, children: [{ type: 'text', text: inner }] })
          i = gt + 1
          continue
        }
      }
      if ((c === 'h' || c === 'H') && s.slice(i, i + 4).toLowerCase() === 'http' && !isAlnum(s[i - 1])) {
        const url = bareUrl(s.slice(i, Math.min(end, i + 2048)))
        if (url) {
          flush()
          out.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] })
          i += url.length
          continue
        }
      }
      buf += c
      i++
    }
    flush()
    return out
  }

  return parse(0, s.length)
}

/** A URL at the start of `s`, without trailing punctuation or an unbalanced `)` (GitHub's rules). */
function bareUrl(s: string): string | null {
  const m = BARE_URL.exec(s)
  if (!m) return null
  let url = m[0]
  for (;;) {
    const last = url[url.length - 1]
    if ('?!.,:;*_~\'"'.includes(last)) url = url.slice(0, -1)
    else if (last === ')' && count(url, '(') < count(url, ')')) url = url.slice(0, -1)
    else break
  }
  return /^https?:\/\/[^/?#]/i.test(url) ? url : null
}

const count = (s: string, c: string) => s.split(c).length - 1

/** Appends, merging neighbouring text. */
function push(out: Inline[], node: Inline) {
  const last = out[out.length - 1]
  if (node.type === 'text' && last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + node.text }
  else out.push(node)
}
