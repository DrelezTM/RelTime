import { useState, useEffect, useMemo, Component, type ReactNode, type ErrorInfo } from 'react'
import {
  Map as MapIcon, Clock, Train, Compass, X, ArrowRight, Loader2, RefreshCw,
  Search, MapPin, ChevronLeft, ChevronRight, LocateFixed, Check
} from 'lucide-react'
import {
  fetchGapeka, fetchStations, clearApiCache,
  msToHHMM, msToDuration, nowMs,
  type Train as TrainEntry, type Station, type TrainStop,
} from '../api'

type SidebarTab = 'maps' | 'jadwal' | 'kereta'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  activeTab?: SidebarTab
  onTabChange?: (tab: SidebarTab) => void
  selectedJadwalStation?: Station | null
  onSelectJadwalTrain?: (train: TrainData) => void
  selectedKeretaTrain?: TrainData | null
  onSelectKeretaTrain?: (train: TrainData) => void
  onFlyToStation?: (stationCode: string) => void
  stations?: Station[]
  trains?: TrainData[]
}

type TrainData = TrainEntry

// ── Error Boundary for Sidebar Panels ────────────────────────────
interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Sidebar panel crash:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <p className="text-sm font-semibold text-red-600">Terjadi kesalahan tampilan</p>
          <p className="text-xs text-slate-500 max-w-[280px] break-words">
            {this.state.error?.message || 'Gagal memuat komponen.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 text-xs font-semibold text-[#4D6BFE] hover:underline cursor-pointer"
          >
            Muat ulang tab
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Maps info panel ──────────────────────────────────────────────
interface MiniMapPanelProps {
  stationCount: number
  trains: TrainData[]
  loading: boolean
}

const MiniMapPanel = ({ stationCount, trains, loading }: MiniMapPanelProps) => {
  const isCommuter = (t: TrainData) =>
    /commuter|krl|lin|feeder|prameks|bandara/i.test(t.name) || /commuter|krl|lin/i.test(t.code)

  const commuterCount = trains.filter(isCommuter).length
  const jarakJauhCount = trains.length - commuterCount

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200/90 bg-[#EEF3FF] p-4 text-center">
        <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mx-auto mb-2.5 text-[#4D6BFE]">
          <MapIcon size={20} />
        </div>
        <h3 className="text-sm font-bold text-slate-800">Peta Rel Indonesia</h3>
        <p className="text-xs text-slate-500 mt-1">
          Data stasiun dan jalur rel diambil langsung dari{' '}
          <span className="font-semibold text-[#4D6BFE]">Gapeka 2025</span>.
          Klik pin stasiun atau kereta untuk melihat detailnya.
        </p>
      </div>

      {/* Stats cards: Total Stasiun, Total Commuter Line, Total Kereta Jarak Jauh */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-2.5 bg-[#EEF3FF] border border-[#DCE4FF] text-center">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-[#4D6BFE] mx-auto" />
          ) : (
            <div className="text-xl font-bold text-[#4D6BFE]">{stationCount}</div>
          )}
          <div className="text-[10px] font-semibold text-[#4D6BFE] mt-0.5 leading-tight">Total Stasiun</div>
        </div>

        <div className="rounded-xl p-2.5 bg-[#EEF3FF] border border-[#DCE4FF] text-center">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-[#4D6BFE] mx-auto" />
          ) : (
            <div className="text-xl font-bold text-[#4D6BFE]">{commuterCount}</div>
          )}
          <div className="text-[10px] font-semibold text-[#4D6BFE] mt-0.5 leading-tight">Commuter Line</div>
        </div>

        <div className="rounded-xl p-2.5 bg-[#EEF3FF] border border-[#DCE4FF] text-center">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-[#4D6BFE] mx-auto" />
          ) : (
            <div className="text-xl font-bold text-[#4D6BFE]">{jarakJauhCount}</div>
          )}
          <div className="text-[10px] font-semibold text-[#4D6BFE] mt-0.5 leading-tight">Jarak Jauh</div>
        </div>
      </div>

      {/* Legenda Pin: matches colors and symbols on map */}
      <div className="rounded-xl bg-white border border-slate-200 p-3.5 space-y-3 shadow-sm">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Legenda Peta</p>

        {/* Stasiun */}
        <div className="flex items-center gap-3">
          <div className="w-8 flex items-center justify-center shrink-0">
            <div className="w-5 h-5 bg-[#EC4899] border-2 border-white rounded-[50%_50%_50%_0] -rotate-45 flex items-center justify-center shadow-xs">
              <span className="w-1.5 h-1.5 bg-white rounded-full rotate-45" />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-800">Stasiun</div>
            <div className="text-[10px] text-slate-400">Pin pink + nama stasiun</div>
          </div>
        </div>

        {/* Commuter Line */}
        <div className="flex items-center gap-3">
          <div className="w-8 flex items-center justify-center shrink-0">
            <div className="w-6 h-6 rounded-full bg-[#3B82F6] text-white flex items-center justify-center shadow-xs border border-white">
              <Train size={12} />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-800">Commuter Line</div>
            <div className="text-[10px] text-slate-400">Badge biru + icon kereta</div>
          </div>
        </div>

        {/* Kereta Jarak Jauh */}
        <div className="flex items-center gap-3">
          <div className="w-8 flex items-center justify-center shrink-0">
            <div className="w-6 h-6 rounded-full bg-[#9333EA] text-white flex items-center justify-center shadow-xs border border-white">
              <Compass size={12} />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-800">Kereta Jarak Jauh</div>
            <div className="text-[10px] text-slate-400">Badge ungu + icon kompas</div>
          </div>
        </div>

        {/* Jalur Rel */}
        <div className="flex items-center gap-3">
          <div className="w-8 flex items-center justify-center shrink-0">
            <div className="w-6 h-1.5 bg-[#3B82F6] rounded-full" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-800">Jalur Rel</div>
            <div className="text-[10px] text-slate-400">Polyline rute rel kereta api</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function formatDistance(km?: number): string {
  if (km === undefined) return ''
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

interface ScoredStation {
  station: Station
  score: number
  distanceKm?: number
  trainCount: number
}

function scoreStation(
  query: string,
  st: Station,
  userCoords: { lat: number; lng: number } | null,
  trainCount: number
): ScoredStation | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  const qClean = q.replace(/[^a-z0-9]/g, '')
  const code = st.code.toLowerCase().replace(/^_/, '')
  const name = st.name.toLowerCase()
  const nameClean = name.replace(/[^a-z0-9]/g, '')

  let score = 0

  if (code === q || code === qClean) {
    score = 1000
  } else if (name === q || nameClean === qClean) {
    score = 900
  } else if (code.startsWith(q) || code.startsWith(qClean)) {
    score = 750
  } else if (name.startsWith(q) || nameClean.startsWith(qClean)) {
    score = 650
  } else if (name.split(/\s+/).some((w) => w.startsWith(q))) {
    score = 550
  } else if (name.includes(q) || nameClean.includes(qClean)) {
    score = 400
  } else if (code.includes(q)) {
    score = 300
  } else if (
    (q === 'jogja' || q === 'yogyakarta') &&
    (code === 'yk' || name.includes('tugu') || name.includes('yogyakarta'))
  ) {
    score = 850
  } else if (
    (q === 'solo' || q === 'surakarta') &&
    (code === 'slo' || name.includes('balapan') || name.includes('solo'))
  ) {
    score = 850
  } else if (q.length >= 4) {
    const lev = levenshteinDistance(q, name)
    if (lev <= 2) {
      score = 250 - lev * 40
    }
  }

  if (score <= 0) return null

  let distanceKm: number | undefined
  if (userCoords && st.lat && st.lng) {
    distanceKm = getDistanceKm(userCoords.lat, userCoords.lng, st.lat, st.lng)
  }

  return {
    station: st,
    score,
    distanceKm,
    trainCount,
  }
}

// ── Schedule panel ───────────────────────────────────────────────
interface JadwalPanelProps {
  trains: TrainData[]
  stations: Station[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  initialStation?: Station | null
  onSelectTrain?: (train: TrainData) => void
}

const JadwalPanel = ({
  trains,
  stations,
  loading,
  error,
  onRefresh,
  initialStation,
  onSelectTrain,
}: JadwalPanelProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)

  // Sync initialStation when opened from station popup
  useEffect(() => {
    if (initialStation) {
      setSelectedStation(initialStation)
      setSearchQuery(initialStation.name)
    }
  }, [initialStation])

  // Try silent geolocation once to display station distance
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 }
      )
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
        <Loader2 size={24} className="animate-spin text-[#4D6BFE]" />
        <span className="text-sm font-medium">Memuat jadwal Gapeka...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-10 gap-3 text-center">
        <p className="text-sm font-semibold text-red-600">Gagal memuat jadwal</p>
        <p className="text-xs text-slate-500">{error}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#4D6BFE] hover:underline cursor-pointer"
        >
          <RefreshCw size={12} /> Coba lagi
        </button>
      </div>
    )
  }

  const safeStations = Array.isArray(stations) ? stations : []
  const safeTrains = Array.isArray(trains) ? trains : []
  const stMap = new Map(safeStations.map((s) => [s.code, s.name]))
  const now = nowMs()

  // Calculate train counts per station
  const stationTrainCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const tr of safeTrains) {
      if (!Array.isArray(tr.stops)) continue
      for (const stp of tr.stops) {
        if (!stp || stp.inv) continue
        const code = stp.st.replace(/^_/, '').toUpperCase()
        map.set(code, (map.get(code) || 0) + 1)
      }
    }
    return map
  }, [safeTrains])

  // Top matching stations for search query, ordered by match relevance & distance
  const matchedStations = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return []

    const scored: ScoredStation[] = []
    const seenCodes = new Set<string>()

    for (const st of safeStations) {
      if (!st || !st.code || st.code.startsWith('_')) continue
      const cleanCode = st.code.replace(/^_/, '').toUpperCase()
      if (seenCodes.has(cleanCode)) continue

      const count = stationTrainCountMap.get(cleanCode) || 0
      const res = scoreStation(q, st, userCoords, count)
      if (res) {
        seenCodes.add(cleanCode)
        scored.push(res)
      }
    }

    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 120) {
        return b.score - a.score
      }
      if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
        if (Math.abs(a.distanceKm - b.distanceKm) > 10) {
          return a.distanceKm - b.distanceKm
        }
      }
      if (b.trainCount !== a.trainCount) {
        return b.trainCount - a.trainCount
      }
      return b.score - a.score
    })

    return scored.slice(0, 5)
  }, [searchQuery, safeStations, stationTrainCountMap, userCoords])

  // Active station: explicit selection or top match
  const activeStation = selectedStation || (matchedStations.length > 0 ? matchedStations[0].station : null)

  // Trains passing through or stopping at activeStation
  const stationSchedule = useMemo(() => {
    if (!activeStation) return []
    const targetCode = activeStation.code.replace(/^_/, '').toUpperCase()

    const list: Array<{
      train: TrainData
      stop: TrainStop
      toName: string
      fromName: string
      isPassingThrough: boolean
      isTerminating: boolean
      isOriginating: boolean
      depLabel: string
      arrLabel: string
      timeLabel: string
      diffMs: number
      diffText: string
      isCommuter: boolean
    }> = []

    for (const train of safeTrains) {
      if (!train || !Array.isArray(train.stops)) continue
      const stopIndex = train.stops.findIndex(
        (s) => s && s.st.replace(/^_/, '').toUpperCase() === targetCode && !s.inv
      )
      if (stopIndex === -1) continue

      const stop = train.stops[stopIndex]
      const isOriginating = stopIndex === 0 || train.from.replace(/^_/, '').toUpperCase() === targetCode
      const isTerminating = stopIndex === train.stops.length - 1 || train.to.replace(/^_/, '').toUpperCase() === targetCode
      const isPassingThrough = stop.dep === 'Ls' || stop.arr === 'Ls'

      let targetMs = stop.dep_ms
      if (isTerminating && stop.arr_ms) {
        targetMs = stop.arr_ms
      } else if (!targetMs && stop.arr_ms) {
        targetMs = stop.arr_ms
      }

      const diffMs = (targetMs - now + 86400000) % 86400000
      const diffMin = Math.round(diffMs / 60000)
      const diffText =
        diffMin <= 1 ? 'Segera' : diffMin < 60 ? `${diffMin} mnt` : `${Math.floor(diffMin / 60)} j ${diffMin % 60} mnt`

      const depLabel = stop.dep && stop.dep !== 'Ls' && stop.dep_ms ? msToHHMM(stop.dep_ms) : ''
      const arrLabel = stop.arr && stop.arr !== 'Ls' && stop.arr_ms ? msToHHMM(stop.arr_ms) : ''

      let timeLabel = ''
      if (isPassingThrough) {
        timeLabel = `Melintas ~${msToHHMM(targetMs)} (Ls)`
      } else if (isTerminating) {
        timeLabel = `Tiba ${arrLabel || msToHHMM(targetMs)} (Akhir)`
      } else if (isOriginating) {
        timeLabel = `Berangkat ${depLabel || msToHHMM(targetMs)} (Awal)`
      } else if (arrLabel && depLabel && arrLabel !== depLabel) {
        timeLabel = `Tiba ${arrLabel} • Berangkat ${depLabel}`
      } else {
        timeLabel = `Berangkat ${depLabel || arrLabel || msToHHMM(targetMs)}`
      }

      const isCommuter =
        /commuter|krl|lin|feeder|prameks|bandara/i.test(train.name) ||
        /commuter|krl|lin/i.test(train.code)

      const toName = stMap.get(train.to) ?? train.to
      const fromName = stMap.get(train.from) ?? train.from

      list.push({
        train,
        stop,
        toName,
        fromName,
        isPassingThrough,
        isTerminating,
        isOriginating,
        depLabel,
        arrLabel,
        timeLabel,
        diffMs,
        diffText,
        isCommuter,
      })
    }

    return list.sort((a, b) => a.diffMs - b.diffMs)
  }, [activeStation, safeTrains, now, stMap])

  // Default upcoming 20 departures across all trains (when search bar is empty)
  const defaultUpcoming = useMemo(() => {
    return safeTrains
      .flatMap((train) => {
        const stops = Array.isArray(train?.stops) ? train.stops : []
        return stops
          .filter((stop) => stop && !stop.inv && stop.dep !== null && stop.dep !== 'Ls')
          .map((stop) => {
            const diffMs = (stop.dep_ms - now + 86400000) % 86400000
            return { train, stop, diffMs }
          })
      })
      .sort((a, b) => a.diffMs - b.diffMs)
      .slice(0, 20)
  }, [safeTrains, now])

  const isSearchActive = searchQuery.trim().length > 0

  return (
    <div className="space-y-3">
      {/* ── Station Search Bar ── */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setSelectedStation(null)
          }}
          placeholder="Cari stasiun (cth: Manggarai, Gambir, MRI)..."
          className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium placeholder:text-slate-400 text-slate-900 shadow-xs focus:outline-none focus:border-[#4D6BFE] focus:ring-2 focus:ring-blue-100 transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('')
              setSelectedStation(null)
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
            title="Hapus pencarian"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Mode 1: Search Active ── */}
      {isSearchActive ? (
        <div className="space-y-3">
          {/* List of matching stations */}
          {matchedStations.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                <span>Stasiun Terdekat / Cocok</span>
                <span className="text-slate-400 font-semibold">{matchedStations.length} ditemukan</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {matchedStations.map((item) => {
                  const st = item.station
                  const isSelected = activeStation?.code === st.code
                  const distStr = item.distanceKm !== undefined ? formatDistance(item.distanceKm) : ''
                  return (
                    <button
                      key={st.code}
                      type="button"
                      onClick={() => setSelectedStation(st)}
                      className={`
                        w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer
                        ${isSelected
                          ? 'bg-blue-50/90 border-2 border-[#4D6BFE] shadow-xs'
                          : 'bg-white border border-slate-200 hover:border-blue-300 hover:bg-slate-50/80 shadow-xs'
                        }
                      `}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#4D6BFE] text-white'
                              : 'bg-pink-50 text-[#EC4899] border border-pink-200'
                          }`}
                        >
                          <MapPin size={15} />
                        </div>
                        <div className="truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 truncate">{st.name}</span>
                            <span className="text-[10px] font-bold font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {st.code}
                            </span>
                          </div>
                          <div className="text-[10.5px] text-slate-500 mt-0.5 flex items-center gap-1">
                            <span>{item.trainCount > 0 ? `${item.trainCount} kereta melewati` : 'Stasiun rel'}</span>
                            {distStr && (
                              <>
                                <span>•</span>
                                <span className="font-semibold text-slate-600">{distStr}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 ml-2">
                        {isSelected ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#4D6BFE] text-white">
                            Dipilih
                          </span>
                        ) : (
                          <span className="text-[10.5px] font-semibold text-slate-400">
                            Lihat →
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-7 px-4 rounded-xl bg-white border border-slate-200 text-slate-500 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                <MapPin size={18} />
              </div>
              <p className="text-xs font-bold text-slate-800">Stasiun tidak ditemukan</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-[260px] mx-auto">
                Tidak ada stasiun yang cocok dengan "{searchQuery}". Coba ketik nama stasiun atau kode stasiun.
              </p>
            </div>
          )}

          {/* Schedule results for the active station */}
          {activeStation && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Clock size={13} className="text-[#4D6BFE] shrink-0" />
                  <span className="text-xs font-bold text-slate-800 truncate">
                    Jadwal Melewati {activeStation.name}
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEF3FF] text-[#4D6BFE] border border-blue-200 shrink-0">
                  {stationSchedule.length} Kereta
                </span>
              </div>

              {stationSchedule.length === 0 ? (
                <div className="text-center py-8 rounded-xl bg-white border border-slate-200 p-4 text-xs text-slate-500 shadow-xs">
                  Tidak ada jadwal kereta yang melewati Stasiun {activeStation.name} saat ini.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {stationSchedule.map(
                    (
                      {
                        train,
                        stop,
                        toName,
                        fromName,
                        isPassingThrough,
                        isTerminating,
                        isOriginating,
                        timeLabel,
                        diffText,
                        isCommuter,
                      },
                      i
                    ) => (
                      <div
                        key={`${train.id}-${stop.st}-${i}`}
                        onClick={() => onSelectTrain?.(train)}
                        className="rounded-xl bg-white border border-slate-200 p-3.5 hover:border-blue-400 hover:shadow-md transition-all shadow-xs cursor-pointer group active:scale-[0.99]"
                        title="Klik untuk pusatkan posisi kereta di peta"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                              <span className="truncate max-w-[100px]">{fromName}</span>
                              <ArrowRight size={11} className="text-slate-400 shrink-0" />
                              <span className="truncate max-w-[100px]">{toName}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 font-medium flex items-center gap-1.5">
                              <span className="truncate">{train.name}</span>
                              <span>·</span>
                              <span className="font-mono text-slate-600 font-semibold">{train.code}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                              {diffText}
                            </span>
                            {isPassingThrough ? (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                Langsung (Ls)
                              </span>
                            ) : isTerminating ? (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                Tujuan Akhir
                              </span>
                            ) : isOriginating ? (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                Keberangkatan Awal
                              </span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-slate-50 text-slate-600 border border-slate-200">
                                Berhenti
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <Clock size={11} className="text-slate-400 shrink-0" />
                            <span className="font-semibold text-slate-800 text-[11px]">{timeLabel}</span>
                          </div>
                          <span
                            className={`text-[9.5px] px-2 py-0.5 rounded-full font-semibold border ${
                              isCommuter
                                ? 'bg-blue-50 text-[#3B82F6] border-blue-200'
                                : 'bg-purple-50 text-[#9333EA] border-purple-200'
                            }`}
                          >
                            {isCommuter ? 'Commuter Line' : 'Jarak Jauh'}
                          </span>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── Mode 2: Search Empty (Default 20 upcoming departures) ── */
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1 pb-0.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Clock size={13} className="text-[#4D6BFE]" />
              <span>Jadwal Keberangkatan Terdekat</span>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">Semua Stasiun</span>
          </div>

          {defaultUpcoming.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-500">
              Tidak ada kereta berangkat dalam waktu dekat.
            </div>
          ) : (
            defaultUpcoming.map(({ train, stop, diffMs }, i) => {
              const toName = stMap.get(train.to) ?? train.to
              const fromName = stMap.get(stop.st) ?? stop.st
              const depLabel = msToHHMM(stop.dep_ms)
              const arrLabel = msToHHMM(train.arr_ms)
              const dur = msToDuration((train.arr_ms - stop.dep_ms + 86400000) % 86400000)
              const diffMin = Math.round(diffMs / 60000)
              const diffText =
                diffMin <= 1 ? 'Segera' : diffMin < 60 ? `${diffMin} mnt` : `${Math.floor(diffMin / 60)} j ${diffMin % 60} mnt`

              return (
                <div
                  key={`${train.id}-${stop.st}-${i}`}
                  onClick={() => onSelectTrain?.(train)}
                  className="rounded-xl bg-white border border-slate-200 p-3.5 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group shadow-xs active:scale-[0.99]"
                  title="Klik untuk pusatkan posisi kereta di peta"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <span className="truncate max-w-[90px]">{fromName}</span>
                        <ArrowRight size={11} className="text-slate-400 shrink-0" />
                        <span className="truncate max-w-[90px]">{toName}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-medium">
                        {train.name} · {train.code}
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 shrink-0">
                      {diffText}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <Clock size={11} className="text-slate-400" />
                      <span className="font-semibold text-slate-800">{depLabel}</span>
                      <span className="text-slate-300">→</span>
                      <span className="text-slate-600">{arrLabel}</span>
                      <span className="text-slate-400">({dur})</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF3FF] text-[#4D6BFE] font-semibold border border-blue-100">
                      {stop.st}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── Train panel ──────────────────────────────────────────────────
interface KeretaPanelProps {
  trains: TrainData[]
  stations: Station[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  selectedTrain?: TrainData | null
  onSelectTrain?: (train: TrainData) => void
  onFlyToStation?: (stationCode: string) => void
}

function cleanStCode(code?: string): string {
  if (!code) return ''
  return code.replace(/^_/, '').toUpperCase()
}

function formatStopArrival(stop: TrainStop, isOrigin: boolean): string {
  if (isOrigin) return '—'
  if (stop.arr === 'Ls' || stop.dep === 'Ls') {
    return `~${msToHHMM(stop.arr_ms || stop.dep_ms)}`
  }
  if (stop.arr && stop.arr !== 'null' && stop.arr !== 'Ls') {
    return stop.arr.slice(0, 5)
  }
  return msToHHMM(stop.arr_ms)
}

function formatStopDeparture(stop: TrainStop, isTerminus: boolean): string {
  if (isTerminus) return '—'
  if (stop.dep === 'Ls' || stop.arr === 'Ls') {
    return 'Ls'
  }
  if (stop.dep && stop.dep !== 'null' && stop.dep !== 'Ls') {
    return stop.dep.slice(0, 5)
  }
  return msToHHMM(stop.dep_ms)
}

const KeretaPanel = ({
  trains,
  stations,
  loading,
  error,
  onRefresh,
  selectedTrain: propSelectedTrain,
  onSelectTrain,
  onFlyToStation,
}: KeretaPanelProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterChip, setFilterChip] = useState<'all' | 'berjalan' | 'commuter' | 'jarak-jauh'>('all')
  const [selectedTrain, setSelectedTrain] = useState<TrainData | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(25)

  // Sync internal selected train with external prop
  useEffect(() => {
    if (propSelectedTrain) {
      setSelectedTrain(propSelectedTrain)
    }
  }, [propSelectedTrain])

  const safeStations = useMemo(() => (Array.isArray(stations) ? stations : []), [stations])
  const safeTrains = useMemo(() => (Array.isArray(trains) ? trains : []), [trains])

  // Comprehensive station lookup dictionary
  const stMap = useMemo(() => {
    const map = new Map<string, Station>()
    for (const s of safeStations) {
      if (!s || !s.code) continue
      const raw = s.code
      const clean = cleanStCode(raw)
      map.set(raw, s)
      map.set(clean, s)
      map.set(clean.toLowerCase(), s)
    }
    return map
  }, [safeStations])

  const getStName = (code: string) => {
    const clean = cleanStCode(code)
    return stMap.get(clean)?.name || stMap.get(code)?.name || clean || code
  }

  const now = nowMs()

  // Helper to determine real-time status of a train
  const getTrainStatus = (train: TrainData) => {
    const isCommuter =
      /commuter|krl|lin|feeder|prameks|bandara/i.test(train.name) ||
      /commuter|krl|lin/i.test(train.code)

    const dep = train.dep_ms
    const arr = train.arr_ms

    const isActive = dep <= arr
      ? (dep <= now && now <= arr)
      : (now >= dep || now <= arr)

    let state: 'berjalan' | 'belum' | 'selesai' = 'selesai'
    if (isActive) {
      state = 'berjalan'
    } else if (dep <= arr) {
      state = now < dep ? 'belum' : 'selesai'
    } else {
      state = (now > arr && now < dep) ? 'belum' : 'selesai'
    }

    const totalDuration = (arr - dep + 86400000) % 86400000
    const elapsed = (now - dep + 86400000) % 86400000
    const progress = totalDuration > 0
      ? Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)))
      : 0

    // Next stop for active train
    const stops = Array.isArray(train.stops) ? train.stops.filter((s) => !s.inv) : []
    let nextStop: TrainStop | null = null
    let nextStopIdx = -1

    if (isActive && stops.length > 0) {
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i]
        const targetMs = s.dep_ms || s.arr_ms
        const diff = (targetMs - now + 86400000) % 86400000
        if (diff > 0 && diff < 43200000) {
          nextStop = s
          nextStopIdx = i
          break
        }
      }
    }

    const nextStopName = nextStop ? getStName(nextStop.st) : ''
    const nextStopEta = nextStop
      ? msToDuration((nextStop.arr_ms - now + 86400000) % 86400000)
      : ''

    return {
      isCommuter,
      isActive,
      state,
      totalDuration,
      progress,
      nextStop,
      nextStopIdx,
      nextStopName,
      nextStopEta,
      stopsCount: stops.length,
    }
  }

  // Filtered and scored trains list
  const filteredTrains = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const qClean = q.replace(/^ka\s+/i, '').trim()
    const qWords = qClean.split(/\s+/).filter(Boolean)

    let list = safeTrains

    // Filter by chip category
    if (filterChip === 'berjalan') {
      list = list.filter((t) => {
        const dep = t.dep_ms
        const arr = t.arr_ms
        return dep <= arr ? dep <= now && now <= arr : now >= dep || now <= arr
      })
    } else if (filterChip === 'commuter') {
      list = list.filter(
        (t) =>
          /commuter|krl|lin|feeder|prameks|bandara/i.test(t.name) ||
          /commuter|krl|lin/i.test(t.code)
      )
    } else if (filterChip === 'jarak-jauh') {
      list = list.filter(
        (t) =>
          !/commuter|krl|lin|feeder|prameks|bandara/i.test(t.name) &&
          !/commuter|krl|lin/i.test(t.code)
      )
    }

    if (!qClean) {
      // Sort: active trains first, then by departure time
      return [...list].sort((a, b) => {
        const aActive =
          a.dep_ms <= a.arr_ms ? a.dep_ms <= now && now <= a.arr_ms : now >= a.dep_ms || now <= a.arr_ms
        const bActive =
          b.dep_ms <= b.arr_ms ? b.dep_ms <= now && now <= b.arr_ms : now >= b.dep_ms || now <= b.arr_ms
        if (aActive !== bActive) return aActive ? -1 : 1
        return a.dep_ms - b.dep_ms
      })
    }

    const scored: Array<{ train: TrainData; score: number }> = []

    for (const t of list) {
      const codeLower = (t.code || '').toLowerCase()
      const nameLower = (t.name || '').toLowerCase()
      const fromName = getStName(t.from).toLowerCase()
      const toName = getStName(t.to).toLowerCase()
      const fromCode = cleanStCode(t.from).toLowerCase()
      const toCode = cleanStCode(t.to).toLowerCase()

      let score = 0

      // Exact code match
      if (codeLower === qClean) {
        score += 1200
      } else if (codeLower.startsWith(qClean)) {
        score += 700
      } else if (codeLower.includes(qClean)) {
        score += 450
      }

      // Train name match
      if (nameLower === qClean) {
        score += 900
      } else if (nameLower.startsWith(qClean)) {
        score += 600
      } else if (nameLower.includes(qClean)) {
        score += 350
      }

      // Origin / destination
      if (fromCode === qClean || toCode === qClean) {
        score += 400
      } else if (fromName.includes(qClean) || toName.includes(qClean)) {
        score += 300
      }

      // Multi-word match
      if (qWords.length > 1) {
        const matchesAll = qWords.every(
          (w) =>
            nameLower.includes(w) ||
            codeLower.includes(w) ||
            fromName.includes(w) ||
            toName.includes(w) ||
            fromCode.includes(w) ||
            toCode.includes(w)
        )
        if (matchesAll) score += 250
      }

      // Intermediate station match
      if (score === 0 && Array.isArray(t.stops)) {
        for (const stp of t.stops) {
          if (stp.inv) continue
          const stpCode = cleanStCode(stp.st).toLowerCase()
          const stpName = getStName(stp.st).toLowerCase()
          if (stpCode === qClean || stpName.includes(qClean)) {
            score += 180
            break
          }
        }
      }

      if (score > 0) {
        const isActive =
          t.dep_ms <= t.arr_ms ? t.dep_ms <= now && now <= t.arr_ms : now >= t.dep_ms || now <= t.arr_ms
        if (isActive) score += 60
        scored.push({ train: t, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.train)
  }, [safeTrains, searchQuery, filterChip, now, stMap])

  // Counts for summary chips
  const totalActiveCount = useMemo(() => {
    return safeTrains.filter((t) => {
      const dep = t.dep_ms
      const arr = t.arr_ms
      return dep <= arr ? dep <= now && now <= arr : now >= dep || now <= arr
    }).length
  }, [safeTrains, now])

  const handleSelectTrainCard = (train: TrainData) => {
    setSelectedTrain(train)
    onSelectTrain?.(train)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
        <Loader2 size={24} className="animate-spin text-[#4D6BFE]" />
        <span className="text-sm font-medium">Memuat data kereta Gapeka...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-10 gap-3 text-center">
        <p className="text-sm font-semibold text-red-600">Gagal memuat kereta</p>
        <p className="text-xs text-slate-500">{error}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#4D6BFE] hover:underline cursor-pointer"
        >
          <RefreshCw size={12} /> Coba lagi
        </button>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW MODE 1: DETAIL JADWAL & STASIUN KERETA TERPILIH
  // (Result memunculkan stasiun mana saja & jam berapa sampai)
  // ─────────────────────────────────────────────────────────────
  if (selectedTrain) {
    const {
      isCommuter,
      isActive,
      state,
      totalDuration,
      progress,
      nextStopIdx,
      nextStopName,
      nextStopEta,
    } = getTrainStatus(selectedTrain)

    const fromName = getStName(selectedTrain.from)
    const toName = getStName(selectedTrain.to)
    const fromCode = cleanStCode(selectedTrain.from)
    const toCode = cleanStCode(selectedTrain.to)

    const validStops = (selectedTrain.stops || []).filter((s) => !s.inv)
    const displayStops = validStops.length > 0 ? validStops : selectedTrain.stops || []

    return (
      <div className="space-y-3.5 pb-2">
        {/* Top bar: Back button + Fly to map button */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedTrain(null)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-[#4D6BFE] bg-white border border-slate-200 hover:border-blue-300 rounded-xl px-3 py-2 shadow-xs cursor-pointer transition-all active:scale-98"
          >
            <ChevronLeft size={16} />
            <span>Kembali ke Pencarian</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTrain?.(selectedTrain)}
            className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#4D6BFE] hover:bg-[#3B5BFE] px-3 py-2 rounded-xl shadow-xs cursor-pointer transition-all active:scale-98"
            title="Pusatkan posisi kereta di peta"
          >
            <LocateFixed size={14} />
            <span>Pusatkan di Peta</span>
          </button>
        </div>

        {/* Selected Train Header Card */}
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-[9.5px] px-2 py-0.5 rounded-full font-bold border ${
                    isCommuter
                      ? 'bg-blue-50 text-[#3B82F6] border-blue-200'
                      : 'bg-purple-50 text-[#9333EA] border-purple-200'
                  }`}
                >
                  {isCommuter ? 'Commuter Line' : 'Kereta Jarak Jauh'}
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                  KA {selectedTrain.code}
                </span>
              </div>

              <h3 className="text-base font-extrabold text-slate-900 mt-1.5 tracking-tight leading-snug">
                {selectedTrain.name}
              </h3>
            </div>

            {/* Status badge */}
            <div className="shrink-0">
              {state === 'berjalan' ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Sedang Berjalan
                </span>
              ) : state === 'belum' ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-300">
                  <Clock size={11} />
                  Belum Berangkat
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  🏁 Selesai
                </span>
              )}
            </div>
          </div>

          {/* Route Origin ➔ Destination */}
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Keberangkatan</div>
              <div className="font-bold text-slate-900 truncate">{fromName}</div>
              <div className="text-[10.5px] font-mono text-slate-500 font-semibold">{fromCode}</div>
            </div>
            <ArrowRight size={16} className="text-[#4D6BFE] shrink-0 mx-1" />
            <div className="flex-1 min-w-0 text-right">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Tujuan Akhir</div>
              <div className="font-bold text-slate-900 truncate">{toName}</div>
              <div className="text-[10.5px] font-mono text-slate-500 font-semibold">{toCode}</div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-center">
            <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0 break-words">
              <div className="text-[10px] text-slate-400 font-semibold break-words leading-tight">Jadwal Operasi</div>
              <div className="text-[11px] font-bold text-slate-800 font-mono mt-0.5 break-words">
                {msToHHMM(selectedTrain.dep_ms)} - {msToHHMM(selectedTrain.arr_ms)}
              </div>
            </div>
            <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0 break-words">
              <div className="text-[10px] text-slate-400 font-semibold break-words leading-tight">Total Durasi</div>
              <div className="text-[11px] font-bold text-slate-800 mt-0.5 break-words">
                {msToDuration(totalDuration)}
              </div>
            </div>
            <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0 break-words">
              <div className="text-[10px] text-slate-400 font-semibold break-words leading-tight">Pemberhentian</div>
              <div className="text-[11px] font-bold text-[#4D6BFE] mt-0.5 break-words">
                {displayStops.length} Stasiun
              </div>
            </div>
          </div>

          {/* Progress bar if active */}
          {isActive && (
            <div className="p-2.5 rounded-xl bg-[#EEF3FF] border border-[#DCE4FF] space-y-1.5">
              <div className="flex items-start justify-between text-xs gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-[#4D6BFE] uppercase tracking-wider">
                    Stasiun Berikutnya:
                  </div>
                  <div className="text-xs font-bold text-slate-900 truncate mt-0.5">
                    {nextStopName}
                  </div>
                </div>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                  {nextStopEta ? `~${nextStopEta}` : 'Segera'}
                </span>
              </div>
              <div className="h-1.5 bg-white rounded-full overflow-hidden border border-blue-200">
                <div
                  className="h-full bg-[#4D6BFE] rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                <span>{fromName}</span>
                <span className="font-bold text-[#4D6BFE]">{progress}% Perjalanan</span>
                <span>{toName}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Timeline Stasiun & Jam Sampai ── */}
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={13} className="text-[#4D6BFE]" />
                <span>Jadwal Kedatangan Stasiun</span>
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Urutan stasiun yang dilalui beserta jam tiba dan berangkat
              </p>
            </div>
            <span className="text-[10px] font-bold text-[#4D6BFE] bg-[#EEF3FF] px-2 py-0.5 rounded-md border border-[#DCE4FF]">
              {displayStops.length} Stasiun
            </span>
          </div>

          {/* Vertical Timeline */}
          <div className="relative pl-8 space-y-3.5">
            {/* Straight vertical stepper line */}
            <div className="absolute left-[16px] top-5 bottom-5 w-0.5 -translate-x-1/2 bg-slate-200" />

            {displayStops.map((stop, idx) => {
              const isOrigin = idx === 0
              const isTerminus = idx === displayStops.length - 1
              const isLs = stop.dep === 'Ls' || stop.arr === 'Ls'
              const stCode = cleanStCode(stop.st)
              const stName = getStName(stop.st)

              const arrTime = formatStopArrival(stop, isOrigin)
              const depTime = formatStopDeparture(stop, isTerminus)

              // Determine real-time state for this station
              let isPassed = false
              let isNext = false

              if (state === 'selesai') {
                isPassed = true
              } else if (state === 'berjalan') {
                if (nextStopIdx >= 0) {
                  if (idx < nextStopIdx) isPassed = true
                  else if (idx === nextStopIdx) isNext = true
                }
              }

              // Calculate dwell duration if both arr and dep exist
              let dwellMin = 0
              if (!isOrigin && !isTerminus && !isLs && stop.dep_ms && stop.arr_ms && stop.dep_ms > stop.arr_ms) {
                dwellMin = Math.round((stop.dep_ms - stop.arr_ms) / 60000)
              }

              return (
                <div
                  key={`${selectedTrain.id}-${stop.st}-${idx}`}
                  className={`relative rounded-xl border p-3 transition-all ${
                    isNext
                      ? 'bg-blue-50/70 border-blue-400 shadow-sm ring-2 ring-blue-100'
                      : isPassed
                      ? 'bg-slate-50/80 border-slate-200 opacity-85'
                      : 'bg-white border-slate-200 hover:border-blue-300'
                  }`}
                >
                  {/* Timeline bullet exactly centered on the vertical line */}
                  <div
                    className={`absolute -left-[16px] top-3.5 w-4 h-4 -translate-x-1/2 rounded-full border-2 flex items-center justify-center transition-all ${
                      isNext
                        ? 'bg-[#4D6BFE] border-white ring-4 ring-[#4D6BFE]/30'
                        : isPassed
                        ? 'bg-slate-400 border-white text-white'
                        : isOrigin
                        ? 'bg-[#9333EA] border-white text-white'
                        : isTerminus
                        ? 'bg-red-500 border-white text-white'
                        : 'bg-white border-slate-300'
                    }`}
                  >
                    {isPassed ? (
                      <Check size={9} strokeWidth={3} className="text-white" />
                    ) : isNext ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    ) : isOrigin ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    ) : isTerminus ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    )}
                  </div>

                  {/* Header: Station Name + Badges */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900 truncate">{stName}</span>
                        <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                          {stCode}
                        </span>
                      </div>
                    </div>

                    {/* Status badge for stop */}
                    <div className="shrink-0">
                      {isOrigin ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-purple-50 text-purple-700 border border-purple-200">
                          Stasiun Awal
                        </span>
                      ) : isTerminus ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          Tujuan Akhir
                        </span>
                      ) : isNext ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 animate-pulse">
                          Stasiun Berikutnya
                        </span>
                      ) : isPassed ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                          Terlewati
                        </span>
                      ) : isLs ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Melintas Langsung (Ls)
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          Berhenti
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Timetable row: Jam Sampai & Jam Berangkat */}
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1.5 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Clock size={11} className={isNext ? 'text-[#4D6BFE]' : 'text-slate-400'} />
                      <div className="text-[11px]">
                        <span className="text-slate-400 mr-1">Tiba:</span>
                        <strong className={`font-mono ${isNext ? 'text-[#4D6BFE] font-bold' : 'text-slate-800'}`}>
                          {arrTime}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 text-[11px]">
                      <span className="text-slate-400">Berangkat:</span>
                      <strong className="font-mono text-slate-700">{depTime}</strong>
                    </div>
                  </div>

                  {/* Extra info: Stop duration & Pin on map link */}
                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100/70 text-[10px]">
                    <div>
                      {dwellMin > 0 ? (
                        <span className="text-slate-500 font-medium">
                          Berhenti <strong className="text-slate-700">{dwellMin} menit</strong>
                        </span>
                      ) : isLs ? (
                        <span className="text-amber-600 font-medium">Tidak berhenti untuk penumpang</span>
                      ) : (
                        <span className="text-slate-400 font-medium">Transit Gapeka 2025</span>
                      )}
                    </div>

                    {onFlyToStation && (
                      <button
                        type="button"
                        onClick={() => onFlyToStation(stop.st)}
                        className="inline-flex items-center gap-1 text-[#4D6BFE] hover:underline font-semibold cursor-pointer"
                        title={`Lihat ${stName} di peta`}
                      >
                        <MapPin size={10} />
                        <span>Lihat Stasiun</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW MODE 2: SEARCH & LIST KERETA
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pb-2">
      {/* Search Bar Input */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setVisibleLimit(25)
          }}
          placeholder="Cari kereta (Argo Bromo, 1012, Lin Bogor, Gambir)..."
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:border-[#4D6BFE] focus:ring-2 focus:ring-[#4D6BFE]/20 shadow-xs transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
            aria-label="Hapus pencarian"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter Category Pills */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          onClick={() => {
            setFilterChip('all')
            setVisibleLimit(25)
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            filterChip === 'all'
              ? 'bg-[#4D6BFE] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Semua
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterChip('berjalan')
            setVisibleLimit(25)
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            filterChip === 'berjalan'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-emerald-50/50'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Berjalan ({totalActiveCount})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterChip('commuter')
            setVisibleLimit(25)
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            filterChip === 'commuter'
              ? 'bg-[#3B82F6] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-blue-50/50'
          }`}
        >
          Commuter Line
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterChip('jarak-jauh')
            setVisibleLimit(25)
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
            filterChip === 'jarak-jauh'
              ? 'bg-[#9333EA] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-purple-50/50'
          }`}
        >
          Jarak Jauh
        </button>
      </div>

      {/* Info count banner */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">
          {searchQuery ? `Hasil Pencarian (${filteredTrains.length})` : `Daftar Kereta (${filteredTrains.length})`}
        </span>
        <span className="text-[10px] text-slate-400">
          Klik kereta untuk lihat rute stasiun & peta
        </span>
      </div>

      {/* Train Cards List */}
      {filteredTrains.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center bg-white space-y-2">
          <Train size={28} className="mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">Tidak ada kereta yang cocok</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Coba gunakan nama kereta lain (misal: "Argo", "Bogor", "KRL", "Taksaka") atau nomor KA.
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-2 text-xs font-semibold text-[#4D6BFE] hover:underline cursor-pointer"
            >
              Reset pencarian
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredTrains.slice(0, visibleLimit).map((train) => {
            const {
              isCommuter,
              isActive,
              state,
              totalDuration,
              progress,
              nextStopName,
              nextStopEta,
              stopsCount,
            } = getTrainStatus(train)

            const fromName = getStName(train.from)
            const toName = getStName(train.to)

            return (
              <div
                key={train.id}
                onClick={() => handleSelectTrainCard(train)}
                className="rounded-xl bg-white border border-slate-200 p-3.5 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group shadow-xs active:scale-[0.99] space-y-2.5"
                title="Klik untuk berpindah ke lokasi kereta di peta dan melihat jadwal stasiun"
              >
                {/* Header: Title, Code, Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9.5px] px-1.5 py-0.2 rounded font-bold border ${
                          isCommuter
                            ? 'bg-blue-50 text-[#3B82F6] border-blue-200'
                            : 'bg-purple-50 text-[#9333EA] border-purple-200'
                        }`}
                      >
                        {isCommuter ? 'Commuter Line' : 'Jarak Jauh'}
                      </span>
                      <span className="text-[10px] font-mono font-semibold text-slate-500">
                        KA {train.code}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 group-hover:text-[#4D6BFE] transition-colors truncate mt-1">
                      {train.name}
                    </div>
                  </div>

                  {/* Status Indicator */}
                  <div className="shrink-0">
                    {state === 'berjalan' ? (
                      <span className="inline-flex items-center gap-1 text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Berjalan
                      </span>
                    ) : state === 'belum' ? (
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Belum Berangkat
                      </span>
                    ) : (
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded font-semibold bg-slate-50 text-slate-500 border border-slate-200">
                        Selesai
                      </span>
                    )}
                  </div>
                </div>

                {/* Route Summary */}
                <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                  <span className="truncate max-w-[110px] font-semibold text-slate-800">{fromName}</span>
                  <ArrowRight size={12} className="text-slate-400 shrink-0" />
                  <span className="truncate max-w-[110px] font-semibold text-slate-800">{toName}</span>
                </div>

                {/* Live Next Stop / Progress (if running) */}
                {isActive && nextStopName && (
                  <div className="pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-500 truncate max-w-[180px]">
                        Menuju <strong className="text-slate-800">{nextStopName}</strong>
                      </span>
                      <span className="font-bold text-[#4D6BFE] shrink-0">
                        {nextStopEta ? `~${nextStopEta}` : 'Segera'}
                      </span>
                    </div>
                    <div className="h-1 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                      <div className="h-full bg-[#4D6BFE] rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {/* Footer bar: Timing & Stops count */}
                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1 text-[11px]">
                    <Clock size={11} className="text-slate-400" />
                    <span className="font-mono font-semibold text-slate-800">{msToHHMM(train.dep_ms)}</span>
                    <span className="text-slate-300">→</span>
                    <span className="font-mono font-semibold text-slate-800">{msToHHMM(train.arr_ms)}</span>
                    <span className="text-[10px] text-slate-400">({msToDuration(totalDuration)})</span>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-[#4D6BFE] font-bold group-hover:translate-x-0.5 transition-transform">
                    <span>{stopsCount} Stasiun</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              </div>
            )
          })}

          {/* Load More Button */}
          {filteredTrains.length > visibleLimit && (
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + 25)}
              className="w-full py-2.5 bg-white border border-slate-200 hover:border-blue-300 hover:bg-[#EEF3FF] rounded-xl text-xs font-bold text-[#4D6BFE] shadow-xs cursor-pointer transition-all active:scale-[0.99]"
            >
              Tampilkan Lebih Banyak ({filteredTrains.length - visibleLimit} tersisa)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Sidebar export ──────────────────────────────────────────
export default function Sidebar({
  isOpen,
  onClose,
  activeTab: controlledTab,
  onTabChange,
  selectedJadwalStation,
  onSelectJadwalTrain,
  selectedKeretaTrain,
  onSelectKeretaTrain,
  onFlyToStation,
  stations: propsStations,
  trains: propsTrains,
}: SidebarProps) {
  const [internalTab, setInternalTab] = useState<SidebarTab>('maps')
  const activeTab = controlledTab ?? internalTab
  const setActiveTab = (tab: SidebarTab) => {
    setInternalTab(tab)
    onTabChange?.(tab)
  }

  const [trains, setTrains] = useState<TrainData[]>(propsTrains || [])
  const [stations, setStations] = useState<Station[]>(propsStations || [])

  useEffect(() => {
    if (propsTrains && propsTrains.length > 0) setTrains(propsTrains)
  }, [propsTrains])

  useEffect(() => {
    if (propsStations && propsStations.length > 0) setStations(propsStations)
  }, [propsStations])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [liveTime, setLiveTime] = useState<Date>(new Date())

  // Update live clock every second
  useEffect(() => {
    const timer = setInterval(() => setLiveTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const loadData = (force = false) => {
    if (force) clearApiCache()
    setLoading(true)
    setError(null)
    Promise.all([fetchGapeka(), fetchStations()])
      .then(([g, s]) => {
        setTrains(g)
        setStations(s)
        setLastRefresh(new Date())
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  // Load when sidebar opens for the first time
  useEffect(() => {
    if (isOpen && trains.length === 0 && !loading) {
      loadData(false)
    }
  }, [isOpen])

  const tabs: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: 'maps', label: 'Peta', icon: <MapIcon size={14} /> },
    { id: 'jadwal', label: 'Jadwal', icon: <Clock size={14} /> },
    { id: 'kereta', label: 'Kereta', icon: <Train size={14} /> },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300
          ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed left-0 top-0 h-full z-40 flex flex-col
          w-[360px] max-w-[88vw]
          bg-white shadow-[0_10px_35px_rgba(0,0,0,0.18)]
          border-r border-slate-200
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#4D6BFE] text-white flex items-center justify-center shadow-sm">
              <Train size={18} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">RelTime</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[#EEF3FF] text-[#4D6BFE]">
                  Live
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Data Gapeka 2025</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => loadData(true)}
              title={
                lastRefresh
                  ? `Terakhir diperbarui: ${lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':')}`
                  : 'Perbarui data'
              }
              className="p-2 rounded-full text-slate-400 hover:text-[#4D6BFE] hover:bg-[#EEF3FF] transition-colors cursor-pointer"
              aria-label="Perbarui data"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Tutup sidebar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 p-3 bg-slate-50 border-b border-slate-200/80 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 flex-1 justify-center py-2 px-3 rounded-lg text-xs font-semibold
                transition-all duration-150 cursor-pointer
                ${activeTab === tab.id
                  ? 'bg-white text-[#4D6BFE] shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sidebar-scroll space-y-3 bg-[#F9F8F8]">
          <PanelErrorBoundary key={activeTab}>
            {activeTab === 'maps' && (
              <MiniMapPanel
                stationCount={stations.length}
                trains={trains}
                loading={loading}
              />
            )}
            {activeTab === 'jadwal' && (
              <JadwalPanel
                trains={trains}
                stations={stations}
                loading={loading && trains.length === 0}
                error={error}
                onRefresh={loadData}
                initialStation={selectedJadwalStation}
                onSelectTrain={onSelectJadwalTrain}
              />
            )}
            {activeTab === 'kereta' && (
              <KeretaPanel
                trains={trains}
                stations={stations}
                loading={loading}
                error={error}
                onRefresh={loadData}
                selectedTrain={selectedKeretaTrain}
                onSelectTrain={onSelectKeretaTrain}
                onFlyToStation={onFlyToStation}
              />
            )}
          </PanelErrorBoundary>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-medium text-slate-700">
              {loading ? 'Memperbarui...' : 'Tersambung Real-time'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 font-semibold tracking-tight">
            {liveTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':')}
          </span>
        </div>
      </aside>
    </>
  )
}
