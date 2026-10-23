import { useState } from 'react'
import SearchBar from './components/SearchBar'
import FilterPills, { type FilterType } from './components/FilterPills'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'

export default function App() {
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<FilterType[]>(['stasiun', 'commuter', 'jarak-jauh'])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#F9F8F8]">
      {/* ── Full-screen Map ── */}
      <div className="absolute inset-0 z-0">
        <MapView activeFilters={activeFilters} />
      </div>

      {/* ── Top overlay: Google Maps-style SearchBar + Filter Pills ── */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none p-3 sm:p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-2.5 max-w-full">
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
      </header>

      {/* ── Sidebar ── */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </div>
  )
}
