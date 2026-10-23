// Base URL for Gapeka 2025 API (uses Vite proxy in dev to avoid CORS)
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

/** Station: [id, code, name, lat, lng] */
export type StationTuple = [number, string, string, number, number]

export interface Station {
  id: number
  code: string
  name: string
  lat: number
  lng: number
}

/** Route point: [dist_cm, lat, lng] */
export type RoutePt = [number, number, number]

export interface RouteSegment {
  pos: [number, number][]
  pos_cm?: number[]
}

export interface Route {
  id: number
  len_cm: number
  paths?: RouteSegment[]
  pts?: [number, number, number][]
}

export interface TrainStop {
  st: string         // station code
  arr_ms: number
  dep_ms: number
  arr: string | null // "HH:MM:SS", "Ls", or null
  dep: string | null
  inv?: boolean      // invisible stop
}

export interface Train {
  id: number
  code: string
  name: string
  from: string       // origin station code
  to: string         // destination station code
  dep_ms: number     // departure from origin in ms from midnight
  arr_ms: number     // arrival at destination in ms from midnight
  day_ms: number     // always 86400000
  stops: TrainStop[]
}

// ─────────────────────────────────────────
// Normalizers
// ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeStation(raw: any): Station {
  if (Array.isArray(raw)) {
    return {
      id: Number(raw[0] ?? 0),
      code: String(raw[1] ?? ''),
      name: String(raw[2] ?? ''),
      lat: Number(raw[3] ?? 0),
      lng: Number(raw[4] ?? 0),
    }
  }
  return {
    id: Number(raw.st_id ?? raw.id ?? 0),
    code: String(raw.cd ?? raw.code ?? ''),
    name: String(raw.nm ?? raw.name ?? ''),
    lat: Number(Array.isArray(raw.pos) ? raw.pos[0] : (raw.lat ?? 0)),
    lng: Number(Array.isArray(raw.pos) ? raw.pos[1] : (raw.lng ?? 0)),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRoute(raw: any): Route {
  return {
    id: Number(raw.route_id ?? raw.id ?? 0),
    len_cm: Number(raw.len_cm ?? 0),
    paths: Array.isArray(raw.paths) ? raw.paths : undefined,
    pts: Array.isArray(raw.pts) ? raw.pts : undefined,
  }
}

/**
 * Gapeka 2025 raw data uses "paths" for stops, and timestamps in UTC ms.
 * This normalizes time strings (e.g. "14:15:00" WIB) or converts UTC ms to local ms from midnight.
 */
function parseTimeToLocalMs(timeStr: string | null | undefined, fallbackUtcMs?: number): number {
  if (timeStr && timeStr !== 'Ls' && timeStr !== 'null') {
    const parts = timeStr.split(':')
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10) || 0
      const m = parseInt(parts[1], 10) || 0
      const s = parseInt(parts[2] || '0', 10) || 0
      return (h * 3600 + m * 60 + s) * 1000
    }
  }
  if (typeof fallbackUtcMs === 'number' && !isNaN(fallbackUtcMs)) {
    // Gapeka timestamps in ms are UTC; Indonesian train operations run on WIB (UTC+7)
    return (fallbackUtcMs + 7 * 3600 * 1000) % 86400000
  }
  return 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTrain(raw: any): Train {
  // Real API returns "paths", fallback to "stops"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPaths: any[] = Array.isArray(raw.paths)
    ? raw.paths
    : Array.isArray(raw.stops)
    ? raw.stops
    : []

  const stops: TrainStop[] = rawPaths.map((p) => {
    const st = String(p.st_cd ?? p.st ?? '')
    const depStr = p.usr_depart ?? p.dep ?? null
    const arrStr = p.usr_arriv ?? p.arr ?? null
    const dep_ms = parseTimeToLocalMs(depStr, p.depart_ms ?? p.dep_ms)
    const arr_ms = parseTimeToLocalMs(arrStr, p.arriv_ms ?? p.arr_ms)
    const inv = Boolean(p.inv_route ?? p.inv ?? false)

    return {
      st,
      dep_ms,
      arr_ms,
      dep: depStr === 'null' || !depStr ? null : depStr,
      arr: arrStr === 'null' || !arrStr ? null : arrStr,
      inv,
    }
  })

  const firstStop = stops[0]
  const lastStop = stops[stops.length - 1]

  const dep_ms = parseTimeToLocalMs(firstStop?.dep, raw.depart_ms ?? raw.dep_ms)
  const arr_ms = parseTimeToLocalMs(lastStop?.arr, raw.arriv_ms ?? raw.arr_ms)

  return {
    id: Number(raw.tr_id ?? raw.id ?? 0),
    code: String(raw.tr_cd ?? raw.code ?? ''),
    name: String(raw.tr_name ?? raw.name ?? ''),
    from: String(raw.start_st_cd ?? raw.from ?? firstStop?.st ?? ''),
    to: String(raw.end_st_cd ?? raw.to ?? lastStop?.st ?? ''),
    dep_ms,
    arr_ms,
    day_ms: Number(raw.mod_day_ms ?? raw.day_ms ?? 86400000),
    stops,
  }
}

