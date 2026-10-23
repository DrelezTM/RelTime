import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Layers, Loader2 } from 'lucide-react'
import { fetchStations, fetchRoutes, type Station } from '../api'
import type { FilterType } from './FilterPills'
import type { FeatureCollection } from 'geojson'

// Marker pin colors per station type (all stations from API are 'stasiun' by default,
// we categorise by checking if the station appears in any train stop as a commuter/LJ endpoint)
const pinColors: Record<FilterType, { label: string; bg: string; border: string; text: string; pinColor: string }> = {
  stasiun: {
    label: 'Stasiun',
    bg: '#ECFEFF',
    border: '#06B6D4',
    text: '#0E7490',
    pinColor: '#0891B2',
  },
  commuter: {
    label: 'Commuter',
    bg: '#EEF3FF',
    border: '#4D6BFE',
    text: '#1E40AF',
    pinColor: '#4D6BFE',
  },
  'jarak-jauh': {
    label: 'Jarak Jauh',
    bg: '#FAF5FF',
    border: '#A855F7',
    text: '#7E22CE',
    pinColor: '#9333EA',
  },
}

// All stations from API are 'stasiun'; FilterType only used for pin color logic here
const stationFilterType = (_code: string): FilterType => 'stasiun'

interface MapViewProps {
  activeFilters: FilterType[]
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

export default function MapView({ activeFilters }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const routesAddedRef = useRef(false)

  const [layerMode, setLayerMode] = useState<MapLayerMode>('streets')
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch stations + routes once on mount
  useEffect(() => {
    setLoading(true)
    Promise.all([fetchStations(), fetchRoutes()])
      .then(([stns, _routes]) => {
        setStations(stns)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: buildMapStyle('streets'),
      center: [106.8272, -6.1751],
      zoom: 10,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
      routesAddedRef.current = false
    }
  }, [])

  // Draw route polylines when map loads and stations are ready
  useEffect(() => {
    const map = mapInstance.current
    if (!map || routesAddedRef.current) return

    const addRoutes = async () => {
      try {
        const routes = await fetchRoutes()

        const addRouteLayers = () => {
          // Remove existing route layers if any (after style change)
          if (map.getLayer('train-routes')) map.removeLayer('train-routes')
          if (map.getSource('train-routes')) map.removeSource('train-routes')

          const geojson: FeatureCollection = {
            type: 'FeatureCollection',
            features: routes.map((route) => ({
              type: 'Feature',
              properties: { id: route.id },
              geometry: {
                type: 'LineString',
                // pts format: [dist_cm, lat, lng] → MapLibre wants [lng, lat]
                coordinates: route.pts.map(([, lat, lng]) => [lng, lat]),
              },
            })),
          }

          map.addSource('train-routes', { type: 'geojson', data: geojson })

          // Outline / halo
          map.addLayer({
            id: 'train-routes-outline',
            type: 'line',
            source: 'train-routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': 5,
              'line-opacity': 0.6,
            },
          })

          // Main line
          map.addLayer({
            id: 'train-routes',
            type: 'line',
            source: 'train-routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#4D6BFE',
              'line-width': 3,
              'line-opacity': 0.85,
            },
          })

          routesAddedRef.current = true
        }

        if (map.isStyleLoaded()) {
          addRouteLayers()
        } else {
          map.once('style.load', addRouteLayers)
        }
      } catch {
        // routes unavailable — silently skip
      }
    }

    addRoutes()
  }, [stations]) // re-run once stations (and thus routes) are fetched

  // Switch map layer
  const toggleLayerMode = () => {
    const next: MapLayerMode = layerMode === 'streets' ? 'satellite' : 'streets'
    setLayerMode(next)
    routesAddedRef.current = false // force re-draw after style change
    mapInstance.current?.setStyle(buildMapStyle(next))
  }

