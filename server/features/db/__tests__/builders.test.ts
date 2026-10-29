import { describe, expect, test } from 'bun:test'
import {
  columnFromRow,
  isSecretName,
  kindOf,
  maskRow,
  MASK,
  parseEnumValues,
  type ColumnInfo,
} from '../columns'
import { DbError } from '../errors'
import { dumpFileName, KEEP_DUMPS, rotationPlan } from '../dumps'
import {
  countsSql,
  deleteSql,
  filterSql,
  insertSql,
  selectPageSql,
  updateSql,
} from '../queries'

const ubicacion: ColumnInfo[] = [
  columnFromRow([
    'id_ubicacion',
    'int(11)',
    'int',
    'NO',
    'PRI',
    null,
    'auto_increment',
  ]),
  columnFromRow([
    'seccion_inventario',
    'varchar(100)',
    'varchar',
    'NO',
    '',
    null,
    '',
  ]),
  columnFromRow(['esta_activa', 'tinyint(1)', 'tinyint', 'NO', '', '1', '']),
]
const usuario: ColumnInfo[] = [
  columnFromRow(['cedula', 'varchar(15)', 'varchar', 'NO', 'PRI', null, '']),
  columnFromRow(['nombre', 'varchar(80)', 'varchar', 'NO', '', null, '']),
  columnFromRow(['contrasena', 'varchar(255)', 'varchar', 'NO', '', null, '']),
  columnFromRow(['foto', 'blob', 'blob', 'YES', '', null, '']),
  columnFromRow([
    'nombre_completo',
    'varchar(10)',
    'varchar',
    'YES',
    '',
    null,
    'VIRTUAL GENERATED',
  ]),
]
const consulta: ColumnInfo[] = [
  columnFromRow(['cedula', 'varchar(15)', 'varchar', 'NO', 'PRI', null, '']),
  columnFromRow(['id_ubicacion', 'int(11)', 'int', 'NO', 'PRI', null, '']),
]

describe('columns', () => {
  test('kindOf maps data types to value kinds', () => {
    expect(kindOf('int')).toBe('number')
    expect(kindOf('DECIMAL')).toBe('number')
    expect(kindOf('datetime')).toBe('datetime')
    expect(kindOf('timestamp')).toBe('datetime')
    expect(kindOf('enum')).toBe('string')
    expect(kindOf('longblob')).toBe('binary')
    expect(kindOf('json')).toBe('json')
  })

  test('parseEnumValues handles quotes and escapes', () => {
    expect(parseEnumValues("enum('Activo','Inactivo')")).toEqual([
      'Activo',
      'Inactivo',
    ])
    expect(parseEnumValues("enum('O''Brien','a\\'b')")).toEqual([
      "O'Brien",
      "a'b",
    ])
    expect(parseEnumValues('varchar(10)')).toEqual([])
  })

  test('columnFromRow reads the information_schema row in order', () => {
    const c = columnFromRow(['rol', "enum('A','B')", 'enum', 'NO', '', 'A', ''])
    expect(c).toMatchObject({
      name: 'rol',
      kind: 'string',
      nullable: false,
      key: '',
      defaultValue: 'A',
      enumValues: ['A', 'B'],
      secret: false,
    })
  })

  test('secret names are recognised', () => {
    for (const n of [
      'contrasena',
      'password',
      'totp_secreto',
      'api_key',
      'token',
      'hash_clave',
      'Contraseña',
    ]) {
      expect(isSecretName(n)).toBe(true)
    }
    expect(isSecretName('nombre')).toBe(false)
  })

  test('maskRow hides secret columns and values under a secret key', () => {
    const row = { cedula: '1', nombre: 'Ana', contrasena: '$2y$x', foto: null }
    expect(maskRow(usuario, row)).toEqual({
      cedula: '1',
      nombre: 'Ana',
      contrasena: MASK,
      foto: null,
    })
    const kv = [
      columnFromRow(['clave', 'varchar(60)', 'varchar', 'NO', 'PRI', null, '']),
      columnFromRow(['valor', 'varchar(255)', 'varchar', 'NO', '', null, '']),
    ]
    expect(maskRow(kv, { clave: 'smtp_password', valor: 'abc' })).toEqual({
      clave: 'smtp_password',
      valor: MASK,
    })
    expect(maskRow(kv, { clave: 'idioma', valor: 'es' })).toEqual({
      clave: 'idioma',
      valor: 'es',
    })
  })
})

