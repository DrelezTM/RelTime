import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import { Map as MapIcon, Clock, Train, X, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import {
  fetchGapeka, fetchStations, clearApiCache,
  msToHHMM, msToDuration, nowMs,
  type Train as TrainEntry, type Station,
} from '../api'

type SidebarTab = 'maps' | 'jadwal' | 'kereta'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
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
  loading: boolean
}

const MiniMapPanel = ({ stationCount, loading }: MiniMapPanelProps) => (
  <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200/90 bg-[#EEF3FF] p-4 text-center">
      <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mx-auto mb-2.5 text-[#4D6BFE]">
        <MapIcon size={20} />
      </div>
      <h3 className="text-sm font-bold text-slate-800">Peta Rel Indonesia</h3>
      <p className="text-xs text-slate-500 mt-1">
        Data stasiun dan jalur rel diambil langsung dari{' '}
        <span className="font-semibold text-[#4D6BFE]">Gapeka 2025</span>.
        Klik pin stasiun untuk melihat detailnya.
      </p>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl p-3 bg-[#EEF3FF] border border-[#DCE4FF] text-center">
        {loading ? (
          <Loader2 size={18} className="animate-spin text-[#4D6BFE] mx-auto" />
        ) : (
          <div className="text-2xl font-bold text-[#4D6BFE]">{stationCount}</div>
        )}
        <div className="text-[11px] font-semibold text-[#4D6BFE] mt-0.5">Total Stasiun</div>
      </div>
      <div className="rounded-xl p-3 bg-cyan-50 border border-cyan-200 text-center">
        <div className="text-2xl font-bold text-cyan-800">
          {loading ? <Loader2 size={18} className="animate-spin text-cyan-400 mx-auto" /> : '✓'}
        </div>
        <div className="text-[11px] font-semibold text-cyan-600 mt-0.5">Data Live</div>
      </div>
    </div>

    <div className="rounded-xl bg-white border border-slate-200 p-3.5 space-y-2.5 shadow-sm">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Legenda Pin</p>
      <div className="flex items-center gap-2.5">
        <div className="w-3.5 h-3.5 rounded-full bg-[#0891B2] border-2 border-white shadow-sm" />
        <span className="text-xs font-medium text-slate-700">Stasiun (data API)</span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="w-3 h-3 bg-[#4D6BFE] rounded-sm opacity-80 border border-white" />
        <span className="text-xs font-medium text-slate-700">Jalur Rel (polyline)</span>
      </div>
    </div>
  </div>
)

// ── Schedule panel ───────────────────────────────────────────────
interface JadwalPanelProps {
  trains: TrainData[]
  stations: Station[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

const JadwalPanel = ({ trains, stations, loading, error, onRefresh }: JadwalPanelProps) => {
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

  // Get next 20 departures across all trains, from the current time, wrapping around midnight
  const upcoming = safeTrains
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

  if (upcoming.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-slate-500">
        Tidak ada kereta berangkat dalam waktu dekat.
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {upcoming.map(({ train, stop, diffMs }, i) => {
        const toName = stMap.get(train.to) ?? train.to
        const fromName = stMap.get(stop.st) ?? stop.st
        const depLabel = msToHHMM(stop.dep_ms)
        const arrLabel = msToHHMM(train.arr_ms)
        const dur = msToDuration((train.arr_ms - stop.dep_ms + 86400000) % 86400000)
        const diffMin = Math.round(diffMs / 60000)
        const diffText = diffMin <= 1 ? 'Segera' : diffMin < 60 ? `${diffMin} mnt` : `${Math.floor(diffMin / 60)} j ${diffMin % 60} mnt`

        return (
          <div
            key={`${train.id}-${stop.st}-${i}`}
            className="rounded-xl bg-white border border-slate-200 p-3.5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group shadow-sm"
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
                <span>{arrLabel}</span>
                <span className="text-slate-400">({dur})</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF3FF] text-[#4D6BFE] font-semibold">
                {stop.st}
              </span>
            </div>
          </div>
        )
      })}
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
}

const KeretaPanel = ({ trains, stations, loading, error, onRefresh }: KeretaPanelProps) => {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
        <Loader2 size={24} className="animate-spin text-[#4D6BFE]" />
        <span className="text-sm font-medium">Memuat data kereta...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-10 gap-3 text-center">
        <p className="text-sm font-semibold text-red-600">Gagal memuat kereta</p>
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

  // Show trains currently "in service"
  const active = safeTrains
    .filter((t) => {
      if (!t || typeof t.dep_ms !== 'number' || typeof t.arr_ms !== 'number') return false
      if (t.dep_ms <= t.arr_ms) {
        return t.dep_ms <= now && now <= t.arr_ms
      }
      return now >= t.dep_ms || now <= t.arr_ms
    })
    .slice(0, 15)

  // Find next stop for a running train
  const getNextStop = (train: TrainData) => {
    const stops = Array.isArray(train?.stops) ? train.stops : []
    return stops.find((s) => {
      if (!s || s.inv) return false
      const diff = (s.arr_ms - now + 86400000) % 86400000
      return diff > 0 && diff < 86400000 / 2
    })
  }

  if (active.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-slate-500">
        Tidak ada kereta yang sedang beroperasi saat ini.
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {active.map((train) => {
        const nextStop = getNextStop(train)
        const nextStopName = nextStop ? (stMap.get(nextStop.st) ?? nextStop.st) : '—'
        const etaNext = nextStop ? msToDuration(nextStop.arr_ms - now) : '—'
        const duration = (train.arr_ms || 0) - (train.dep_ms || 0)
        const progress = duration > 0
          ? Math.min(100, Math.max(0, Math.round(((now - train.dep_ms) / duration) * 100)))
          : 0
        const fromName = stMap.get(train.from) ?? train.from
        const toName = stMap.get(train.to) ?? train.to

        return (
          <div
            key={train.id}
            className="rounded-xl bg-white border border-slate-200 p-3.5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group shadow-sm"
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 group-hover:text-[#4D6BFE] transition-colors truncate">
                  {train.name}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                  <span>{train.code}</span>
                  <span className="text-slate-300">·</span>
                  <span className="truncate max-w-[120px]">{fromName} → {toName}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 shrink-0 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Berjalan
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-2.5">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-[#4D6BFE] rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>{fromName}</span>
                <span>{progress}%</span>
                <span>{toName}</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
              <div>
                <span className="text-slate-400 text-[11px]">Pemberhentian Berikutnya</span>
                <div className="font-semibold text-slate-800 mt-0.5">
                  {nextStopName}{' '}
                  <span className="text-[#4D6BFE] font-bold">({etaNext})</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-slate-400 text-[11px]">Tiba</span>
                <div className="font-bold text-slate-800 mt-0.5">{msToHHMM(train.arr_ms)}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main Sidebar export ──────────────────────────────────────────
export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('jadwal')
  const [trains, setTrains] = useState<TrainData[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const loadData = () => {
    clearApiCache()
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
      loadData()
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
              onClick={loadData}
              title="Refresh data"
              className="p-2 rounded-full text-slate-400 hover:text-[#4D6BFE] hover:bg-[#EEF3FF] transition-colors cursor-pointer"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
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
              <MiniMapPanel stationCount={stations.length} loading={loading} />
            )}
            {activeTab === 'jadwal' && (
              <JadwalPanel
                trains={trains}
                stations={stations}
                loading={loading}
                error={error}
                onRefresh={loadData}
              />
            )}
            {activeTab === 'kereta' && (
              <KeretaPanel
                trains={trains}
                stations={stations}
                loading={loading}
                error={error}
                onRefresh={loadData}
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
          {lastRefresh && (
            <span className="text-[11px] text-slate-400">
              {lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </aside>
    </>
  )
}