// ─────────────────────────────────────────
// API Fetchers
// ─────────────────────────────────────────

let _stationsCache: Station[] | null = null
let _routesCache: Route[] | null = null
let _gapekaCache: Train[] | null = null

export function clearApiCache() {
  _stationsCache = null
  _routesCache = null
  _gapekaCache = null
}

export async function fetchStations(): Promise<Station[]> {
  if (_stationsCache) return _stationsCache
  let res = await fetch(`${BASE_URL}/public-station/stations`)
  if (!res.ok) res = await fetch(`${BASE_URL}/public-route/route-path`)
  if (!res.ok) throw new Error(`Stations fetch failed: ${res.status}`)
  const json = await res.json()
  const rawList = json.stations || json.data || (Array.isArray(json) ? json : [])
  _stationsCache = (rawList as any[])
    .map(normalizeStation)
    .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && !isNaN(s.lat) && !isNaN(s.lng) && s.lat !== 0 && s.lng !== 0)
  return _stationsCache
}

export async function fetchRoutes(): Promise<Route[]> {
  if (_routesCache) return _routesCache
  let res = await fetch(`${BASE_URL}/public-route/route-path`)
  if (!res.ok) res = await fetch(`${BASE_URL}/public-station/stations`)
  if (!res.ok) throw new Error(`Routes fetch failed: ${res.status}`)
  const json = await res.json()
  const rawList = json.routes || json.data || (Array.isArray(json) ? json : [])
  _routesCache = (rawList as any[]).map(normalizeRoute)
  return _routesCache
}

export async function fetchGapeka(): Promise<Train[]> {
  if (_gapekaCache) return _gapekaCache
  const res = await fetch(`${BASE_URL}/public-train/gapeka`)
  if (!res.ok) throw new Error(`Gapeka fetch failed: ${res.status}`)
  const json = await res.json()
  const rawList = json.trains ?? json.data ?? (Array.isArray(json) ? json : [])
  _gapekaCache = Array.isArray(rawList)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? rawList.filter((t): t is Record<string, any> => !!t && typeof t === 'object').map(normalizeTrain)
    : []
  return _gapekaCache
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

/** Convert milliseconds from midnight to "HH:MM" string */
export function msToHHMM(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Duration in ms → human readable "X j Y mnt" or "Y mnt" */
export function msToDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return m > 0 ? `${h} j ${m} mnt` : `${h} j`
  }
  return `${totalMin} mnt`
}

/** Current time as ms from midnight (local) */
export function nowMs(): number {
  const now = new Date()
  return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000
}

/**
 * Get trains departing from a given station code in the next `windowMinutes` minutes.
 * Returns results sorted by dep_ms.
 */
export function getUpcomingTrainsFromStation(
  trains: Train[],
  stationCode: string,
  windowMinutes = 180,
): Array<{ train: Train; stop: TrainStop }> {
  const now = nowMs()
  const windowMs = windowMinutes * 60 * 1000

  const results: Array<{ train: Train; stop: TrainStop }> = []

  for (const train of (trains || [])) {
    if (!train || !Array.isArray(train.stops)) continue
    const stop = train.stops.find((s) => s && s.st === stationCode && !s.inv)
    if (!stop) continue
    const diff = stop.dep_ms - now
    if (diff >= 0 && diff <= windowMs) {
      results.push({ train, stop })
    }
  }

  return results.sort((a, b) => a.stop.dep_ms - b.stop.dep_ms)
}