describe('select and filter', () => {
  test('page query: ordered by primary key, quoted, with limit and offset', () => {
    expect(
      selectPageSql('ubicacion', ubicacion, {
        filter: '',
        offset: 25,
        limit: 25,
      }),
    ).toBe(
      'SELECT `id_ubicacion`, `seccion_inventario`, `esta_activa` FROM `ubicacion` ORDER BY `id_ubicacion` LIMIT 25 OFFSET 25',
    )
  })

  test('binary columns are not selected as raw bytes', () => {
    expect(
      selectPageSql('usuario', usuario, { filter: '', offset: 0, limit: 10 }),
    ).toContain("IF(`foto` IS NULL, NULL, '(binario)') AS `foto`")
  })

  test('filter searches text columns only, never secrets or binary', () => {
    const sql = filterSql(usuario, 'ana')
    expect(sql).toContain('CAST(`cedula` AS CHAR) LIKE')
    expect(sql).toContain('`nombre`')
    expect(sql).not.toContain('`contrasena`')
    expect(sql).not.toContain('`foto`')
    expect(sql).toContain("'%ana%'")
  })

  test('filter values are escaped: quotes, backslash and wildcards', () => {
    // term → LIKE pattern `%O'b\\c\%%` → string literal: quote, backslash and wildcard escapes stack.
    expect(filterSql(ubicacion, "O'b\\c%")).toContain(
      "LIKE '%O\\'b\\\\\\\\c\\\\%%'",
    )
  })

  test('empty filter adds nothing; overlong filter is refused', () => {
    expect(filterSql(ubicacion, '   ')).toBe('')
    expect(() => filterSql(ubicacion, 'x'.repeat(101))).toThrow(DbError)
  })

  test('a filter on a table with only secrets matches nothing', () => {
    expect(filterSql([usuario[2] as ColumnInfo], 'x')).toBe(' WHERE 1 = 0')
  })

  test('negative or non-integer paging is refused', () => {
    expect(() =>
      selectPageSql('ubicacion', ubicacion, {
        filter: '',
        offset: -1,
        limit: 10,
      }),
    ).toThrow(DbError)
    expect(() =>
      selectPageSql('ubicacion', ubicacion, {
        filter: '',
        offset: 0,
        limit: 1.5,
      }),
    ).toThrow(DbError)
  })

  test('counts for no tables still form valid SQL', () => {
    expect(countsSql([])).toContain('WHERE 1 = 0')
    expect(countsSql(['a', 'b'])).toBe(
      "SELECT 'a' AS name, COUNT(*) AS n FROM `a` UNION ALL SELECT 'b' AS name, COUNT(*) AS n FROM `b`",
    )
  })
})

describe('writes', () => {
  test('insert lists only the given columns, escaped by kind', () => {
    expect(
      insertSql('ubicacion', ubicacion, {
        seccion_inventario: "Lab 'x'",
        esta_activa: '0',
      }),
    ).toBe(
      "INSERT INTO `ubicacion` (`seccion_inventario`, `esta_activa`) VALUES ('Lab \\'x\\'', 0)",
    )
  })

  test('insert with nothing given uses the defaults', () => {
    expect(insertSql('ubicacion', ubicacion, {})).toBe(
      'INSERT INTO `ubicacion` () VALUES ()',
    )
  })

  test('insert refuses unknown columns and generated columns', () => {
    expect(() => insertSql('usuario', usuario, { nope: 'x' })).toThrow(
      'No existe la columna',
    )
    expect(() =>
      insertSql('usuario', usuario, { nombre_completo: 'x' }),
    ).toThrow('se calcula sola')
  })

  test('update: values with NULL, quoted identifiers, LIMIT 1, keyed by pk', () => {
    expect(
      updateSql(
        'ubicacion',
        ubicacion,
        { id_ubicacion: '3' },
        { esta_activa: '0', seccion_inventario: null },
      ),
    ).toBe(
      'UPDATE `ubicacion` SET `seccion_inventario` = NULL, `esta_activa` = 0 WHERE `id_ubicacion` = 3 LIMIT 1',
    )
  })

  test('update never touches the primary key and needs changes', () => {
    expect(() =>
      updateSql(
        'ubicacion',
        ubicacion,
        { id_ubicacion: '3' },
        { id_ubicacion: '4' },
      ),
    ).toThrow('La clave primaria no se cambia')
    expect(() =>
      updateSql('ubicacion', ubicacion, { id_ubicacion: '3' }, {}),
    ).toThrow('No hay cambios')
  })

  test('composite key: every key column in the WHERE', () => {
    expect(
      deleteSql('consulta', consulta, { cedula: '123', id_ubicacion: '9' }),
    ).toBe(
      "DELETE FROM `consulta` WHERE `cedula` = '123' AND `id_ubicacion` = 9 LIMIT 1",
    )
  })

  test('a key that is missing a column is refused', () => {
    expect(() => deleteSql('consulta', consulta, { cedula: '123' })).toThrow(
      'Falta la clave id_ubicacion',
    )
  })

  test('a table without primary key cannot be written by key', () => {
    const sinPk = [columnFromRow(['x', 'int(11)', 'int', 'YES', '', null, ''])]
    expect(() => deleteSql('t', sinPk, { x: '1' })).toThrow(
      'no tiene clave primaria',
    )
  })

  test('an injection attempt in a value stays a string literal', () => {
    const sql = insertSql('usuario', usuario, {
      cedula: "1'); DROP TABLE usuario; --",
      nombre: 'x',
    })
    expect(sql).toContain("'1\\'); DROP TABLE usuario; --'")
    expect(sql.startsWith('INSERT INTO `usuario`')).toBe(true)
  })

  test('a value of the wrong kind is refused before it reaches SQL', () => {
    expect(() =>
      insertSql('ubicacion', ubicacion, { esta_activa: 'yes; DROP' }),
    ).toThrow(DbError)
  })
})

describe('dumps', () => {
  test('file name carries UTC time to the millisecond and the db name', () => {
    expect(dumpFileName(new Date('2026-10-28T22:04:05.123Z'), 'nexus')).toBe(
      '20261028-220405123-nexus.sql',
    )
    expect(
      dumpFileName(new Date('2026-10-28T22:04:05.123Z'), 'bad name/x'),
    ).toBe('20261028-220405123-bad_name_x.sql')
  })

  test('rotation keeps the newest ten and only touches dump names', () => {
    const names = Array.from(
      { length: 12 },
      (_, i) =>
        `2026102${i % 10}-0000${String(i).padStart(2, '0')}000-nexus.sql`,
    )
    names.push('notes.txt')
    const del = rotationPlan(names)
    expect(del).toHaveLength(12 - KEEP_DUMPS)
    expect(del).not.toContain('notes.txt')
    expect(rotationPlan(names.slice(0, 3))).toEqual([])
  })
})
