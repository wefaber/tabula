import { describe, expect, test } from 'bun:test'
import { decodeEntities, lastResult, parseXml } from '../xml'

const doc = (body: string) =>
  `<?xml version="1.0"?>\n<mariadb>\n${body}\n</mariadb>\n`

describe('parseXml', () => {
  test('reads columns and rows, NULL as null, text "NULL" as text', () => {
    const out = parseXml(
      doc(`<resultset statement="SELECT a, b FROM t" xmlns:xsi="x">
  <row>
    <field name="a">1</field>
    <field name="b" xsi:nil="true" />
  </row>
  <row>
    <field name="a">NULL</field>
    <field name="b"></field>
  </row>
</resultset>`),
    )
    expect(out).toEqual([
      {
        columns: ['a', 'b'],
        rows: [
          ['1', null],
          ['NULL', ''],
        ],
      },
    ])
  })

  test('keeps tabs, newlines and decodes entities in values', () => {
    const out = parseXml(
      doc(`<resultset statement="x">
  <row><field name="v">a &amp; b &lt;c&gt; &quot;q&quot; &apos;s&apos;
line2	tab</field></row>
</resultset>`),
    )
    expect(out[0]?.rows[0]?.[0]).toBe(`a & b <c> "q" 's'\nline2\ttab`)
  })

  test('the echoed statement attribute cannot leak into rows', () => {
    const out = parseXml(
      doc(`<resultset statement="SELECT &lt;row&gt;&lt;field name=&quot;x&quot;&gt;">
  <row><field name="a">ok</field></row>
</resultset>`),
    )
    expect(out[0]?.columns).toEqual(['a'])
    expect(out[0]?.rows).toEqual([['ok']])
  })

  test('statements that print nothing give no result sets', () => {
    expect(parseXml(doc(''))).toEqual([])
    expect(parseXml('')).toEqual([])
  })

  test('several result sets, in order; lastResult picks the caller statement', () => {
    const stdout =
      doc(`<resultset statement="a"><row><field name="x">1</field></row></resultset>
<resultset statement="b"><row><field name="y">2</field></row><row><field name="y">3</field></row></resultset>`)
    expect(parseXml(stdout)).toHaveLength(2)
    expect(lastResult(stdout)).toEqual({ columns: ['y'], rows: [['2'], ['3']] })
    expect(lastResult('')).toEqual({ columns: [], rows: [] })
  })

  test('an empty result set has no columns', () => {
    expect(parseXml(doc('<resultset statement="x"></resultset>'))).toEqual([
      { columns: [], rows: [] },
    ])
  })
})

describe('decodeEntities', () => {
  test('numeric references and unknown names', () => {
    expect(decodeEntities('&#65;&#x42;')).toBe('AB')
    expect(decodeEntities('&#x1F642;')).toBe('🙂')
    expect(decodeEntities('&bogus;')).toBe('&bogus;')
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;')
  })
})
