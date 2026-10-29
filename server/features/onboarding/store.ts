// Whether a user has already seen the first-use tour. Only the timestamp of the first completion is kept.
import type { Database } from 'bun:sqlite'

export function hasCompletedOnboarding(db: Database, userId: number): boolean {
  return (
    db
      .query<{ n: number }, [number]>(
        'SELECT COUNT(*) AS n FROM user_onboarding WHERE user_id = ?',
      )
      .get(userId)!.n > 0
  )
}

export function completeOnboarding(
  db: Database,
  userId: number,
  now = new Date(),
): void {
  db.query(
    'INSERT INTO user_onboarding (user_id, completed_at) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING',
  ).run(userId, now.toISOString())
}