  // Re-draw route lines after style switch
  useEffect(() => {
    const map = mapInstance.current
    if (!map || routesAddedRef.current) return

    const redraw = async () => {
      try {
        const routes = await fetchRoutes()
        const geojson: FeatureCollection = {
          type: 'FeatureCollection',
          features: routes.map((route) => ({
            type: 'Feature',
            properties: { id: route.id },
            geometry: {
              type: 'LineString',
              coordinates: route.pts.map(([, lat, lng]) => [lng, lat]),
            },
          })),
        }

        if (map.getLayer('train-routes-outline')) map.removeLayer('train-routes-outline')
        if (map.getLayer('train-routes')) map.removeLayer('train-routes')
        if (map.getSource('train-routes')) map.removeSource('train-routes')

        map.addSource('train-routes', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'train-routes-outline',
          type: 'line',
          source: 'train-routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.6 },
        })
        map.addLayer({
          id: 'train-routes',
          type: 'line',
          source: 'train-routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#4D6BFE', 'line-width': 3, 'line-opacity': 0.85 },
        })
        routesAddedRef.current = true
      } catch { /* silent */ }
    }

    map.once('style.load', redraw)
  }, [layerMode])

  // Render station markers
  useEffect(() => {
    const map = mapInstance.current
    if (!map || stations.length === 0) return

    const renderMarkers = () => {
      // Clear old markers
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      // When activeFilters includes 'stasiun', show all API stations
      if (!activeFilters.includes('stasiun')) return

      stations.forEach((station) => {
        const type = stationFilterType(station.code)
        const config = pinColors[type]

        // Container element (MapLibre positions this)
        const markerContainer = document.createElement('div')
        markerContainer.className = 'station-marker-container cursor-pointer'

        // Inner animated pin wrapper
        const pinWrapper = document.createElement('div')
        pinWrapper.className = 'station-pin-wrapper transition-all duration-200 ease-out hover:scale-125'
        pinWrapper.style.cssText = `
          transform-origin: bottom center;
          display: flex;
          flex-direction: column;
          align-items: center;
        `

        // Teardrop pin body
        const pinBody = document.createElement('div')
        pinBody.style.cssText = `
          width: 24px;
          height: 24px;
          background: ${config.pinColor};
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 2px solid #ffffff;
          box-shadow: 0 3px 8px rgba(0,0,0,0.28);
          display: flex;
          align-items: center;
          justify-content: center;
        `
        const dot = document.createElement('div')
        dot.style.cssText = `
          width: 7px; height: 7px;
          background: #ffffff;
          border-radius: 50%;
          transform: rotate(45deg);
        `
        pinBody.appendChild(dot)
        pinWrapper.appendChild(pinBody)
        markerContainer.appendChild(pinWrapper)

        // Popup
        const popup = new maplibregl.Popup({
          offset: [0, -28],
          closeButton: false,
        }).setHTML(`
          <div style="
            background:#ffffff; border-radius:12px; padding:10px 13px;
            box-shadow:0 8px 24px rgba(0,0,0,0.14);
            font-family:'Plus Jakarta Sans',sans-serif;
            min-width:150px; color:#1E232C;
          ">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;">
              <span style="
                font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;
                color:${config.text};background:${config.bg};
                padding:2px 6px;border-radius:999px;border:1px solid ${config.border};
              ">${config.label}</span>
              <span style="font-size:10px;color:#6B7280;font-weight:600;">${station.code}</span>
            </div>
            <div style="font-size:13px;font-weight:700;color:#0F172A;">${station.name}</div>
          </div>
        `)

        const marker = new maplibregl.Marker({ element: markerContainer, anchor: 'bottom' })
          .setLngLat([station.lng, station.lat])
          .setPopup(popup)
          .addTo(map)

        markersRef.current.push(marker)
      })
    }

    if (map.isStyleLoaded()) {
      renderMarkers()
    } else {
      map.once('style.load', renderMarkers)
    }
  }, [stations, activeFilters, layerMode])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-sm z-10 pointer-events-none">
          <div className="flex items-center gap-2.5 bg-white rounded-xl px-4 py-2.5 shadow-lg border border-slate-200">
            <Loader2 size={16} className="animate-spin text-[#4D6BFE]" />
            <span className="text-sm font-semibold text-slate-700">Memuat data stasiun...</span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && !loading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 max-w-xs w-full px-4">
          <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-2.5 shadow text-xs text-red-700 font-medium text-center">
            ⚠ Gagal memuat data: {error}
          </div>
        </div>
      )}

      {/* Station count badge */}
      {!loading && stations.length > 0 && (
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl px-3 py-2 shadow text-xs font-semibold text-slate-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#4D6BFE]" />
            {stations.length} Stasiun
          </div>
        </div>
      )}

      {/* Layer switcher */}
      <div className="absolute bottom-6 left-4 z-10">
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
      </div>
    </div>
  )
}
