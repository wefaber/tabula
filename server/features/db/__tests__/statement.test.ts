import { describe, expect, test } from 'bun:test'
import { classifyStatement } from '../statement'

const ok = (sql: string) => {
  const r = classifyStatement(sql)
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason} for ${sql}`)
  return r
}
const no = (sql: string) => {
  const r = classifyStatement(sql)
  if (r.ok) throw new Error(`expected rejection for: ${sql}`)
  return r.reason
}

describe('reads', () => {
  test.each([
    'SELECT * FROM usuario',
    'select cedula from usuario where rol = "Administrador" limit 10',
    'SHOW TABLES',
    'SHOW CREATE TABLE usuario',
    'DESCRIBE usuario',
    'DESC usuario',
    'EXPLAIN SELECT 1',
    "SELECT 'INTO', 'OUTFILE' FROM usuario",
    'SELECT `into` FROM `load`',
    'SELECT 1;',
  ])('accepts %p as read', (sql) => {
    expect(ok(sql).kind).toBe('read')
  })

  test('reports the verb, uppercased', () => {
    expect(ok('select 1').verb).toBe('SELECT')
  })
})

describe('rejected', () => {
  test('multi-statement', () => {
    expect(no('SELECT 1; DROP TABLE usuario')).toContain('más de una sentencia')
    expect(no('SELECT 1; SELECT 2')).toContain('más de una sentencia')
  })

  test('comments of every kind (they can hide a statement)', () => {
    expect(no('SELECT 1 -- DROP TABLE x')).toContain('comentarios')
    expect(no('SELECT 1 # x')).toContain('comentarios')
    expect(no('SELECT /* DROP */ 1')).toContain('comentarios')
    expect(no('SELECT 1 /*! DROP TABLE x */')).toContain('comentarios')
  })

  test('file access and locking', () => {
    expect(no("SELECT * FROM usuario INTO OUTFILE '/tmp/x'")).toContain(
      'OUTFILE',
    )
    expect(no("SELECT * FROM usuario INTO DUMPFILE '/tmp/x'")).toContain(
      'DUMPFILE',
    )
    expect(no("SELECT LOAD_FILE('/etc/passwd')")).toContain('LOAD_FILE')
    expect(no('SELECT * FROM usuario INTO @x')).toContain('INTO')
    expect(no('SELECT * FROM usuario FOR UPDATE')).toContain('bloquear')
    expect(no('SELECT * FROM usuario LOCK IN SHARE MODE')).toContain('bloquear')
    expect(no('SELECT SLEEP(10)')).toContain('SLEEP')
    expect(no('SELECT GET_LOCK("x", 1)')).toContain('GET_LOCK')
  })

  test('backslash outside a string (mysql client shell escape)', () => {
    expect(no('\\! rm -rf /')).toContain('"\\"')
    expect(no('SELECT 1 \\G')).toContain('"\\"')
  })

  test('unterminated quotes and control characters', () => {
    expect(no("SELECT 'abc")).toContain('sin cerrar')
    expect(no('SELECT `abc')).toContain('sin cerrar')
    expect(no('SELECT 1\u0000')).toContain('control')
    expect(no('SELECT 1\u0007')).toContain('control')
  })

  test('empty input and over-long input', () => {
    expect(no('   ')).toContain('Escribí')
    expect(no('x'.repeat(20_001))).toContain('demasiado larga')
  })

  test('verbs outside the allow-list', () => {
    expect(no('DELETE FROM usuario ; SELECT 1')).toContain(
      'más de una sentencia',
    )
    expect(no('GRANT ALL ON *.* TO x')).toContain('GRANT no está permitido')
    expect(no('SET GLOBAL max_connections = 1')).toContain(
      'SET no está permitido',
    )
    expect(no('CALL p()')).toContain('CALL no está permitido')
    expect(no('CREATE USER x')).toContain('CREATE USER')
    expect(no('DROP DATABASE nexus')).toContain('DROP DATABASE')
    expect(no('ALTER USER x')).toContain('ALTER USER')
  })
})

describe('writes', () => {
  test.each([
    'INSERT INTO ubicacion (seccion_inventario) VALUES ("Lab 3")',
    'UPDATE ubicacion SET esta_activa = 0 WHERE id_ubicacion = 1',
    'DELETE FROM ubicacion WHERE id_ubicacion = 1',
    'REPLACE INTO ubicacion VALUES (1, "x", 1)',
    'TRUNCATE TABLE historial_equipo',
    'CREATE TABLE t (id int)',
    'CREATE TEMPORARY TABLE t (id int)',
    'CREATE OR REPLACE VIEW v AS SELECT 1',
    'CREATE INDEX i ON ubicacion (seccion_inventario)',
    'ALTER TABLE ubicacion ADD COLUMN x int',
    'ALTER TABLE ubicacion ADD INDEX i (x)',
    'DROP TABLE t',
    'DROP INDEX i ON ubicacion',
    'DROP VIEW v',
    'RENAME TABLE a TO b',
  ])('accepts %p as write', (sql) => {
    expect(ok(sql).kind).toBe('write')
  })

  test('a write shape must name a table, index or view', () => {
    expect(no('CREATE DATABASE x')).toContain('solo tablas')
    expect(no('CREATE FUNCTION f() RETURNS int RETURN 1')).toContain(
      'solo tablas',
    )
    expect(no('DROP PROCEDURE p')).toContain('solo tablas')
    expect(no('RENAME USER a TO b')).toContain('RENAME')
  })

  test('the write verb is what the classifier reports', () => {
    expect(ok('update ubicacion set x = 1').verb).toBe('UPDATE')
  })
})

describe('output for the audit log', () => {
  test('redacted keeps the shape and drops literals', () => {
    const r = ok(
      "UPDATE usuario SET contrasena = 'hunter2', nombre = 'Ana' WHERE cedula = '123'",
    )
    expect(r.kind === 'write' || r.kind === 'read').toBe(true)
    if (!r.ok) return
    expect(r.redacted).not.toContain('hunter2')
    expect(r.redacted).not.toContain('Ana')
    expect(r.redacted).toContain("'?'")
  })

  test('idents are lowercase and include quoted names', () => {
    const r = ok('SELECT `Columna` FROM Usuario')
    if (!r.ok) throw new Error('x')
    expect(r.idents).toEqual(['select', 'columna', 'from', 'usuario'])
  })
})
