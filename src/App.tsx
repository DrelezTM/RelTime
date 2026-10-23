import { useState, useRef, useCallback } from 'react'
import { AlertCircle, X } from 'lucide-react'
import SearchBar from './components/SearchBar'
import FilterPills, { type FilterType } from './components/FilterPills'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'

export default function App() {
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<FilterType[]>(['stasiun', 'commuter', 'jarak-jauh'])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef<(() => void) | null>(null)

  const handleRegisterRetry = useCallback((fn: () => void) => {
    retryRef.current = fn
  }, [])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#F9F8F8]">
      {/* ── Full-screen Map ── */}
      <div className="absolute inset-0 z-0">
        <MapView
          activeFilters={activeFilters}
          onError={setError}
          onRegisterRetry={handleRegisterRetry}
        />
      </div>

      {/* ── Top overlay: Google Maps-style SearchBar + Filter Pills + Error ── */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none p-3 sm:p-4 flex flex-col items-center gap-2.5">
        <div className="flex flex-col md:flex-row md:items-center gap-2.5 w-full">
          {/* SearchBar with integrated hamburger menu */}
          <div className="pointer-events-auto w-full md:w-[380px] shrink-0">
            <SearchBar
              value={search}
              onChange={setSearch}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
          </div>

          {/* Filter Pills in a single horizontal scrollable row */}
          <div className="pointer-events-auto overflow-x-auto no-scrollbar shrink-0">
            <FilterPills
              selected={activeFilters}
              onChange={setActiveFilters}
            />
          </div>
        </div>

        {/* Error message banner:
            - Desktop: centered below searchbar and pill
            - Android / Mobile: directly below pills
        */}
        {error && (
          <div className="pointer-events-auto max-w-lg w-full sm:w-auto animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5 bg-red-50/95 backdrop-blur-md border border-red-200/90 rounded-2xl px-4 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-xs text-red-800 font-medium">
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <span className="truncate">Gagal memuat data: {error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  retryRef.current?.()
                }}
                className="ml-2 px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold transition-colors cursor-pointer shrink-0"
              >
                Coba Lagi
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors cursor-pointer shrink-0"
                aria-label="Tutup"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Sidebar ── */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </div>
  )
}
