/**
 * Run: npx tsx src/event/cron-parser.test.ts
 */

import { parseCronExpression, nextFireTime } from './cron-parser.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

function localFields(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) map[p.type] = p.value
  return {
    y: +map.year, mo: +map.month, d: +map.day, h: +map.hour % 24, mi: +map.minute,
  }
}

const SHANGHAI = 'Asia/Shanghai'

// ---- field parsing ----------------------------------------------------------
{
  const f = parseCronExpression('*/15 2-4 1,15 * *')
  assert(f.minutes.size === 4 && f.minutes.has(0) && f.minutes.has(45), 'step minutes')
  assert(f.hours.has(2) && f.hours.has(4) && !f.hours.has(5), 'range hours')
  assert(f.daysOfMonth.has(1) && f.daysOfMonth.has(15) && f.daysOfMonth.size === 2, 'list dom')
  assert(f.months.size === 12, 'star month')
  assert(f.daysOfWeek.size === 7, 'star dow')
  assert(parseCronExpression('0 0 ? * *').daysOfMonth.size === 31, '? dom equals star')
  let threw = false
  try { parseCronExpression('0 0 32 * *') } catch { threw = true }
  assert(threw, 'out-of-range value rejected')
  let threw2 = false
  try { parseCronExpression('0 0 * *') } catch { threw2 = true }
  assert(threw2, '4-field expression rejected')
  console.log('  OK field parsing')
}

// ---- next fire in Asia/Shanghai ---------------------------------------------
{
  // 2026-07-31 10:00:00 +08:00 = 02:00 UTC
  const from = Date.UTC(2026, 6, 31, 2, 0, 0)
  const next = nextFireTime('30 14 * * *', SHANGHAI, { fromMs: from })
  assert(next !== null, 'next fire found')
  const p = localFields(next!, SHANGHAI)
  assert(p.h === 14 && p.mi === 30, `fires at 14:30 Shanghai, got ${p.h}:${p.mi}`)
  assert(next! > from, 'strictly after from')
  console.log('  OK daily fire time in Shanghai')
}

// ---- */5 minute cadence ------------------------------------------------------
{
  // 10:03 Shanghai → next at 10:05
  const from = Date.UTC(2026, 6, 31, 2, 3, 0)
  const next = nextFireTime('*/5 * * * *', SHANGHAI, { fromMs: from })
  const p = localFields(next!, SHANGHAI)
  assert(p.mi === 5, `*/5 lands on minute 5, got ${p.mi}`)
  console.log('  OK */5 cadence')
}

// ---- month boundary -----------------------------------------------------------
{
  // 2026-08-31 23:59 Shanghai → next daily at 09:00 on 2026-09-01
  const from = Date.UTC(2026, 7, 31, 15, 59, 0) // 23:59 +08
  const next = nextFireTime('0 9 * * *', SHANGHAI, { fromMs: from })
  const p = localFields(next!, SHANGHAI)
  assert(p.mo === 9 && p.d === 1 && p.h === 9 && p.mi === 0, `crosses month, got ${p.mo}/${p.d} ${p.h}:${p.mi}`)
  console.log('  OK month boundary')
}

// ---- day-of-week (Sunday=0) ----------------------------------------------------
{
  // 2026-08-01 is a Saturday. Monday 00:00 → 2026-08-03.
  const from = Date.UTC(2026, 7, 1, 16, 0, 0) // 2026-08-02 00:00 +08 (Sunday)
  const next = nextFireTime('0 0 * * 1', SHANGHAI, { fromMs: from })
  const p = localFields(next!, SHANGHAI)
  assert(p.d === 3, `next Monday is 08-03, got 08-${p.d}`)
  console.log('  OK day-of-week')
}

// ---- DST transition timezone (America/New_York) --------------------------------
{
  // Spring forward: 2026-03-08 02:00 local does not exist (EST→EDT). A cron
  // firing at 02:30 that day has no legal instant, so it is skipped and the
  // next legal firing is 2026-03-09 02:30 local.
  const from = Date.UTC(2026, 2, 7, 12, 0, 0)
  const next = nextFireTime('30 2 8 3 *', 'America/New_York', { fromMs: from })
  assert(next !== null, 'DST next fire found')
  const p = localFields(next!, 'America/New_York')
  assert(p.mo === 3 && p.d === 9 && p.h === 2 && p.mi === 30, `DST hole skipped, lands 3/9 02:30, got ${p.mo}/${p.d} ${p.h}:${p.mi}`)
  console.log('  OK DST spring-forward hole skipped')
}

// ---- DST fall-back does not skip a repeated hour ---------------------------------
{
  // Fall back: 2026-11-01 02:00 EDT repeats as 02:00 EST. A 02:30 cron should
  // still fire that day (twice, but at least once).
  const from = Date.UTC(2026, 10, 1, 4, 0, 0) // 2026-11-01 00:00 EDT
  const next = nextFireTime('30 2 1 11 *', 'America/New_York', { fromMs: from })
  assert(next !== null, 'fall-back next fire found')
  const p = localFields(next!, 'America/New_York')
  assert(p.mo === 11 && p.d === 1 && p.h === 2 && p.mi === 30, `fall-back day still fires, got ${p.mo}/${p.d} ${p.h}:${p.mi}`)
  console.log('  OK DST fall-back fires on the repeated hour')
}

// ---- year-rollover and far future -------------------------------------------------
{
  const from = Date.UTC(2026, 11, 31, 15, 0, 0) // 2026-12-31 23:00 +08
  const next = nextFireTime('5 0 1 1 *', SHANGHAI, { fromMs: from })
  assert(next !== null, 'year-rollover found')
  const p = localFields(next!, SHANGHAI)
  assert(p.y === 2027 && p.mo === 1 && p.d === 1 && p.h === 0 && p.mi === 5, 'fires 2027-01-01 00:05')
  console.log('  OK year rollover')
}

console.log('ALL CRON-PARSER TESTS PASSED')
