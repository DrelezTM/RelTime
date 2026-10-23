// Base URL for Gapeka 2025 API
const BASE_URL = 'https://www.gapeka2025.com/api/v1'

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

export interface Route {
  id: number
  len_cm: number
  pts: RoutePt[]
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

function normalizeStation(tuple: StationTuple): Station {
  return {
    id: tuple[0],
    code: tuple[1],
    name: tuple[2],
    lat: tuple[3],
    lng: tuple[4],
  }
}

// ─────────────────────────────────────────
// API Fetchers
// ─────────────────────────────────────────

let _stationsCache: Station[] | null = null
let _routesCache: Route[] | null = null
let _gapekaCache: Train[] | null = null

export async function fetchStations(): Promise<Station[]> {
  if (_stationsCache) return _stationsCache
  const res = await fetch(`${BASE_URL}/public-station/stations`)
  if (!res.ok) throw new Error(`Stations fetch failed: ${res.status}`)
  const json = await res.json()
  _stationsCache = (json.stations as StationTuple[]).map(normalizeStation)
  return _stationsCache
}

export async function fetchRoutes(): Promise<Route[]> {
  if (_routesCache) return _routesCache
  const res = await fetch(`${BASE_URL}/public-route/route-path`)
  if (!res.ok) throw new Error(`Routes fetch failed: ${res.status}`)
  const json = await res.json()
  _routesCache = json.routes as Route[]
  return _routesCache
}

export async function fetchGapeka(): Promise<Train[]> {
  if (_gapekaCache) return _gapekaCache
  const res = await fetch(`${BASE_URL}/public-train/gapeka`)
  if (!res.ok) throw new Error(`Gapeka fetch failed: ${res.status}`)
  const json = await res.json()
  _gapekaCache = json.trains as Train[]
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

  for (const train of trains) {
    const stop = train.stops.find((s) => s.st === stationCode && !s.inv)
    if (!stop) continue
    const diff = stop.dep_ms - now
    if (diff >= 0 && diff <= windowMs) {
      results.push({ train, stop })
    }
  }

  return results.sort((a, b) => a.stop.dep_ms - b.stop.dep_ms)
}
