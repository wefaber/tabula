// Helpers of Ask Ether's diagrams live in shared/mermaid.ts. The tests sit here because tsconfig.app.json types the
// browser only, and bun:test needs bun's types.
import { describe, expect, test } from 'bun:test'
import {
  drawMermaid,
  sanitizeSvg,
  splitMermaid,
} from '../../../../shared/mermaid'

describe('dibujo con Pele', () => {
  test('un flowchart de ejemplo sale como SVG con sus etiquetas', () => {
    const r = drawMermaid('flowchart LR\n  A[Mermaid] --> B[SVG]', 'test-a')
    expect(r).toEqual({ svg: expect.stringContaining('<svg') })
    expect(r).toEqual({ svg: expect.stringContaining('Mermaid') })
    expect(r).toEqual({ svg: expect.stringContaining('SVG') })
  })

  test('un bloque inválido no dibuja: devuelve el motivo', () => {
    expect(drawMermaid('esto no es mermaid', 'test-b')).toEqual({
      error: expect.any(String),
    })
  })

  test('el SVG no trae links ni imágenes del texto del LLM', () => {
    const r = drawMermaid(
      'flowchart LR\n  A[Ir] --> B[Ver]\n  click A "https://example.com/x"',
      'test-c',
    )
    if (!('svg' in r)) throw new Error(r.error)
    expect(r.svg).not.toContain('<a ')
    expect(r.svg).not.toContain('<image')
  })
})

describe('bloques mermaid en una respuesta', () => {
  test('sin bloque, el texto queda igual', () => {
    expect(splitMermaid('hola\nchau')).toEqual([
      { kind: 'text', text: 'hola\nchau' },
    ])
  })

  test('el bloque sale de su texto y el resto queda como texto', () => {
    expect(
      splitMermaid('antes\n```mermaid\nflowchart LR\n  A --> B\n```\ndespués'),
    ).toEqual([
      { kind: 'text', text: 'antes\n' },
      { kind: 'mermaid', code: 'flowchart LR\n  A --> B' },
      { kind: 'text', text: '\ndespués' },
    ])
  })

  test('dos bloques en una respuesta', () => {
    const parts = splitMermaid(
      '```mermaid\nflowchart LR\n  A --> B\n```\ny\n```mermaid\nsequenceDiagram\n  A->>B: hola\n```',
    )
    expect(parts.map((p) => p.kind)).toEqual(['mermaid', 'text', 'mermaid'])
    expect(parts[2]).toEqual({
      kind: 'mermaid',
      code: 'sequenceDiagram\n  A->>B: hola',
    })
  })

  test('un bloque abierto (todavía streaming) queda como texto', () => {
    expect(splitMermaid('mirá\n```mermaid\nflowchart LR\n  A --> B')).toEqual([
      { kind: 'text', text: 'mirá\n```mermaid\nflowchart LR\n  A --> B' },
    ])
  })
})

describe('sanitizador del SVG', () => {
  test('saca script con su contenido', () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')).toBe(
      '<svg><rect/></svg>',
    )
  })

  test('saca un script sin cerrar', () => {
    expect(sanitizeSvg('<svg><script src=x></script>')).not.toContain('<script')
  })

  test('saca handlers on*', () => {
    expect(
      sanitizeSvg(
        '<svg><rect onload="alert(1)" width="3" ONCLICK=\'x()\'/></svg>',
      ),
    ).toBe('<svg><rect width="3"/></svg>')
  })

  test('saca foreignObject con todo lo que tiene adentro', () => {
    expect(
      sanitizeSvg(
        '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject><text>ok</text></svg>',
      ),
    ).toBe('<svg><text>ok</text></svg>')
  })

  test('saca javascript:, vbscript: y data: en cualquier atributo de URL', () => {
    expect(sanitizeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(
      '<svg><a>x</a></svg>',
    )
    expect(
      sanitizeSvg('<svg><a href="java\tscript:alert(1)">x</a></svg>'),
    ).toBe('<svg><a>x</a></svg>')
    expect(
      sanitizeSvg('<svg><use href=data:image/svg+xml,<svg/> /></svg>'),
    ).not.toContain('data:')
    expect(sanitizeSvg('<svg><a xlink:href="vbscript:x">y</a></svg>')).toBe(
      '<svg><a>y</a></svg>',
    )
  })

  test('un SVG normal y el texto "on x=1" en una etiqueta quedan intactos', () => {
    const svg =
      '<svg viewBox="0 0 10 10"><rect x="1" y="2" fill="#fff"/><text>on x=1</text></svg>'
    expect(sanitizeSvg(svg)).toBe(svg)
  })
})
