import { useEffect, useRef, useState, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Layers, Loader2, Navigation } from 'lucide-react'
import {
  fetchStations, fetchRoutes, fetchGapeka, clearApiCache,
  nowMs, msToDuration,
  type Station, type Train, type Route,
} from '../api'
import type { FilterType } from './FilterPills'
import type { FeatureCollection } from 'geojson'

interface MapViewProps {
  activeFilters: FilterType[]
  onError?: (err: string | null) => void
  onRegisterRetry?: (retryFn: () => void) => void
}

type MapLayerMode = 'streets' | 'satellite'

function buildMapStyle(mode: MapLayerMode): maplibregl.StyleSpecification {
  if (mode === 'satellite') {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'satellite-tiles': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '© Esri',
        },
      },
      layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles' }],
    }
  }
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles' }],
  }
}

function buildRouteGeoJSON(routes: Route[]): FeatureCollection {
  const safeRoutes = Array.isArray(routes) ? routes : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: any[] = []

  for (const route of safeRoutes) {
    const lineCoords: [number, number][][] = []

    if (Array.isArray(route.paths)) {
      for (const seg of route.paths) {
        if (Array.isArray(seg.pos) && seg.pos.length >= 2) {
          const coords: [number, number][] = seg.pos
            .filter((p) => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]))
            .map(([lat, lng]) => [lng, lat])
          if (coords.length >= 2) {
            lineCoords.push(coords)
          }
        }
      }
    } else if (Array.isArray(route.pts)) {
      const coords: [number, number][] = (route.pts || [])
        .filter((p) => Array.isArray(p) && p.length >= 3 && !isNaN(p[1]) && !isNaN(p[2]))
        .map(([, lat, lng]) => [lng, lat])
      if (coords.length >= 2) {
        lineCoords.push(coords)
      }
    }

    if (lineCoords.length > 0) {
      features.push({
        type: 'Feature',
        properties: { id: route.id },
        geometry: {
          type: 'MultiLineString',
          coordinates: lineCoords,
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function applyRouteLayersToMap(map: maplibregl.Map, routes: Route[]) {
  if (map.getLayer('train-routes')) map.removeLayer('train-routes')
  if (map.getLayer('train-routes-outline')) map.removeLayer('train-routes-outline')
  if (map.getSource('train-routes')) map.removeSource('train-routes')

  const geojson = buildRouteGeoJSON(routes)
  map.addSource('train-routes', { type: 'geojson', data: geojson })

  map.addLayer({
    id: 'train-routes-outline',
    type: 'line',
    source: 'train-routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': 4.5,
      'line-opacity': 0.7,
    },
  })

  map.addLayer({
    id: 'train-routes',
    type: 'line',
    source: 'train-routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#4D6BFE',
      'line-width': 2.5,
      'line-opacity': 0.9,
    },
  })
}

interface ActiveTrainData {
  train: Train
  type: 'commuter' | 'jarak-jauh'
  lng: number
  lat: number
  fromName: string
  toName: string
  nextStopName: string
  etaNext: string
}

function getActiveTrains(
  trains: Train[],
  stations: Station[],
  activeFilters: FilterType[],
): ActiveTrainData[] {
  const showCommuter = activeFilters.includes('commuter')
  const showJarakJauh = activeFilters.includes('jarak-jauh')
  if (!showCommuter && !showJarakJauh) return []

  const now = nowMs()
  const stMap = new Map(stations.map((s) => [s.code, s]))
  const results: ActiveTrainData[] = []

  for (const train of trains) {
    if (!train || !Array.isArray(train.stops) || train.stops.length < 2) continue

    const isActive = train.dep_ms <= train.arr_ms
      ? (train.dep_ms <= now && now <= train.arr_ms)
      : (now >= train.dep_ms || now <= train.arr_ms)

    if (!isActive) continue

    const isCommuter = /commuter|krl|lin|feeder|prameks|bandara/i.test(train.name) || /commuter|krl|lin/i.test(train.code)
    const type: 'commuter' | 'jarak-jauh' = isCommuter ? 'commuter' : 'jarak-jauh'

    if (type === 'commuter' && !showCommuter) continue
    if (type === 'jarak-jauh' && !showJarakJauh) continue

    // Find current active segment
    let segIdx = -1
    for (let i = 0; i < train.stops.length - 1; i++) {
      const s1 = train.stops[i]
      const s2 = train.stops[i + 1]
      const inSeg = s1.dep_ms <= s2.arr_ms
        ? (s1.dep_ms <= now && now <= s2.arr_ms)
        : (now >= s1.dep_ms || now <= s2.arr_ms)
      if (inSeg) {
        segIdx = i
        break
      }
    }

    let lat = 0
    let lng = 0
    let nextStopName = '—'
    let etaNext = '—'

    if (segIdx >= 0) {
      const s1 = train.stops[segIdx]
      const s2 = train.stops[segIdx + 1]
      const st1 = stMap.get(s1.st)
      const st2 = stMap.get(s2.st)

      if (st1 && st2) {
        const segDur = (s2.arr_ms - s1.dep_ms + 86400000) % 86400000
        const elapsed = (now - s1.dep_ms + 86400000) % 86400000
        const ratio = segDur > 0 ? Math.min(1, Math.max(0, elapsed / segDur)) : 0
        lat = st1.lat + (st2.lat - st1.lat) * ratio
        lng = st1.lng + (st2.lng - st1.lng) * ratio
        nextStopName = st2.name
        etaNext = msToDuration((s2.arr_ms - now + 86400000) % 86400000)
      }
    } else {
      const firstSt = stMap.get(train.stops[0]?.st)
      if (firstSt) {
        lat = firstSt.lat
        lng = firstSt.lng
        nextStopName = stMap.get(train.stops[1]?.st)?.name ?? '—'
      }
    }

    if (lat !== 0 && lng !== 0 && !isNaN(lat) && !isNaN(lng)) {
      results.push({
        train,
        type,
        lat,
        lng,
        fromName: stMap.get(train.from)?.name ?? train.from,
        toName: stMap.get(train.to)?.name ?? train.to,
        nextStopName,
        etaNext,
      })
    }
  }

  return results
}

export default function MapView({ activeFilters, onError, onRegisterRetry }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<maplibregl.Map | null>(null)
  const stationMarkersRef = useRef<maplibregl.Marker[]>([])
  const trainMarkersRef = useRef<maplibregl.Marker[]>([])
  const routesDataRef = useRef<Route[]>([])

  const [layerMode, setLayerMode] = useState<MapLayerMode>('streets')
  const [stations, setStations] = useState<Station[]>([])
  const [trains, setTrains] = useState<Train[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTrainCount, setActiveTrainCount] = useState(0)

  const loadData = useCallback(() => {
    clearApiCache()
    setLoading(true)
    onError?.(null)

    Promise.all([fetchStations(), fetchRoutes(), fetchGapeka()])
      .then(([stns, routes, gapeka]) => {
        setStations(stns)
        setTrains(gapeka)
        routesDataRef.current = routes

        const map = mapInstance.current
        if (map) {
          if (map.isStyleLoaded()) {
            applyRouteLayersToMap(map, routes)
          } else {
            map.once('style.load', () => applyRouteLayersToMap(map, routes))
          }
        }
        onError?.(null)
      })
      .catch((e: Error) => {
        onError?.(e.message)
      })
      .finally(() => setLoading(false))
  }, [onError])

  // Initial load
  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    onRegisterRetry?.(loadData)
  }, [onRegisterRetry, loadData])

  // Initialize MapLibre
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: buildMapStyle('streets'),
      center: [106.8272, -6.1751], // Jabodetabek / Jakarta
      zoom: 9.5,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    mapInstance.current = map

    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [])

  // Switch map layer
  const toggleLayerMode = () => {
    const next: MapLayerMode = layerMode === 'streets' ? 'satellite' : 'streets'
    setLayerMode(next)
    const map = mapInstance.current
    if (map) {
      map.setStyle(buildMapStyle(next))
      map.once('style.load', () => {
        if (routesDataRef.current.length > 0) {
          applyRouteLayersToMap(map, routesDataRef.current)
        }
      })
    }
  }

  // Render station and live train markers
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    const renderAllMarkers = () => {
      // 1. Clear station markers
      stationMarkersRef.current.forEach((m) => m.remove())
      stationMarkersRef.current = []

      // 2. Clear train markers
      trainMarkersRef.current.forEach((m) => m.remove())
      trainMarkersRef.current = []

      // ── Render Stations ──
      if (activeFilters.includes('stasiun')) {
        stations.forEach((station) => {
          if (!station.lat || !station.lng || isNaN(station.lat) || isNaN(station.lng)) return

          const markerContainer = document.createElement('div')
          markerContainer.className = 'station-marker-container cursor-pointer'

          const pinWrapper = document.createElement('div')
          pinWrapper.className = 'transition-transform duration-200 hover:scale-125'
          pinWrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
          `

          const pinBody = document.createElement('div')
          pinBody.style.cssText = `
            width: 20px;
            height: 20px;
            background: #0891B2;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2px solid #ffffff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
          `

          const dot = document.createElement('div')
          dot.style.cssText = `
            width: 5px; height: 5px;
            background: #ffffff;
            border-radius: 50%;
            transform: rotate(45deg);
          `
          pinBody.appendChild(dot)
          pinWrapper.appendChild(pinBody)
          markerContainer.appendChild(pinWrapper)

          const popup = new maplibregl.Popup({ offset: [0, -22], closeButton: false }).setHTML(`
            <div style="background:#ffffff; border-radius:12px; padding:10px 12px; font-family:'Plus Jakarta Sans',sans-serif; min-width:140px; color:#1E232C; box-shadow:0 8px 24px rgba(0,0,0,0.12);">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
                <span style="font-size:9px;font-weight:700;color:#0E7490;background:#ECFEFF;padding:2px 6px;border-radius:999px;border:1px solid #06B6D4;">STASIUN</span>
                <span style="font-size:10px;color:#64748B;font-weight:700;">${station.code}</span>
              </div>
              <div style="font-size:13px;font-weight:700;color:#0F172A;">${station.name}</div>
            </div>
          `)

          const marker = new maplibregl.Marker({ element: markerContainer, anchor: 'bottom' })
            .setLngLat([station.lng, station.lat])
            .setPopup(popup)
            .addTo(map)

          stationMarkersRef.current.push(marker)
        })
      }

      // ── Render Live Trains ──
      const liveTrains = getActiveTrains(trains, stations, activeFilters)
      setActiveTrainCount(liveTrains.length)

      liveTrains.forEach(({ train, type, lng, lat, fromName, toName, nextStopName, etaNext }) => {
        const isCommuter = type === 'commuter'
        const color = isCommuter ? '#3B82F6' : '#9333EA'
        const label = isCommuter ? (train.code || 'Commuter') : train.name

        // Outer container for MapLibre positioning (MapLibre sets style.transform here)
        const container = document.createElement('div')
        container.className = 'train-marker-container cursor-pointer'

        // Inner badge with hover scaling (does not conflict with MapLibre's transform)
        const badge = document.createElement('div')
        badge.className = 'train-badge transition-transform duration-200 ease-out hover:scale-115 active:scale-95'
        badge.style.cssText = `
          display: flex;
          align-items: center;
          gap: 5px;
          background: ${color};
          color: #ffffff;
          padding: 4px 8px;
          border-radius: 999px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          font-weight: 700;
          box-shadow: 0 4px 14px rgba(0,0,0,0.28);
          border: 1.5px solid #ffffff;
          white-space: nowrap;
          pointer-events: auto;
          user-select: none;
        `
        badge.innerHTML = `
          <span style="width:6px;height:6px;border-radius:50%;background:#10B981;box-shadow:0 0 6px #10B981;flex-shrink:0;"></span>
          <span style="max-width:110px;overflow:hidden;text-overflow:ellipsis;">${label}</span>
        `
        container.appendChild(badge)

        const popup = new maplibregl.Popup({ offset: [0, -18], closeButton: false }).setHTML(`
          <div style="background:#ffffff;border-radius:14px;padding:12px 14px;font-family:'Plus Jakarta Sans',sans-serif;min-width:190px;color:#1E232C;box-shadow:0 10px 30px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
              <span style="font-size:9px;font-weight:700;text-transform:uppercase;color:${isCommuter ? '#1E40AF' : '#6B21A8'};background:${isCommuter ? '#EFF6FF' : '#FAF5FF'};padding:2px 7px;border-radius:999px;border:1px solid ${isCommuter ? '#93C5FD' : '#E9D5FF'};">
                ${isCommuter ? 'Commuter Line' : 'Kereta Jarak Jauh'}
              </span>
              <span style="font-size:10px;font-weight:700;color:#10B981;display:flex;align-items:center;gap:3px;">
                <span style="width:5px;height:5px;border-radius:50%;background:#10B981;"></span>Live
              </span>
            </div>
            <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:2px;">
              ${train.name} <span style="font-size:11px;font-weight:600;color:#64748B;">(${train.code})</span>
            </div>
            <div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:6px;">
              ${fromName} → ${toName}
            </div>
            <div style="padding-top:6px;border-top:1px solid #F1F5F9;font-size:10.5px;color:#64748B;">
              Stasiun Berikutnya: <strong style="color:#0F172A;">${nextStopName}</strong> (${etaNext})
            </div>
          </div>
        `)

        const marker = new maplibregl.Marker({ element: container, anchor: 'center' })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map)

        trainMarkersRef.current.push(marker)
      })
    }

    if (map.isStyleLoaded()) {
      renderAllMarkers()
    } else {
      map.once('style.load', renderAllMarkers)
    }

    // Refresh live train positions every 15 seconds
    const interval = setInterval(renderAllMarkers, 15000)
    return () => clearInterval(interval)
  }, [stations, trains, activeFilters, layerMode])

  // Center on Jakarta button helper
  const handleCenterJakarta = () => {
    mapInstance.current?.flyTo({
      center: [106.8272, -6.1751],
      zoom: 11,
      essential: true,
    })
  }

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-sm z-10 pointer-events-none">
          <div className="flex items-center gap-2.5 bg-white rounded-xl px-4 py-2.5 shadow-lg border border-slate-200">
            <Loader2 size={16} className="animate-spin text-[#4D6BFE]" />
            <span className="text-sm font-semibold text-slate-700">Memuat data stasiun, rute rel, dan kereta...</span>
          </div>
        </div>
      )}

      {/* Floating status badges (top right) */}
      {!loading && (
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 items-end">
          {stations.length > 0 && activeFilters.includes('stasiun') && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl px-3 py-1.5 shadow text-xs font-semibold text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#0891B2]" />
              {stations.length} Stasiun
            </div>
          )}
          {activeTrainCount > 0 && (activeFilters.includes('commuter') || activeFilters.includes('jarak-jauh')) && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl px-3 py-1.5 shadow text-xs font-semibold text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {activeTrainCount} Kereta Berjalan
            </div>
          )}
        </div>
      )}

      {/* Controls (bottom left) */}
      <div className="absolute bottom-6 left-4 z-10 flex items-center gap-2">
        {/* Layer switcher */}
        <button
          type="button"
          onClick={toggleLayerMode}
          className="
            flex items-center gap-2 px-3 py-2 rounded-xl
            bg-white/95 backdrop-blur-md border border-slate-200/90
            shadow-[0_2px_8px_rgba(0,0,0,0.12)] hover:shadow-md hover:bg-white
            text-slate-800 text-xs font-semibold cursor-pointer transition-all active:scale-95
          "
        >
          <div className="w-7 h-7 rounded-lg overflow-hidden border border-slate-300 shrink-0 bg-slate-200 flex items-center justify-center">
            {layerMode === 'streets'
              ? <span className="text-[9px] font-bold text-slate-600">SAT</span>
              : <Layers size={13} className="text-[#4D6BFE]" />}
          </div>
          <span>{layerMode === 'streets' ? 'Lapisan: Peta' : 'Lapisan: Satelit'}</span>
        </button>

        {/* Center to Jabodetabek button */}
        <button
          type="button"
          onClick={handleCenterJakarta}
          title="Fokus ke Jabodetabek"
          className="
            p-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90
            shadow-[0_2px_8px_rgba(0,0,0,0.12)] hover:shadow-md hover:bg-white
            text-slate-700 hover:text-[#4D6BFE] transition-all active:scale-95 cursor-pointer
          "
        >
          <Navigation size={15} />
        </button>
      </div>
    </div>
  )
}
