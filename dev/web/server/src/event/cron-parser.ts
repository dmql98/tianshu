/**
 * Minimal 5-field cron parser with timezone-aware next-fire computation.
 *
 * Fields: minute hour day-of-month month day-of-week (0-6, Sunday=0).
 * Supported syntax: star, question-mark, step (star slash n), lists,
 * ranges and plain numbers.
 * Not supported: L, W, names (JAN/MON), at-daily style shorthands.
 */

export interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
}

export function parseCronField(spec: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  if (spec === '*' || spec === '?') {
    for (let v = min; v <= max; v++) values.add(v)
    return values
  }
  for (const part of spec.split(',')) {
    const stepMatch = /^(\*|\d+)(?:-(\d+))?\/(\d+)$/.exec(part)
    if (stepMatch) {
      const from = stepMatch[1] === '*' ? min : parseInt(stepMatch[1], 10)
      const to = stepMatch[2] ? parseInt(stepMatch[2], 10) : max
      const step = parseInt(stepMatch[3], 10)
      if (step <= 0) throw new Error(`Invalid cron step in "${spec}"`)
      for (let v = from; v <= to; v += step) values.add(v)
      continue
    }
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range) {
      const from = parseInt(range[1], 10)
      const to = parseInt(range[2], 10)
      for (let v = from; v <= to; v++) values.add(v)
      continue
    }
    const single = /^\d+$/.exec(part)
    if (single) {
      values.add(parseInt(single[0], 10))
      continue
    }
    throw new Error(`Unsupported cron field token "${part}" in "${spec}"`)
  }
  for (const v of values) {
    if (v < min || v > max) throw new Error(`Cron value ${v} out of range [${min},${max}] in "${spec}"`)
  }
  return values
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields, got "${expr}"`)
  const [minute, hour, dom, month, dow] = parts
  return {
    minutes: parseCronField(minute, 0, 59),
    hours: parseCronField(hour, 0, 23),
    daysOfMonth: parseCronField(dom, 1, 31),
    months: parseCronField(month, 1, 12),
    daysOfWeek: parseCronField(dow, 0, 6),
  }
}

interface LocalParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  wd: number
}

function localParts(ms: number, timeZone: string): LocalParts {
  // Format in the target timezone by re-rendering at shifted UTC.
  const shifted = new Date(ms)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const map: Record<string, string> = {}
  for (const p of formatter.formatToParts(shifted)) map[p.type] = p.value
  const weekdayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: parseInt(map.year, 10),
    mo: parseInt(map.month, 10),
    d: parseInt(map.day, 10),
    h: parseInt(map.hour, 10) % 24,
    mi: parseInt(map.minute, 10),
    wd: weekdayNames[map.weekday] ?? 0,
  }
}

/** UTC ms → ms in the target timezone's local calendar, as an integer offset. */
function tzOffsetMs(ms: number, timeZone: string): number {
  const shifted = new Date(ms)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of formatter.formatToParts(shifted)) map[p.type] = p.value
  const localAsUtc = Date.UTC(
    parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10),
    parseInt(map.hour, 10) % 24, parseInt(map.minute, 10), parseInt(map.second, 10),
  )
  return localAsUtc - ms
}

interface WallClock {
  y: number
  mo: number
  d: number
  h: number
  mi: number
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

function dayOfWeek(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

/** Convert a wall-clock instant to UTC ms, verifying the wall clock round-trips. */
function wallToUtc(w: WallClock, timeZone: string, referenceMs: number): number | null {
  const baseOffset = tzOffsetMs(referenceMs, timeZone)
  // DST transitions may shift the offset by an hour (spring forward creates a
  // hole; fall back repeats an hour). Probe ±2h around the reference offset.
  for (const shift of [0, 1, -1, 2, -2]) {
    const candidate = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, 0) - (baseOffset + shift * 3600000)
    const p = localParts(candidate, timeZone)
    if (p.y === w.y && p.mo === w.mo && p.d === w.d && p.h === w.h && p.mi === w.mi) return candidate
  }
  return null
}

function normalizeClock(w: WallClock): void {
  while (w.mi > 59) { w.mi -= 60; w.h++ }
  while (w.h > 23) { w.h -= 24; w.d++ }
  while (w.d > daysInMonth(w.y, w.mo)) { w.d -= daysInMonth(w.y, w.mo); w.mo++ }
  while (w.mo > 12) { w.mo -= 12; w.y++ }
}

export interface NextFireOptions {
  fromMs?: number
  maxIterations?: number
}

/**
 * Compute the next instant (UTC ms) matching the expression in the given
 * IANA timezone, strictly after fromMs. Returns null when no match exists
 * within the iteration budget (roughly years ahead).
 */
export function nextFireTime(expr: string, timeZone: string, opts: NextFireOptions = {}): number | null {
  const fields = parseCronExpression(expr)
  const fromMs = opts.fromMs ?? Date.now()
  const maxIterations = opts.maxIterations ?? 4000

  // Start from the wall clock of the next whole minute.
  const start = localParts(fromMs, timeZone)
  const w: WallClock = { y: start.y, mo: start.mo, d: start.d, h: start.h, mi: start.mi + 1 }
  normalizeClock(w)

  for (let guard = 0; guard < maxIterations; guard++) {
    if (!fields.months.has(w.mo)) {
      w.mo++; w.d = 1; w.h = 0; w.mi = 0
      normalizeClock(w)
      continue
    }
    const domOk = fields.daysOfMonth.has(w.d)
    const dowOk = fields.daysOfWeek.has(dayOfWeek(w.y, w.mo, w.d))
    if (!(domOk || dowOk)) {
      w.d++; w.h = 0; w.mi = 0
      normalizeClock(w)
      continue
    }
    if (!fields.hours.has(w.h)) {
      w.h++; w.mi = 0
      normalizeClock(w)
      continue
    }
    if (!fields.minutes.has(w.mi)) {
      w.mi++
      normalizeClock(w)
      continue
    }
    const utc = wallToUtc(w, timeZone, fromMs)
    if (utc === null) {
      // A wall-clock hour that cannot be realized (DST spring-forward hole):
      // skip the whole hour.
      w.h++; w.mi = 0
      normalizeClock(w)
      continue
    }
    return utc
  }
  return null
}
