import { describe, expect, it } from 'vitest'
import { parseMarkdown, type Block, type Inline } from './markdown'

const text = (t: string): Inline => ({ type: 'text', text: t })
const code = (t: string): Inline => ({ type: 'code', text: t })
const strong = (...children: Inline[]): Inline => ({ type: 'strong', children })
const em = (...children: Inline[]): Inline => ({ type: 'em', children })
const link = (href: string, ...children: Inline[]): Inline => ({ type: 'link', href, children })
const p = (...inlines: Inline[]): Block => ({ type: 'paragraph', inlines })
/** The inlines of a one-paragraph document. */
const inline = (src: string) => {
  const blocks = parseMarkdown(src)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].type).toBe('paragraph')
  return (blocks[0] as Extract<Block, { type: 'paragraph' }>).inlines
}

describe('paragraphs', () => {
  it('split on blank lines; a single newline stays a line break', () => {
    expect(parseMarkdown('one\ntwo\n\n\nthree')).toEqual([p(text('one\ntwo')), p(text('three'))])
  })
  it('trim the lines and ignore blank input', () => {
    expect(parseMarkdown('  a  \n   b')).toEqual([p(text('a\nb'))])
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(' \n\t\n')).toEqual([])
  })
  it('accept Windows line endings', () => {
    expect(parseMarkdown('a\r\nb\r\n\r\nc')).toEqual([p(text('a\nb')), p(text('c'))])
  })
})

describe('fenced code', () => {
  it('is kept verbatim, without inline parsing', () => {
    const src = 'Run:\n\n```ts\nconst a = *b* + `c` // [x](https://y)\n\n  <b>indented</b>\n```\nafter'
    expect(parseMarkdown(src)).toEqual([
      p(text('Run:')),
      { type: 'code', lang: 'ts', text: 'const a = *b* + `c` // [x](https://y)\n\n  <b>indented</b>' },
      p(text('after')),
    ])
  })
  it('takes tildes, longer fences, an info string and no language', () => {
    expect(parseMarkdown('~~~\nx\n~~~')).toEqual([{ type: 'code', lang: '', text: 'x' }])
    expect(parseMarkdown('````md title="a"\n```\ninner\n```\n````')).toEqual([
      { type: 'code', lang: 'md', text: '```\ninner\n```' },
    ])
  })
  it('interrupts a paragraph, and an unclosed fence runs to the end', () => {
    expect(parseMarkdown('see\n```sh\nnpm test\n\nmore')).toEqual([
      p(text('see')),
      { type: 'code', lang: 'sh', text: 'npm test\n\nmore' },
    ])
  })
  it('drops the indentation of an indented fence', () => {
    expect(parseMarkdown('   ```\n   a\n     b\n   ```')).toEqual([{ type: 'code', lang: '', text: 'a\n  b' }])
  })
})

describe('inline code', () => {
  it('wins over emphasis', () => {
    expect(inline('`a*b*` and *x `*` y*')).toEqual([code('a*b*'), text(' and '), em(text('x '), code('*'), text(' y'))])
  })
  it('takes longer backtick runs and trims one space on each side', () => {
    expect(inline('`` a ` b `` and ` x `')).toEqual([code('a ` b'), text(' and '), code('x')])
  })
})

