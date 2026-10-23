import { useState, useRef, useCallback, useEffect } from 'react'
import { AlertCircle, X } from 'lucide-react'
import SearchBar, { type RecommendationItem } from './components/SearchBar'
import FilterPills, { type FilterType } from './components/FilterPills'
import MapView, { type MapController } from './components/MapView'
import Sidebar from './components/Sidebar'
import type { Station, Train } from './api'
import {
  type ThemeMode,
  getStoredTheme,
  setStoredTheme,
  resolveEffectiveTheme,
} from './theme'

export default function App() {
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<FilterType[]>(['stasiun', 'commuter', 'jarak-jauh'])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [trains, setTrains] = useState<Train[]>([])

  // Theme management: 'system' | 'light' | 'dark'
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(() =>
    resolveEffectiveTheme(getStoredTheme())
  )

  const handleThemeChange = useCallback((newTheme: ThemeMode) => {
    setTheme(newTheme)
    setStoredTheme(newTheme)
    const effective = resolveEffectiveTheme(newTheme)
    setEffectiveTheme(effective)
    if (effective === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    // Initial sync of dark class on <html>
    const effective = resolveEffectiveTheme(theme)
    setEffectiveTheme(effective)
    if (effective === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }

    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => {
      const updated = resolveEffectiveTheme('system')
      setEffectiveTheme(updated)
      if (updated === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [theme])

  const retryRef = useRef<(() => void) | null>(null)
  const mapControllerRef = useRef<MapController | null>(null)

  const handleRegisterRetry = useCallback((fn: () => void) => {
    retryRef.current = fn
  }, [])

  const handleDataLoaded = useCallback((stns: Station[], gapeka: Train[]) => {
    setStations(stns)
    setTrains(gapeka)
  }, [])

  const handleSelectRecommendation = useCallback((item: RecommendationItem) => {
    // 1. Ensure the relevant layer filter is active so user sees the marker
    if (item.type === 'stasiun') {
      setActiveFilters((prev) => (prev.includes('stasiun') ? prev : [...prev, 'stasiun']))
    } else if (item.type === 'commuter') {
      setActiveFilters((prev) => (prev.includes('commuter') ? prev : [...prev, 'commuter']))
    } else if (item.type === 'jarak-jauh') {
      setActiveFilters((prev) => (prev.includes('jarak-jauh') ? prev : [...prev, 'jarak-jauh']))
    }

    // 2. Focus and fly to the item on map
    if (item.type === 'stasiun') {
      mapControllerRef.current?.flyToStation(item.code)
    } else {
      mapControllerRef.current?.flyToTrain(item.code, item.train?.id, item.title)
    }
  }, [])

  const getMapCenter = useCallback((): [number, number] | null => {
    return mapControllerRef.current?.getCenter() || null
  }, [])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#F9F8F8] dark:bg-[#0b0f19]">
      {/* ── Full-screen Map ── */}
      <div className="absolute inset-0 z-0">
        <MapView
          activeFilters={activeFilters}
          onError={setError}
          onRegisterRetry={handleRegisterRetry}
          onDataLoaded={handleDataLoaded}
          mapControllerRef={mapControllerRef}
          isDark={effectiveTheme === 'dark'}
        />
      </div>

      {/* ── Top overlay: Google Maps-style SearchBar + Filter Pills + Error ── */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none p-3 sm:p-4 flex flex-col items-center gap-2.5">
        <div className="flex flex-col md:flex-row md:items-center gap-2.5 w-full">
          {/* SearchBar with integrated hamburger menu and theme toggle */}
          <div className="pointer-events-auto w-full md:w-[380px] shrink-0">
            <SearchBar
              value={search}
              onChange={setSearch}
              onOpenSidebar={() => setSidebarOpen(true)}
              stations={stations}
              trains={trains}
              onSelectRecommendation={handleSelectRecommendation}
              getMapCenter={getMapCenter}
              theme={theme}
              onThemeChange={handleThemeChange}
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

        {/* Error message banner */}
        {error && (
          <div className="pointer-events-auto max-w-lg w-full sm:w-auto animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5 bg-red-50/95 dark:bg-red-950/90 backdrop-blur-md border border-red-200/90 dark:border-red-900/80 rounded-2xl px-4 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-xs text-red-800 dark:text-red-200 font-medium">
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <span className="truncate">Gagal memuat data: {error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  retryRef.current?.()
                }}
                className="ml-2 px-2.5 py-1 rounded-lg bg-red-100 dark:bg-red-900/60 hover:bg-red-200 dark:hover:bg-red-800/80 text-red-700 dark:text-red-300 font-semibold transition-colors cursor-pointer shrink-0"
              >
                Coba Lagi
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer shrink-0"
                aria-label="Tutup"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Sidebar ── */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    </div>
  )
}
