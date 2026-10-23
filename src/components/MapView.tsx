import { useEffect, useRef, useState, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Layers, Loader2, Globe } from 'lucide-react'
import {
  fetchStations, fetchRoutes, fetchGapeka, clearApiCache,
  nowMs, msToDuration, msToHHMM,
  type Station, type Train, type Route,
} from '../api'
import type { FilterType } from './FilterPills'
import type { FeatureCollection } from 'geojson'

export interface MapController {
  flyToStation: (code: string) => void
  flyToTrain: (trainCode: string, trainId?: number, trainName?: string) => void
  flyToCoordinates: (lng: number, lat: number, zoom?: number) => void
  getCenter: () => [number, number] | null
}

interface MapViewProps {
  activeFilters: FilterType[]
  onError?: (err: string | null) => void
  onRegisterRetry?: (retryFn: () => void) => void
  onDataLoaded?: (stations: Station[], trains: Train[]) => void
  mapControllerRef?: React.MutableRefObject<MapController | null>
}

type MapLayerMode = 'streets' | 'satellite'

function buildMapStyle(mode: MapLayerMode): maplibregl.StyleSpecification | string {
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

function formatCommuterAcronym(name?: string, code?: string): string {
  const trainCode = code?.trim() || ''
  let cleanName = (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()

  if (!cleanName) {
    return trainCode ? `CL (${trainCode})` : 'CL'
  }

  // Normalize common prefixes to "Commuter Line"
  if (/^krl\s+/i.test(cleanName)) {
    cleanName = cleanName.replace(/^krl\s+/i, 'Commuter Line ')
  } else if (/^lin\s+/i.test(cleanName)) {
    cleanName = cleanName.replace(/^lin\s+/i, 'Commuter Line ')
  } else if (!/^commuter\s+line/i.test(cleanName) && !/^cl\b/i.test(cleanName)) {
    cleanName = `Commuter Line ${cleanName}`
  }

  const words = cleanName.split(/[\s\-–—/]+/).filter(Boolean)
  let acronym = ''

  for (const word of words) {
    if (word.toUpperCase() === 'CL') {
      acronym += 'CL'
    } else {
      acronym += word[0].toUpperCase()
    }
  }

  return trainCode ? `${acronym} (${trainCode})` : acronym
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

function createStationPopupHTML(station: Station): string {
  const bg = '#ffffff'
  const textColor = '#1E232C'
  const subColor = '#64748B'
  const borderColor = '#F1F5F9'
  const linkBg = '#EFF6FF'
  const linkBorder = '#BFDBFE'
  const linkText = '#1D4ED8'
  const badgeBg = '#FDF2F8'
  const badgeBorder = '#F472B6'
  const badgeText = '#9D174D'

  return `
    <div style="background:${bg}; border-radius:12px; padding:10px 12px; font-family:'Plus Jakarta Sans',sans-serif; min-width:160px; color:${textColor}; box-shadow:0 8px 24px rgba(0,0,0,0.12);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
        <span style="font-size:9px;font-weight:700;color:${badgeText};background:${badgeBg};padding:2px 6px;border-radius:999px;border:1px solid ${badgeBorder};">STASIUN</span>
        <span style="font-size:10px;color:${subColor};font-weight:700;">${station.code}</span>
      </div>
      <div style="font-size:13px;font-weight:700;color:${textColor};">${station.name}</div>
      <div style="margin-top:6px;padding-top:5px;border-top:1px solid ${borderColor};font-size:10.5px;color:${subColor};display:flex;flex-direction:column;gap:1.5px;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span>Latitude:</span>
          <strong style="color:${textColor};font-family:monospace;">${station.lat.toFixed(6)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span>Longitude:</span>
          <strong style="color:${textColor};font-family:monospace;">${station.lng.toFixed(6)}</strong>
        </div>
      </div>
      <a
        href="https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}"
        target="_blank"
        rel="noopener noreferrer"
        style="display:flex;align-items:center;justify-content:center;gap:5px;margin-top:8px;padding:5px 8px;border-radius:8px;background:${linkBg};border:1px solid ${linkBorder};color:${linkText};font-size:10.5px;font-weight:700;text-decoration:none;cursor:pointer;"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>Buka di Google Maps</span>
      </a>
    </div>
  `
}

function createTrainPopupHTML(
  train: Train,
  isCommuter: boolean,
  fromName: string,
  toName: string,
  nextStopName: string,
  etaNext: string,
): string {
  const bg = '#ffffff'
  const textColor = '#0F172A'
  const subColor = '#64748B'
  const routeColor = '#475569'
  const borderColor = '#F1F5F9'

  return `
    <div style="background:${bg};border-radius:14px;padding:12px 14px;font-family:'Plus Jakarta Sans',sans-serif;min-width:190px;color:${textColor};box-shadow:0 10px 30px rgba(0,0,0,0.18);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;color:${isCommuter ? '#1E40AF' : '#6B21A8'};background:${isCommuter ? '#EFF6FF' : '#FAF5FF'};padding:2px 7px;border-radius:999px;border:1px solid ${isCommuter ? '#93C5FD' : '#E9D5FF'};">
          ${isCommuter ? 'Commuter Line' : 'Kereta Jarak Jauh'}
        </span>
        <span style="font-size:10px;font-weight:700;color:#10B981;display:flex;align-items:center;gap:3px;">
          <span style="width:5px;height:5px;border-radius:50%;background:#10B981;"></span>Live
        </span>
      </div>
      <div style="font-size:13px;font-weight:800;color:${textColor};margin-bottom:2px;">
        ${train.name} <span style="font-size:11px;font-weight:600;color:${subColor};">(${train.code})</span>
      </div>
      <div style="font-size:11px;font-weight:600;color:${routeColor};margin-bottom:6px;">
        ${fromName} → ${toName}
      </div>
      <div style="padding-top:6px;border-top:1px solid ${borderColor};font-size:10.5px;color:${subColor};">
        Stasiun Berikutnya: <strong style="color:${textColor};">${nextStopName}</strong> (${etaNext})
      </div>
    </div>
  `
}

export default function MapView({
  activeFilters,
  onError,
  onRegisterRetry,
  onDataLoaded,
  mapControllerRef,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<maplibregl.Map | null>(null)
  const stationMarkersRef = useRef<maplibregl.Marker[]>([])
  const trainMarkersRef = useRef<maplibregl.Marker[]>([])
  const stationMarkersMapRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; station: Station }>>(new Map())
  const trainMarkersMapRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; train: Train }>>(new Map())
  const activePopupRef = useRef<maplibregl.Popup | null>(null)
  const routesDataRef = useRef<Route[]>([])
  const isInitialMount = useRef(true)

  const [layerMode, setLayerMode] = useState<MapLayerMode>('streets')
  const [stations, setStations] = useState<Station[]>([])
  const [trains, setTrains] = useState<Train[]>([])
  const [loading, setLoading] = useState(true)
  const [mapReady, setMapReady] = useState(false)

  const loadData = useCallback((forceRefresh = false) => {
    if (forceRefresh) clearApiCache()
    setLoading(true)
    onError?.(null)

    Promise.all([fetchStations(), fetchRoutes(), fetchGapeka()])
      .then(([stns, routes, gapeka]) => {
        setStations(stns)
        setTrains(gapeka)
        routesDataRef.current = routes
        onDataLoaded?.(stns, gapeka)

        const map = mapInstance.current
        if (map && (map.loaded() || map.isStyleLoaded())) {
          applyRouteLayersToMap(map, routes)
        }
        onError?.(null)
      })
      .catch((e: Error) => {
        onError?.(e.message)
      })
      .finally(() => setLoading(false))
  }, [onError, onDataLoaded])

  // Initial load
  useEffect(() => {
    loadData(false)
  }, [loadData])

  useEffect(() => {
    onRegisterRetry?.(() => loadData(true))
  }, [onRegisterRetry, loadData])

  // Initialize MapLibre
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: buildMapStyle(layerMode),
      center: [106.8272, -6.1751], // Jabodetabek / Jakarta
      zoom: 9.5,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    mapInstance.current = map

    if (map.loaded()) {
      setMapReady(true)
    } else {
      map.once('load', () => setMapReady(true))
    }

    return () => {
      map.remove()
      mapInstance.current = null
      setMapReady(false)
    }
  }, [])

  // Apply route layers when map becomes ready or layer changes
  useEffect(() => {
    const map = mapInstance.current
    if (!map || !mapReady) return
    if (routesDataRef.current.length > 0) {
      applyRouteLayersToMap(map, routesDataRef.current)
    }
  }, [mapReady, layerMode])

  // Switch map layer
  const toggleLayerMode = () => {
    setLayerMode((prev) => (prev === 'streets' ? 'satellite' : 'streets'))
  }

  // Update map style when layerMode changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    const map = mapInstance.current
    if (!map) return
    map.setStyle(buildMapStyle(layerMode))
    map.once('style.load', () => {
      if (routesDataRef.current.length > 0) {
        applyRouteLayersToMap(map, routesDataRef.current)
      }
    })
  }, [layerMode])

  // Render station and live train markers
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    const renderAllMarkers = () => {
      // 1. Clear station markers
      stationMarkersRef.current.forEach((m) => m.remove())
      stationMarkersRef.current = []
      stationMarkersMapRef.current.clear()

      // 2. Clear train markers
      trainMarkersRef.current.forEach((m) => m.remove())
      trainMarkersRef.current = []
      trainMarkersMapRef.current.clear()

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
          pinBody.className = 'station-pin'

          const dot = document.createElement('div')
          dot.className = 'station-pin-dot'
          pinBody.appendChild(dot)
          pinWrapper.appendChild(pinBody)

          const nameLabel = document.createElement('div')
          nameLabel.className = 'station-name-label'
          nameLabel.textContent = station.name
          pinWrapper.appendChild(nameLabel)
          markerContainer.appendChild(pinWrapper)

          const popup = new maplibregl.Popup({ offset: [0, -28], closeButton: false }).setHTML(
            createStationPopupHTML(station)
          )

          const marker = new maplibregl.Marker({ element: markerContainer, anchor: 'bottom' })
            .setLngLat([station.lng, station.lat])
            .setPopup(popup)
            .addTo(map)

          stationMarkersRef.current.push(marker)
          stationMarkersMapRef.current.set(station.code.toLowerCase(), { marker, popup, station })
        })
      }

      // ── Render Live Trains ──
      const liveTrains = getActiveTrains(trains, stations, activeFilters)

      const TRAIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h0"/><path d="M16 15h0"/></svg>`
      const COMPASS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`

      liveTrains.forEach(({ train, type, lng, lat, fromName, toName, nextStopName, etaNext }) => {
        const isCommuter = type === 'commuter'
        const label = isCommuter ? formatCommuterAcronym(train.name, train.code) : train.name
        const iconSvg = isCommuter ? TRAIN_ICON_SVG : COMPASS_ICON_SVG

        // Outer container for MapLibre positioning (MapLibre sets style.transform here)
        const container = document.createElement('div')
        container.className = 'train-marker-container cursor-pointer'

        // Inner badge with hover scaling (does not conflict with MapLibre's transform)
        const badge = document.createElement('div')
        badge.className = `train-badge ${isCommuter ? 'train-badge-commuter' : 'train-badge-jarak-jauh'} transition-transform duration-200 ease-out hover:scale-115 active:scale-95`
        badge.innerHTML = `
          ${iconSvg}
          <span style="max-width:170px;overflow:hidden;text-overflow:ellipsis;">${label}</span>
        `
        container.appendChild(badge)

        const popup = new maplibregl.Popup({ offset: [0, -18], closeButton: false }).setHTML(
          createTrainPopupHTML(train, isCommuter, fromName, toName, nextStopName, etaNext)
        )

        const marker = new maplibregl.Marker({ element: container, anchor: 'center' })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map)

        trainMarkersRef.current.push(marker)
        trainMarkersMapRef.current.set(train.code.toLowerCase(), { marker, popup, train })
        trainMarkersMapRef.current.set(String(train.id), { marker, popup, train })
      })
    }

    // Render markers immediately
    renderAllMarkers()

    // If the map is still in the middle of initial load, re-render once it fires 'load'
    if (!map.loaded()) {
      map.once('load', renderAllMarkers)
    }

    // Refresh live train positions every 15 seconds
    const interval = setInterval(renderAllMarkers, 15000)
    return () => {
      clearInterval(interval)
      map.off('load', renderAllMarkers)
    }
  }, [stations, trains, activeFilters, layerMode, mapReady])

  // Center / fly to handlers exposed via mapControllerRef
  const flyToStation = useCallback((code: string) => {
    const map = mapInstance.current
    if (!map) return

    const targetStation = stations.find((s) => s.code.toLowerCase() === code.toLowerCase())
    if (!targetStation) return

    activePopupRef.current?.remove()

    map.flyTo({
      center: [targetStation.lng, targetStation.lat],
      zoom: 15.5,
      duration: 1500,
      essential: true,
    })

    const markerObj = stationMarkersMapRef.current.get(targetStation.code.toLowerCase())
    if (markerObj) {
      markerObj.popup.setLngLat([targetStation.lng, targetStation.lat]).addTo(map)
      activePopupRef.current = markerObj.popup
    } else {
      const popup = new maplibregl.Popup({ offset: [0, -28], closeButton: true })
        .setLngLat([targetStation.lng, targetStation.lat])
        .setHTML(createStationPopupHTML(targetStation))
        .addTo(map)
      activePopupRef.current = popup
    }
  }, [stations])

  const flyToTrain = useCallback((trainCode: string, trainId?: number, _trainName?: string) => {
    const map = mapInstance.current
    if (!map) return

    activePopupRef.current?.remove()

    const targetCode = trainCode.trim().toLowerCase()

    // 1. Check if train is active right now (match by unique ID or Code first!)
    const liveTrains = getActiveTrains(trains, stations, ['commuter', 'jarak-jauh'])
    const active = liveTrains.find((t) => {
      if (trainId !== undefined && t.train.id === trainId) return true
      if (targetCode && t.train.code.toLowerCase() === targetCode) return true
      return false
    })

    if (active) {
      const markerObj =
        trainMarkersMapRef.current.get(active.train.code.toLowerCase()) ||
        trainMarkersMapRef.current.get(String(active.train.id))

      const targetLng = markerObj ? markerObj.marker.getLngLat().lng : active.lng
      const targetLat = markerObj ? markerObj.marker.getLngLat().lat : active.lat

      map.flyTo({
        center: [targetLng, targetLat],
        zoom: 15,
        duration: 1500,
        essential: true,
      })

      if (markerObj) {
        markerObj.popup.setLngLat([targetLng, targetLat]).addTo(map)
        activePopupRef.current = markerObj.popup
      } else {
        const popup = new maplibregl.Popup({ offset: [0, -18], closeButton: true })
          .setLngLat([targetLng, targetLat])
          .setHTML(
            createTrainPopupHTML(
              active.train,
              active.type === 'commuter',
              active.fromName,
              active.toName,
              active.nextStopName,
              active.etaNext
            )
          )
          .addTo(map)
        activePopupRef.current = popup
      }
      return
    }

    // 2. Train not active right now. Match targetTrain by unique ID or Code.
    const targetTrain = trains.find((t) => {
      if (trainId !== undefined && t.id === trainId) return true
      if (targetCode && t.code.toLowerCase() === targetCode) return true
      return false
    })
    if (!targetTrain) return

    const stMap = new Map(stations.map((s) => [s.code, s]))
    const firstSt = stMap.get(targetTrain.stops?.[0]?.st || targetTrain.from)
    const lastSt = stMap.get(targetTrain.to)

    if (firstSt) {
      map.flyTo({
        center: [firstSt.lng, firstSt.lat],
        zoom: 14.5,
        duration: 1500,
        essential: true,
      })

      const isCommuter =
        /commuter|krl|lin|feeder|prameks|bandara/i.test(targetTrain.name) ||
        /commuter|krl|lin/i.test(targetTrain.code)
      const color = isCommuter ? '#3B82F6' : '#9333EA'

      const bg = '#ffffff'
      const textColor = '#0F172A'
      const subColor = '#64748B'
      const routeColor = '#475569'
      const borderColor = '#F1F5F9'
      const inactiveBg = '#FFF1F2'
      const inactiveText = '#E11D48'

      const popup = new maplibregl.Popup({ offset: [0, -20], closeButton: true })
        .setLngLat([firstSt.lng, firstSt.lat])
        .setHTML(`
          <div style="background:${bg};border-radius:14px;padding:12px 14px;font-family:'Plus Jakarta Sans',sans-serif;min-width:210px;color:${textColor};box-shadow:0 10px 30px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
              <span style="font-size:9px;font-weight:700;text-transform:uppercase;color:${color};background:${isCommuter ? '#EFF6FF' : '#FAF5FF'};padding:2px 7px;border-radius:999px;border:1px solid ${color}40;">
                ${isCommuter ? 'Commuter Line' : 'Kereta Jarak Jauh'}
              </span>
              <span style="font-size:10px;font-weight:700;color:${subColor};">
                KA ${targetTrain.code}
              </span>
            </div>
            <div style="font-size:13px;font-weight:800;color:${textColor};margin-bottom:3px;">
              ${targetTrain.name}
            </div>
            <div style="font-size:11px;font-weight:600;color:${routeColor};margin-bottom:6px;">
              ${firstSt.name} (${firstSt.code}) → ${lastSt?.name || targetTrain.to} (${lastSt?.code || targetTrain.to})
            </div>
            <div style="padding-top:6px;border-top:1px solid ${borderColor};font-size:10.5px;color:${subColor};display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>Jadwal:</span>
              <strong style="color:${textColor};">${msToHHMM(targetTrain.dep_ms)} - ${msToHHMM(targetTrain.arr_ms)}</strong>
            </div>
            <div style="font-size:9.5px;color:${inactiveText};font-weight:600;background:${inactiveBg};padding:3px 7px;border-radius:6px;margin-top:4px;text-align:center;">
              Saat ini tidak beroperasi • Menampilkan stasiun awal
            </div>
          </div>
        `)
        .addTo(map)
      activePopupRef.current = popup
    }
  }, [trains, stations])

  const flyToCoordinates = useCallback((lng: number, lat: number, zoom = 15) => {
    mapInstance.current?.flyTo({
      center: [lng, lat],
      zoom,
      duration: 1500,
      essential: true,
    })
  }, [])

  const getCenter = useCallback((): [number, number] | null => {
    const map = mapInstance.current
    if (!map) return null
    const c = map.getCenter()
    return [c.lng, c.lat]
  }, [])

  useEffect(() => {
    if (mapControllerRef) {
      mapControllerRef.current = {
        flyToStation,
        flyToTrain,
        flyToCoordinates,
        getCenter,
      }
    }
  }, [mapControllerRef, flyToStation, flyToTrain, flyToCoordinates, getCenter])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/30 dark:bg-slate-950/40 backdrop-blur-sm z-10 pointer-events-none">
          <div className="flex items-center gap-2.5 bg-white dark:bg-slate-900 rounded-xl px-4 py-2.5 shadow-lg border border-slate-200 dark:border-slate-800">
            <Loader2 size={16} className="animate-spin text-[#4D6BFE] dark:text-blue-400" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Memuat data stasiun, rute rel, dan kereta...</span>
          </div>
        </div>
      )}

      {/* Controls (bottom left) - raised higher on mobile */}
      <div className="absolute bottom-14 sm:bottom-6 left-4 z-10 flex items-center gap-2">
        {/* Layer switcher */}
        <button
          type="button"
          onClick={toggleLayerMode}
          className="
            flex items-center gap-2 px-3 py-2 rounded-xl
            bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800
            shadow-[0_2px_8px_rgba(0,0,0,0.12)] hover:shadow-md hover:bg-white dark:hover:bg-slate-800
            text-slate-800 dark:text-slate-100 text-xs font-semibold cursor-pointer transition-all active:scale-95
          "
        >
          <div className="w-7 h-7 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            {layerMode === 'streets' ? (
              <Layers size={14} className="text-[#4D6BFE] dark:text-blue-400" />
            ) : (
              <Globe size={14} className="text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <span>{layerMode === 'streets' ? 'Lapisan: Peta' : 'Lapisan: Satelit'}</span>
        </button>
      </div>
    </div>
  )
}