describe('emphasis', () => {
  it('**bold**, __bold__, *em*, _em_ and both at once', () => {
    expect(inline('**b** __u__ *e* _f_ ***x***')).toEqual([
      strong(text('b')), text(' '), strong(text('u')), text(' '), em(text('e')), text(' '), em(text('f')), text(' '),
      strong(em(text('x'))),
    ])
  })
  it('nests', () => {
    expect(inline('**bold *and em* here**')).toEqual([strong(text('bold '), em(text('and em')), text(' here'))])
    expect(inline('*em **and bold** here*')).toEqual([em(text('em '), strong(text('and bold')), text(' here'))])
    expect(inline('*a **b***')).toEqual([em(text('a '), strong(text('b')))])
  })
  it('leaves underscores inside words and spaced asterisks alone', () => {
    expect(inline('snake_case_name and __init__.py')).toEqual([text('snake_case_name and '), strong(text('init')), text('.py')])
    expect(inline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')])
    expect(inline('a_b_')).toEqual([text('a_b_')])
  })
})

describe('links', () => {
  it('[text](url) for http, https and mailto', () => {
    expect(inline('[Deck](https://example.com/a_(b)) and [mail](mailto:f@x.io) and [h](http://x.io "title")')).toEqual([
      link('https://example.com/a_(b)', text('Deck')), text(' and '), link('mailto:f@x.io', text('mail')), text(' and '),
      link('http://x.io', text('h')),
    ])
  })
  it('keeps the text of other links, without the link', () => {
    expect(inline('[x](javascript:alert(1)) [file.ts](src/file.ts) [**b**](ftp://y)')).toEqual([
      text('x '), text('file.ts'), text(' '), strong(text('b')),
    ].reduce(merge, []))
  })
  it('parses the link text as inlines', () => {
    expect(inline('[`run` *now*](https://x.io)')).toEqual([link('https://x.io', code('run'), text(' '), em(text('now')))])
  })
  it('links bare and <angle> URLs, without trailing punctuation', () => {
    expect(inline('See https://github.com/x/y/pull/2. Or (https://x.io/a_b_c), <https://z.io/q?a=1>!')).toEqual([
      text('See '), link('https://github.com/x/y/pull/2', text('https://github.com/x/y/pull/2')), text('. Or ('),
      link('https://x.io/a_b_c', text('https://x.io/a_b_c')), text('), '), link('https://z.io/q?a=1', text('https://z.io/q?a=1')),
      text('!'),
    ])
  })
  it('shows an image as its alt text (no remote content)', () => {
    expect(inline('![diagram](https://x.io/a.png) ![](data:x)')).toEqual([link('https://x.io/a.png', text('diagram')), text(' ')])
  })
})

describe('lists', () => {
  it('-, * and + bullets', () => {
    expect(parseMarkdown('- a\n* **b**\n+ c')).toEqual([
      { type: 'list', ordered: false, items: [[text('a')], [strong(text('b'))], [text('c')]] },
    ])
  })
  it('ordered lists keep their first number', () => {
    expect(parseMarkdown('1. one\n2. two')).toEqual([{ type: 'list', ordered: true, items: [[text('one')], [text('two')]] }])
    expect(parseMarkdown('3) three\n4) four')).toEqual([
      { type: 'list', ordered: true, start: 3, items: [[text('three')], [text('four')]] },
    ])
  })
  it('interrupt a paragraph; continuation lines join the item', () => {
    expect(parseMarkdown('Changes:\n- first\n  wraps here\n- second\n\nDone.')).toEqual([
      p(text('Changes:')),
      { type: 'list', ordered: false, items: [[text('first\nwraps here')], [text('second')]] },
      p(text('Done.')),
    ])
  })
  it('stay one list across blank lines', () => {
    expect(parseMarkdown('- a\n\n- b')).toEqual([{ type: 'list', ordered: false, items: [[text('a')], [text('b')]] }])
  })
  it('nested items get a depth; the outer list carries on with its numbering', () => {
    expect(parseMarkdown('1. one\n   - a\n   - b\n2. two')).toEqual([
      { type: 'list', ordered: true, items: [[text('one')]] },
      { type: 'list', ordered: false, depth: 1, items: [[text('a')], [text('b')]] },
      { type: 'list', ordered: true, start: 2, items: [[text('two')]] },
    ])
  })
  it('a fence inside an item becomes a code block between the parts of the list', () => {
    expect(parseMarkdown('1. Install:\n   ```sh\n   npm i\n   ```\n2. Test')).toEqual([
      { type: 'list', ordered: true, items: [[text('Install:')]] },
      { type: 'code', lang: 'sh', text: 'npm i' },
      { type: 'list', ordered: true, start: 2, items: [[text('Test')]] },
    ])
  })
  it('task list boxes', () => {
    expect(parseMarkdown('- [ ] todo\n- [x] done')).toEqual([
      { type: 'list', ordered: false, items: [[text('☐ todo')], [text('☑\uFE0E done')]] },
    ])
  })
  it('need a space after the marker', () => {
    expect(parseMarkdown('-1 and *em*')).toEqual([p(text('-1 and '), em(text('em')))])
  })
})

describe('other blocks', () => {
  it('> quotes', () => {
    expect(parseMarkdown('> one *a*\n> two\n\nafter')).toEqual([
      { type: 'quote', inlines: [text('one '), em(text('a')), text('\ntwo')] },
      p(text('after')),
    ])
  })
  it('# … ###### headings; #tag is text', () => {
    expect(parseMarkdown('# One\n## Two ##\n###### Six *x*\n#tag\n####### seven')).toEqual([
      { type: 'heading', level: 1, inlines: [text('One')] },
      { type: 'heading', level: 2, inlines: [text('Two')] },
      { type: 'heading', level: 6, inlines: [text('Six '), em(text('x'))] },
      p(text('#tag\n####### seven')),
    ])
  })
  it('---, *** and ___ rules, also right after a paragraph', () => {
    expect(parseMarkdown('a\n---\n\n***\n_ _ _')).toEqual([p(text('a')), { type: 'rule' }, { type: 'rule' }, { type: 'rule' }])
  })
  it('GitHub tables', () => {
    const src = 'Results:\n| File | Change |\n|:-----|-------:|\n| `a.ts` | **new** |\n| b\\|c | x | extra |\n| d |\n\nafter'
    expect(parseMarkdown(src)).toEqual([
      p(text('Results:')),
      {
        type: 'table',
        rows: [
          [[text('File')], [text('Change')]],
          [[code('a.ts')], [strong(text('new'))]],
          [[text('b|c')], [text('x')]],
          [[text('d')], []],
        ],
      },
      p(text('after')),
    ])
  })
  it('a pipe without a delimiter row is just text', () => {
    expect(parseMarkdown('a | b\nc | d')).toEqual([p(text('a | b\nc | d'))])
  })
})

describe('literal text', () => {
  it('unclosed markers stay literal', () => {
    expect(inline('**bold and *em and `code and [text](')).toEqual([text('**bold and *em and `code and [text](')])
    expect(inline('**a*')).toEqual([text('*'), em(text('a'))])
    expect(inline('[a] (https://x.io)')).toEqual([text('[a] ('), link('https://x.io', text('https://x.io')), text(')')])
  })
  it('backslash escapes', () => {
    expect(inline('\\*not em\\* and \\`tick\\`')).toEqual([text('*not em* and `tick`')])
  })
  it('HTML stays text', () => {
    expect(inline('<b>x</b> <img src=x onerror=alert(1)>')).toEqual([text('<b>x</b> <img src=x onerror=alert(1)>')])
  })
})

describe('speed', () => {
  it('parses a 20 KB reply in < 20 ms', () => {
    const section = (n: number) => [
      `## Section ${n}`,
      '',
      `Some **bold** text with \`code\`, a [link](https://example.com/${n}) and *em*; snake_case_name and 2 * 3.`,
      'A second line with https://github.com/x/y/pull/12 and __init__.py.',
      '',
      '- item one',
      '- item **two** with `inline` code',
      '  - nested item',
      '1. first',
      '2. second',
      '',
      '```ts',
      `const x${n} = { a: 1, b: [2, 3] } // *not* parsed`,
      '```',
      '',
      '| File | Change |',
      '|------|--------|',
      `| \`src/${n}.ts\` | **added** |`,
      '',
      '> a quote with *emphasis*',
      '',
      '---',
      '',
    ].join('\n')
    let src = ''
    for (let n = 0; src.length < 20_000; n++) src += section(n)
    // Pathological input must stay fast too: thousands of unclosed openers.
    const nasty = '*a _b `c [d '.repeat(400)
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now()
      parseMarkdown(src)
      parseMarkdown(nasty)
      best = Math.min(best, performance.now() - t0)
    }
    expect(src.length).toBeGreaterThanOrEqual(20_000)
    expect(best).toBeLessThan(20)
  })
})

/** Adjacent text nodes merged, as the parser emits them. */
function merge(out: Inline[], node: Inline): Inline[] {
  const last = out[out.length - 1]
  if (last?.type === 'text' && node.type === 'text') out[out.length - 1] = text(last.text + node.text)
  else out.push(node)
  return out
}
