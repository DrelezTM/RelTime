import { Search, X, Menu, MapPin, Train, Compass, Navigation } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { nowMs, type Station, type Train as TrainType } from '../api'

export type RecommendationType = 'stasiun' | 'commuter' | 'jarak-jauh'

export interface RecommendationItem {
  id: string
  title: string
  subtitle: string
  type: RecommendationType
  code: string
  lat: number
  lng: number
  distanceKm?: number
  score: number
  station?: Station
  train?: TrainType
}

function getTrainDisplayName(tr: TrainType): string {
  let cleanName = (tr.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  const isCommuter =
    /commuter|krl|lin|feeder|prameks|bandara/i.test(cleanName) ||
    /commuter|krl|lin/i.test(tr.code)

  if (isCommuter) {
    if (/^krl\s+/i.test(cleanName)) {
      cleanName = cleanName.replace(/^krl\s+/i, 'Commuter Line ')
    } else if (/^lin\s+/i.test(cleanName)) {
      cleanName = cleanName.replace(/^lin\s+/i, 'Commuter Line ')
    } else if (!/^commuter\s+line/i.test(cleanName) && !/^cl\b/i.test(cleanName)) {
      cleanName = `Commuter Line ${cleanName}`
    }
  }

  return cleanName || tr.name || `KA ${tr.code}`
}

interface SearchBarProps {
  value: string
  onChange: (val: string) => void
  onOpenSidebar: () => void
  stations?: Station[]
  trains?: TrainType[]
  onSelectRecommendation?: (item: RecommendationItem) => void
  getMapCenter?: () => [number, number] | null
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // km
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
  if (km < 1) {
    return `${Math.round(km * 1000)} m`
  }
  return `${km.toFixed(1)} km`
}

export default function SearchBar({
  value,
  onChange,
  onOpenSidebar,
  stations = [],
  trains = [],
  onSelectRecommendation,
  getMapCenter,
}: SearchBarProps) {
  const [focused, setFocused] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Try silent geolocation once for user distance calculation
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        () => { },
        { timeout: 5000 }
      )
    }
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter and rank top 5 recommendations
  const recommendations = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q || (stations.length === 0 && trains.length === 0)) return []

    const qNorm = q.replace(/[\s\-_]+/g, '')
    const isGenericCommuterSearch =
      /^(commuter|commuterline|krl|lin|cl|feeder)$/i.test(qNorm) ||
      /commuter|krl/i.test(qNorm)

    // Reference coords for "terdekat"
    let refLat = -6.1751
    let refLng = 106.8272
    if (userCoords) {
      refLat = userCoords.lat
      refLng = userCoords.lng
    } else if (getMapCenter) {
      const center = getMapCenter()
      if (center) {
        refLng = center[0]
        refLat = center[1]
      }
    }

    const items: RecommendationItem[] = []
    const stMap = new Map(stations.map((s) => [s.code, s]))

    // 1. Check Stations
    const seenStationCodes = new Set<string>()
    for (const st of stations) {
      // Ignore internal duplicate station codes starting with underscore (e.g. _JAKK)
      if (st.code.startsWith('_')) continue

      const nameLower = st.name.toLowerCase()
      const codeLower = st.code.toLowerCase()
      const cleanCode = codeLower.replace(/^_/, '')

      if (seenStationCodes.has(cleanCode)) continue

      let score = 0
      if (codeLower === q || cleanCode === q) score = 1000
      else if (nameLower === q) score = 900
      else if (nameLower.startsWith(q)) score = 500
      else if (codeLower.startsWith(q)) score = 400
      else if (nameLower.includes(` ${q}`)) score = 300
      else if (nameLower.includes(q) || codeLower.includes(q)) score = 150

      if (score > 0) {
        seenStationCodes.add(cleanCode)
        const dist = getDistanceKm(refLat, refLng, st.lat, st.lng)
        items.push({
          id: `st-${st.code}`,
          title: st.name,
          subtitle: `Kode: ${st.code} • Stasiun Kereta`,
          type: 'stasiun',
          code: st.code,
          lat: st.lat,
          lng: st.lng,
          distanceKm: dist,
          score,
          station: st,
        })
      }
    }

    // 2. Check Trains
    const now = nowMs()
    const seenKeys = new Set<string>()

    for (const tr of trains) {
      const displayName = getTrainDisplayName(tr)
      const nameLower = displayName.toLowerCase()
      const rawNameLower = tr.name.toLowerCase()
      const nameNorm = nameLower.replace(/[\s\-_]+/g, '')
      const codeLower = tr.code.toLowerCase()

      const isCommuter =
        /commuter|krl|lin|feeder|prameks|bandara/i.test(displayName) ||
        /commuter|krl|lin/i.test(tr.code)
      const type: RecommendationType = isCommuter ? 'commuter' : 'jarak-jauh'

      let score = 0

      // Exact code match: "35", "ka 35", "ka35"
      if (codeLower === q || `ka ${codeLower}` === q || `ka${codeLower}` === q) {
        score = 1000
      } else if (codeLower.startsWith(q)) {
        score = 550
      }

      // Name matches (supporting spaces or no spaces, e.g. "commuterline" -> "Commuter Line ...")
      if (nameNorm === qNorm || rawNameLower === q) {
        score = Math.max(score, 900)
      } else if (nameNorm.startsWith(qNorm) || nameLower.startsWith(q)) {
        score = Math.max(score, 650)
      } else if (nameNorm.includes(qNorm) || nameLower.includes(q) || rawNameLower.includes(q)) {
        score = Math.max(score, 380)
      }

      // If user is searching generic commuter terms, all commuter trains match!
      if (isGenericCommuterSearch && isCommuter) {
        score = Math.max(score, 450)
      }

      // Station matches (e.g. searching "Bogor" or "Malang" finds trains to/from there)
      const originSt = stMap.get(tr.stops?.[0]?.st || tr.from)
      const destSt = stMap.get(tr.to)
      const originName = originSt?.name || tr.from
      const destName = destSt?.name || tr.to
      const originLower = originName.toLowerCase()
      const destLower = destName.toLowerCase()

      if (originLower.startsWith(q) || destLower.startsWith(q)) {
        score = Math.max(score, 320)
      } else if (originLower.includes(q) || destLower.includes(q)) {
        score = Math.max(score, 220)
      }

      if (score > 0) {
        // Smart deduplication:
        // For generic commuter queries ("commuterline", "krl"), group by line + route so we show diverse lines (Bogor, Cikarang, etc.)
        // For specific queries (e.g. "Gajayana", "Argo Parahyangan"), deduplicate by unique train code so both KA 35 & KA 36 show up.
        const dedupKey = isGenericCommuterSearch
          ? `${displayName}-${tr.from}-${tr.to}`
          : `tr-${tr.code}`

        if (seenKeys.has(dedupKey) && !codeLower.includes(q)) {
          continue
        }
        seenKeys.add(dedupKey)

        // Check if train is active right now to get accurate live position
        const isActive =
          Array.isArray(tr.stops) &&
          tr.stops.length >= 2 &&
          (tr.dep_ms <= tr.arr_ms
            ? tr.dep_ms <= now && now <= tr.arr_ms
            : now >= tr.dep_ms || now <= tr.arr_ms)

        let lat = originSt?.lat || refLat
        let lng = originSt?.lng || refLng
        let liveStatus = ''

        if (isActive && tr.stops && tr.stops.length >= 2) {
          let segIdx = -1
          for (let i = 0; i < tr.stops.length - 1; i++) {
            const s1 = tr.stops[i]
            const s2 = tr.stops[i + 1]
            const inSeg =
              s1.dep_ms <= s2.arr_ms
                ? s1.dep_ms <= now && now <= s2.arr_ms
                : now >= s1.dep_ms || now <= s2.arr_ms
            if (inSeg) {
              segIdx = i
              break
            }
          }

          if (segIdx >= 0) {
            const s1 = tr.stops[segIdx]
            const s2 = tr.stops[segIdx + 1]
            const st1 = stMap.get(s1.st)
            const st2 = stMap.get(s2.st)
            if (st1 && st2) {
              const segDur = (s2.arr_ms - s1.dep_ms + 86400000) % 86400000
              const elapsed = (now - s1.dep_ms + 86400000) % 86400000
              const ratio = segDur > 0 ? Math.min(1, Math.max(0, elapsed / segDur)) : 0
              lat = st1.lat + (st2.lat - st1.lat) * ratio
              lng = st1.lng + (st2.lng - st1.lng) * ratio
              liveStatus = `• Berjalan ke ${st2.name}`
            }
          }
          score += 100 // Boost live trains
        }

        const dist = getDistanceKm(refLat, refLng, lat, lng)
        const title = displayName.includes(tr.code)
          ? displayName
          : `${displayName} • KA ${tr.code}`

        items.push({
          id: `tr-${tr.code}-${tr.id}`,
          title,
          subtitle: `${originName} → ${destName} • KA ${tr.code}${liveStatus ? ` ${liveStatus}` : ''}`,
          type,
          code: tr.code,
          lat,
          lng,
          distanceKm: dist,
          score,
          train: tr,
        })
      }
    }

    // Sort: Tier 1 (exact/prefix matches, score >= 400) sorted by distance.
    // Then Tier 2 (substring matches) sorted by distance.
    items.sort((a, b) => {
      const aTier = a.score >= 400 ? 1 : 0
      const bTier = b.score >= 400 ? 1 : 0
      if (aTier !== bTier) return bTier - aTier

      if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
        return a.distanceKm - b.distanceKm
      }
      return b.score - a.score
    })

    return items
  }, [value, stations, trains, userCoords, getMapCenter])

  const handleSelect = (item: RecommendationItem) => {
    onChange(item.title)
    setIsOpen(false)
    setSelectedIndex(-1)
    onSelectRecommendation?.(item)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || recommendations.length === 0) {
      if (e.key === 'Enter' && recommendations.length > 0) {
        e.preventDefault()
        handleSelect(recommendations[0])
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % recommendations.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + recommendations.length) % recommendations.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = selectedIndex >= 0 ? recommendations[selectedIndex] : recommendations[0]
      if (target) handleSelect(target)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input Bar */}
      <div
        className={`
          flex items-center gap-2 px-3 h-12 rounded-full
          bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border transition-all duration-200
          ${focused || isOpen
            ? 'border-blue-400 dark:border-blue-500 shadow-[0_4px_20px_rgba(77,107,254,0.18)] ring-2 ring-blue-500/20'
            : 'border-slate-200/90 dark:border-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700'
          }
        `}
      >
        {/* Integrated Hamburger Button */}
        <button
          onClick={onOpenSidebar}
          type="button"
          className="
            flex items-center justify-center w-8 h-8 rounded-full
            text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800
            transition-colors shrink-0 cursor-pointer
          "
          aria-label="Buka menu"
        >
          <Menu size={18} />
        </button>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setIsOpen(true)
            setSelectedIndex(-1)
          }}
          onFocus={() => {
            setFocused(true)
            if (value.trim().length > 0) setIsOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Cari stasiun, commuterline, atau kereta jarak jauh"
          className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 text-sm outline-none font-medium min-w-0"
        />

        {/* Clear Button (when value exists) */}
        {value && (
          <button
            onClick={() => {
              onChange('')
              setIsOpen(false)
              inputRef.current?.focus()
            }}
            type="button"
            className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Hapus pencarian"
          >
            <X size={15} />
          </button>
        )}

        {/* Vertical Divider */}
        <div className="w-px h-5 bg-slate-200 shrink-0" />

        {/* Search Icon / Submit Button */}
        <button
          type="button"
          onClick={() => {
            if (recommendations.length > 0) {
              handleSelect(selectedIndex >= 0 ? recommendations[selectedIndex] : recommendations[0])
            }
          }}
          className="
            flex items-center justify-center w-8 h-8 rounded-full
            text-slate-500 hover:text-[#4D6BFE] hover:bg-blue-50
            transition-colors shrink-0 cursor-pointer
          "
          aria-label="Cari"
        >
          <Search size={17} />
        </button>
      </div>

      {/* Dropdown Recommendations (All results) */}
      {isOpen && value.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-[0_12px_36px_rgba(0,0,0,0.16)] overflow-hidden z-50 divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3.5 py-2 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between border-b border-slate-100 shrink-0">
            <span>Rekomendasi</span>
            <span className="text-[#4D6BFE] font-mono font-bold">{recommendations.length} hasil</span>
          </div>

          {recommendations.length > 0 ? (
            <div className="py-1 max-h-[380px] sm:max-h-[440px] overflow-y-auto sidebar-scroll">
              {recommendations.map((item, idx) => {
                const isSelected = selectedIndex === idx
                const isStation = item.type === 'stasiun'
                const isCommuter = item.type === 'commuter'

                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(item)
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#EEF3FF]' : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Icon container */}
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isStation
                          ? 'bg-pink-50 text-pink-600 border-pink-200/70'
                          : isCommuter
                            ? 'bg-blue-50 text-blue-600 border-blue-200/70'
                            : 'bg-purple-50 text-purple-600 border-purple-200/70'
                      }`}
                    >
                      {isStation ? (
                        <MapPin size={16} />
                      ) : isCommuter ? (
                        <Train size={16} />
                      ) : (
                        <Compass size={16} />
                      )}
                    </div>

                    {/* Text info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-800 truncate">
                          {item.title}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 border ${
                            isStation
                              ? 'bg-pink-50 text-pink-700 border-pink-200'
                              : isCommuter
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-purple-50 text-purple-700 border-purple-200'
                          }`}
                        >
                          {isStation ? 'Stasiun' : isCommuter ? 'Commuter' : 'Jarak Jauh'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{item.subtitle}</p>
                    </div>

                    {/* Distance chip */}
                    {item.distanceKm !== undefined && (
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100/90 border border-slate-200/80 px-2 py-0.5 rounded-full shrink-0">
                        <Navigation size={10} className="text-slate-400 rotate-45" />
                        <span>{formatDistance(item.distanceKm)}</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              Tidak ada stasiun atau kereta yang cocok dengan &quot;{value}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  )
}
