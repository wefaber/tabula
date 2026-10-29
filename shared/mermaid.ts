// Ask Ether's diagrams: split a Mermaid block out of an answer, draw it with Pele, and sanitize the SVG before it
// reaches the DOM. Pure (no DOM, no clock), so it runs under bun test. The diagram text comes from an LLM: untrusted.
import { PeleError, render } from 'pele'

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'mermaid'; code: string }

/** A closed ```mermaid fence. An open one (still streaming) stays text until its closing fence arrives. */
const FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n?```/g

export function splitMermaid(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const m of text.matchAll(FENCE)) {
    const at = m.index
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    parts.push({ kind: 'mermaid', code: (m[1] ?? '').trim() })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** Elements whose content is never drawn: the whole element goes, body included. */
const BODY_ELEMENTS =
  /<(script|foreignobject|iframe|object|embed)\b[\s\S]*?(?:<\/\1\s*>|$)/gi
/** Stray tags of the same elements, for an opening tag with no closing one. */
const STRAY_ELEMENTS =
  /<\/?(script|foreignobject|iframe|object|embed)\b[^>]*>/gi
const TAG = /<[a-zA-Z][^>]*>/g
const ATTR = /\s([^\s=>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
/** Schemes that run code or load data. Whitespace and controls go first: `java\tscript:` is still `javascript:`. */
const UNSAFE_URL = /^(javascript|vbscript|data):/i

const unsafeAttr = (name: string, value: string) =>
  /^on/i.test(name) ||
  UNSAFE_URL.test([...value].filter((c) => c.charCodeAt(0) > 0x20).join(''))

/**
 * Strips what can run or load from an SVG string: script, foreignObject and embeds, `on*` handlers, and
 * javascript:/vbscript:/data: URLs. Pele already escapes labels and filters links; this is the second layer.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(BODY_ELEMENTS, '')
    .replace(STRAY_ELEMENTS, '')
    .replace(TAG, (tag) =>
      tag.replace(
        ATTR,
        (attr, name: string, dq?: string, sq?: string, bare?: string) =>
          unsafeAttr(name, dq ?? sq ?? bare ?? '') ? '' : attr,
      ),
    )
}

export type Drawn = { svg: string } | { error: string }

/**
 * Draws one Mermaid source. Links and images are off: the text is an LLM's, and an image would fetch from the
 * network. `idPrefix` keeps the SVG ids of two diagrams on one page apart.
 */
export function drawMermaid(code: string, idPrefix: string): Drawn {
  try {
    const { svg } = render(code, { idPrefix, links: false, images: false })
    return { svg: sanitizeSvg(svg) }
  } catch (error) {
    return { error: error instanceof PeleError ? error.message : String(error) }
  }
}
