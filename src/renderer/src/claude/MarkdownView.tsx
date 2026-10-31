import { memo, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from './markdown'

// Parsed replies by text: a reply that mounts again (the panel shown again, a session
// picked again) isn't parsed again. Oldest out first.
const cache = new Map<string, Block[]>()
const CACHE_SIZE = 400

function blocksOf(text: string): Block[] {
  const hit = cache.get(text)
  if (hit) return hit
  const blocks = parseMarkdown(text)
  cache.set(text, blocks)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return blocks
}

/** A reply's markdown as React elements: nothing in it is ever used as HTML. */
export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => blocksOf(text), [text])
  return <div className="md">{blocks.map((block, i) => <BlockView key={i} block={block} />)}</div>
})

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{inlines(block.inlines)}</p>
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, block.level))}` as 'h1'
      return <Tag>{inlines(block.inlines)}</Tag>
    }
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />
    case 'list': {
      const items = block.items.map((item, i) => <li key={i}>{inlines(item)}</li>)
      const style = block.depth ? { marginLeft: `${block.depth * 1.15}em` } : undefined
      const className = block.depth ? 'md-nested' : undefined
      return block.ordered
        ? <ol start={block.start} style={style} className={className}>{items}</ol>
        : <ul style={style} className={className}>{items}</ul>
    }
    case 'quote':
      return <blockquote>{inlines(block.inlines)}</blockquote>
    case 'rule':
      return <hr />
    case 'table': {
      const [head, ...body] = block.rows
      return (
        <div className="md-table">
          <table>
            <thead><tr>{head.map((cell, i) => <th key={i}>{inlines(cell)}</th>)}</tr></thead>
            <tbody>
              {body.map((row, r) => <tr key={r}>{row.map((cell, i) => <td key={i}>{inlines(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )
    }
    default:
      return null
  }
}

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => <InlineView key={i} node={node} />)
}

function InlineView({ node }: { node: Inline }) {
  switch (node.type) {
    case 'text':
      return node.text
    case 'code':
      return <code>{node.text}</code>
    case 'strong':
      return <strong>{inlines(node.children)}</strong>
    case 'em':
      return <em>{inlines(node.children)}</em>
    case 'link':
      return <Link href={node.href}>{inlines(node.children)}</Link>
    default:
      return null
  }
}

/** Opens in the browser: the window itself never navigates. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const open = (e: MouseEvent) => {
    e.preventDefault()
    if (e.type === 'click' || e.button === 1) window.deck.app.openExternal(href)
  }
  return <a href={href} title={href} draggable={false} onClick={open} onAuxClick={open}>{children}</a>
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className="md-code">
      <pre><code>{text}</code></pre>
      {lang && <span className="md-lang" aria-hidden="true">{lang}</span>}
      <button className={copied ? 'md-copy copied' : 'md-copy'} title="Copy the code"
        onClick={() => {
          window.deck.app.copyText(text)
          setCopied(true)
        }}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  )
}
