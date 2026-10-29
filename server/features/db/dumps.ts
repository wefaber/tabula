// Automatic dumps before a console write. The name carries the UTC time to the millisecond so two dumps never collide;
// rotation keeps the newest `KEEP_DUMPS` and only touches files that match that name.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const KEEP_DUMPS = 10
const DUMP_NAME = /^\d{8}-\d{9}-[\w.-]+\.sql$/

export function dumpFileName(now: Date, dbName: string): string {
  const iso = now.toISOString() // 2026-10-28T22:04:00.123Z
  const day = iso.slice(0, 10).replaceAll('-', '')
  const time = iso.slice(11, 23).replaceAll(/[:.]/g, '')
  return `${day}-${time}-${dbName.replace(/[^\w.-]/g, '_')}.sql`
}

/** Names to delete so that only the newest `keep` dumps remain. */
export function rotationPlan(names: string[], keep = KEEP_DUMPS): string[] {
  return names
    .filter((n) => DUMP_NAME.test(n))
    .sort()
    .reverse()
    .slice(keep)
}

export async function writeDump(
  dir: string,
  name: string,
  text: string,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), text, { mode: 0o600 })
}

export async function pruneDumps(
  dir: string,
  keep = KEEP_DUMPS,
): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  for (const n of rotationPlan(names, keep))
    await rm(join(dir, n), { force: true })
}
