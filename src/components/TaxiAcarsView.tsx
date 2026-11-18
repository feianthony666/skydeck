import L from 'leaflet';
import {Plane, Radio, RefreshCw, Search} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AIRPORT_CATALOG, resolveAirlineLivery, type AirportSpec} from '../data/aviationCatalog';
import {apiFetchJson} from '../services/directAviationClient';
import {buildFr24AircraftSvg, resolveFr24ModelClass} from './aircraftIcons';
import type {
  AcarsMessage,
  AirfieldSurfaceData,
  AirportWeather,
  LiveFlight,
  TaxiwaySegment,
} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './ui/card';
import {Input} from './ui/input';
import {Separator} from './ui/separator';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './ui/table';
import {TabsList, TabsTrigger} from './ui/tabs';

interface TaxiAcarsViewProps {
  acarsMessages: AcarsMessage[];
  acarsStatus: string;
  airportsWeather: AirportWeather[];
  theme: 'dark' | 'light';
  onRefreshAcars: () => void;
  onInspectFlight: (flight: LiveFlight) => void;
}

export const TaxiAcarsView: React.FC<TaxiAcarsViewProps> = ({
  acarsMessages,
  acarsStatus,
  airportsWeather,
  theme,
  onRefreshAcars,
  onInspectFlight,
}) => {
  const [selectedIcao, setSelectedIcao] = useState<string>('ZBAA');
  const [groundTraffic, setGroundTraffic] = useState<LiveFlight[]>([]);
  const [nearbyAirborne, setNearbyAirborne] = useState<LiveFlight[]>([]);
  const [segments, setSegments] = useState<TaxiwaySegment[]>([]);
  const [surfaceData, setSurfaceData] = useState<AirfieldSurfaceData | null>(null);
  const [taxiLoading, setTaxiLoading] = useState(false);
  const [acarsFilter, setAcarsFilter] = useState<'ALL' | 'OOOI' | 'POS' | 'WX' | 'ATC' | 'MAINT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const taxiMapDivRef = useRef<HTMLDivElement | null>(null);
  const taxiMapRef = useRef<L.Map | null>(null);
  const taxiTileRef = useRef<L.TileLayer[]>([]);
  const taxiGeomRef = useRef<L.LayerGroup | null>(null);
  const taxiPlaneRef = useRef<L.LayerGroup | null>(null);

  const airportSpec: AirportSpec = useMemo(
    () => AIRPORT_CATALOG.find((a) => a.icao === selectedIcao) ?? AIRPORT_CATALOG[0],
    [selectedIcao],
  );

  const airportWx = useMemo(
    () => airportsWeather.find((w) => w.icao === selectedIcao),
    [airportsWeather, selectedIcao],
  );

  const fetchAirportTaxi = async (icao: string) => {
    setTaxiLoading(true);
    const spec = AIRPORT_CATALOG.find((a) => a.icao === icao) ?? AIRPORT_CATALOG[0];
    try {
      const [taxiRes, surfRes] = await Promise.all([
        apiFetchJson<{
          groundTraffic: LiveFlight[];
          nearbyAirborne: LiveFlight[];
          segments: TaxiwaySegment[];
        }>(`/api/airport-taxi?icao=${encodeURIComponent(icao)}`),
        apiFetchJson<AirfieldSurfaceData>(
          `/api/surface?icao=${encodeURIComponent(icao)}&lat=${spec.lat}&lon=${spec.lon}`,
        ).catch(() => null),
      ]);
      setGroundTraffic(taxiRes.groundTraffic ?? []);
      setNearbyAirborne(taxiRes.nearbyAirborne ?? []);
      setSegments(taxiRes.segments ?? []);
      if (surfRes) setSurfaceData(surfRes);
    } catch {
      // Keep cached state when offline
    } finally {
      setTaxiLoading(false);
    }
  };

  useEffect(() => {
    setSurfaceData(null);
    fetchAirportTaxi(selectedIcao);
    const id = window.setInterval(() => fetchAirportTaxi(selectedIcao), 10000);
    return () => clearInterval(id);
  }, [selectedIcao]);

  useEffect(() => {
    const el = taxiMapDivRef.current;
    if (!el) return;
    const map = L.map(el, {
      center: [airportSpec.lat, airportSpec.lon],
      zoom: 13,
      minZoom: 11,
      maxZoom: 20,
    });
    const geomLayer = L.layerGroup().addTo(map);
    const planeLayer = L.layerGroup().addTo(map);

    taxiMapRef.current = map;
    taxiGeomRef.current = geomLayer;
    taxiPlaneRef.current = planeLayer;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      taxiMapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = taxiMapRef.current;
    if (!map) return;
    map.setView([airportSpec.lat, airportSpec.lon], 13, {animate: true});
  }, [airportSpec]);

  // Verified zero-API-key real surface tiles with maxNativeZoom upscaling up to z20
  useEffect(() => {
    const map = taxiMapRef.current;
    if (!map) return;
    for (const old of taxiTileRef.current) map.removeLayer(old);
    taxiTileRef.current = [];

    const tileOpts = {keepBuffer: 4, updateWhenIdle: true, updateWhenZooming: false};
    const layers: L.TileLayer[] =
      theme === 'dark'
        ? [
            L.tileLayer(
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              {
                ...tileOpts,
                maxNativeZoom: 16,
                maxZoom: 20,
                attribution: 'Tiles &copy; Esri',
              },
            ),
            L.tileLayer(
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
              {
                ...tileOpts,
                maxNativeZoom: 15,
                maxZoom: 20,
              },
            ),
          ]
        : [
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
              ...tileOpts,
              maxNativeZoom: 19,
              maxZoom: 20,
              attribution: '&copy; OpenStreetMap',
            }),
          ];

    for (const tile of layers) {
      tile.addTo(map);
      tile.bringToBack();
    }
    taxiTileRef.current = layers;
  }, [theme]);

  useEffect(() => {
    const layer = taxiGeomRef.current;
    if (!layer) return;
    layer.clearLayers();

    const aprons = surfaceData?.aprons ?? [];
    for (const poly of aprons) {
      L.polygon(poly, {
        color: 'rgba(250, 204, 21, 0.25)',
        weight: 0.9,
        fillColor: theme === 'dark' ? '#0f141e' : '#263244',
        fillOpacity: theme === 'dark' ? 0.65 : 0.45,
        interactive: false,
      }).addTo(layer);
    }

    const taxiways =
      surfaceData && surfaceData.taxiways.length > 0
        ? surfaceData.taxiways
        : segments.filter((s) => s.kind === 'taxiway');

    const placedRefs = new Set<string>();
    for (const seg of taxiways) {
      if (seg.coords.length < 2) continue;
      L.polyline(seg.coords, {
        color: 'rgba(250, 204, 21, 0.32)',
        weight: 7,
        opacity: 0.9,
        interactive: false,
      }).addTo(layer);
      L.polyline(seg.coords, {
        color: theme === 'dark' ? '#111622' : '#1e293b',
        weight: 4.5,
        opacity: 0.95,
        interactive: false,
      }).addTo(layer);
      L.polyline(seg.coords, {
        color: '#FACC15',
        weight: 1,
        opacity: 0.5,
        interactive: false,
      }).addTo(layer);

      const mid = seg.coords[Math.floor(seg.coords.length / 2)];
      if (seg.ref && !placedRefs.has(`${seg.ref}-${mid[0].toFixed(3)}`)) {
        placedRefs.add(`${seg.ref}-${mid[0].toFixed(3)}`);
        L.marker(mid, {
          interactive: false,
          icon: L.divIcon({
            className: 'skydeck-taxi-badge',
            iconSize: [28, 14],
            iconAnchor: [14, 7],
            html: `<span style="display:inline-flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;color:#FDE047;text-shadow:0 1px 3px rgba(0,0,0,0.95);">${seg.ref}</span>`,
          }),
        }).addTo(layer);
      }

      for (let i = 0; i < seg.coords.length; i += Math.max(1, Math.floor(seg.coords.length / 3))) {
        L.circleMarker(seg.coords[i], {
          radius: 1.4,
          color: '#22c55e',
          fillColor: '#4ade80',
          fillOpacity: 0.88,
          weight: 0,
          interactive: false,
        }).addTo(layer);
        if (i === 0 && seg.coords.length >= 2) {
          const p0 = seg.coords[0];
          const p1 = seg.coords[1];
          const dLat = p1[0] - p0[0];
          const dLon = p1[1] - p0[1];
          const len = Math.max(1e-6, Math.hypot(dLat, dLon));
          const offLat = (-dLon / len) * 0.00011;
          const offLon = (dLat / len) * 0.00011;
          for (const sign of [-1, 1]) {
            L.circleMarker([p0[0] + offLat * sign, p0[1] + offLon * sign], {
              radius: 1.1,
              color: '#0ea5e9',
              fillColor: '#38bdf8',
              fillOpacity: 0.8,
              weight: 0,
              interactive: false,
            }).addTo(layer);
          }
        }
      }
    }

    const runways =
      surfaceData && surfaceData.runways.length > 0
        ? surfaceData.runways
        : segments.filter((s) => s.kind === 'runway');

    for (const rwy of runways) {
      if (rwy.coords.length < 2) continue;
      const pA = rwy.coords[0];
      const pB = rwy.coords[rwy.coords.length - 1];
      const dLat = pB[0] - pA[0];
      const dLon = pB[1] - pA[1];
      const norm = Math.max(1e-6, Math.hypot(dLat, dLon));
      const extLat = (dLat / norm) * 0.045;
      const extLon = (dLon / norm) * 0.045;

      // Dashed |- - - - -| approach paths
      L.polyline([[pA[0] - extLat, pA[1] - extLon], pA], {
        color: 'rgba(248, 250, 252, 0.5)',
        weight: 1.3,
        dashArray: '6 6',
        interactive: false,
      }).addTo(layer);
      L.polyline([pB, [pB[0] + extLat, pB[1] + extLon]], {
        color: 'rgba(248, 250, 252, 0.5)',
        weight: 1.3,
        dashArray: '6 6',
        interactive: false,
      }).addTo(layer);

      L.polyline(rwy.coords, {
        color: 'rgba(255,255,255,0.28)',
        weight: 16,
        opacity: 0.95,
        lineCap: 'butt',
        interactive: false,
      }).addTo(layer);
      L.polyline(rwy.coords, {
        color: '#060910',
        weight: 11,
        opacity: 1,
        lineCap: 'butt',
        interactive: false,
      }).addTo(layer);
      L.polyline(rwy.coords, {
        color: '#FFFFFF',
        weight: 1.8,
        dashArray: '8 8',
        opacity: 0.95,
        interactive: false,
      }).addTo(layer);

      for (const pt of [pA, pB]) {
        L.circleMarker(pt, {
          radius: 3.5,
          color: '#ef4444',
          fillColor: '#f87171',
          fillOpacity: 0.95,
          weight: 1,
          interactive: false,
        }).addTo(layer);
      }

      if (rwy.ref) {
        const [aLbl, bLbl] = rwy.ref.split('/');
        if (aLbl) {
          L.marker(pA, {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-runway-num',
              iconSize: [28, 14],
              iconAnchor: [14, 7],
              html: `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;color:#FFFFFF;text-shadow:0 1px 4px rgba(0,0,0,0.95);">${aLbl.trim()}</span>`,
            }),
          }).addTo(layer);
        }
        if (bLbl) {
          L.marker(pB, {
            interactive: false,
            icon: L.divIcon({
              className: 'skydeck-runway-num',
              iconSize: [28, 14],
              iconAnchor: [14, 7],
              html: `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;color:#FFFFFF;text-shadow:0 1px 4px rgba(0,0,0,0.95);">${bLbl.trim()}</span>`,
            }),
          }).addTo(layer);
        }
      }
    }
  }, [segments, surfaceData, theme]);

  useEffect(() => {
    const layer = taxiPlaneRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const f of [...groundTraffic, ...nearbyAirborne]) {
      const color = f.onGround ? '#22C55E' : '#38BDF8';
      const svg = buildFr24AircraftSvg(
        resolveFr24ModelClass(f.aircraftType, f.callsign),
        22,
        color,
        '#0B0E14',
      );
      const icon = L.divIcon({
        className: 'skydeck-taxi-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="transform:rotate(${Math.round(f.trueTrackDeg)}deg);width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${svg}</div>`,
      });
      const m = L.marker([f.lat, f.lon], {icon});
      m.on('click', () => onInspectFlight(f));
      m.bindTooltip(
        `${f.callsign} · ${f.aircraftType} · ${f.groundSpeedKts} KT${f.onGround ? ' (GND)' : ''}`,
        {direction: 'top'},
      );
      m.addTo(layer);
    }
  }, [groundTraffic, nearbyAirborne, onInspectFlight]);

  const filteredAcars = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return acarsMessages.filter((m) => {
      if (acarsFilter !== 'ALL' && m.category !== acarsFilter) return false;
      if (!q) return true;
      return (
        m.callsign.toUpperCase().includes(q) ||
        m.tail.toUpperCase().includes(q) ||
        m.rawText.toUpperCase().includes(q)
      );
    });
  }, [acarsMessages, acarsFilter, searchQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Airport Surface ADS-B Taxiing Feed */}
      <Card className="lg:col-span-7 flex flex-col">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-base">Airport Surface ADS-B Feed</CardTitle>
            <CardDescription>
              Live ground transponders over OpenStreetMap runways and taxiways
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedIcao}
              onChange={(e) => setSelectedIcao(e.target.value)}
              aria-label="Select airport for ground taxi feed"
              className="h-8 rounded-md bg-background border border-input px-3 text-xs font-mono font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {AIRPORT_CATALOG.map((ap) => (
                <option key={ap.icao} value={ap.icao}>
                  {ap.icao} ({ap.iata}) — {ap.city}
                </option>
              ))}
            </select>
            <Button variant="outline" size="default" onClick={() => fetchAirportTaxi(selectedIcao)}>
              <RefreshCw className={`w-3.5 h-3.5 ${taxiLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4 border-y border-border py-2.5 text-xs font-mono tabular-nums text-muted-foreground">
            <span>
              Ground <strong className="text-foreground ml-1">{groundTraffic.length}</strong>
            </span>
            <Separator orientation="vertical" className="h-3.5" />
            <span>
              Approach/Dep <strong className="text-foreground ml-1">{nearbyAirborne.length}</strong>
            </span>
            <Separator orientation="vertical" className="h-3.5" />
            <span>
              Runways <strong className="text-foreground ml-1">{airportSpec.runways.map((r) => r.ident).join(', ')}</strong>
            </span>
            {airportWx && (
              <>
                <Separator orientation="vertical" className="h-3.5" />
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant="secondary">{airportWx.flightCategory}</Badge>
                  {airportWx.windDirDeg ?? 'VRB'}°/{airportWx.windSpeedKts}kt
                </span>
              </>
            )}
          </div>

          <div className="h-[340px] rounded-md overflow-hidden border border-border">
            <div ref={taxiMapDivRef} className="w-full h-full" />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Callsign</TableHead>
                <TableHead>Type / Reg</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">GS</TableHead>
                <TableHead className="text-right">Hdg</TableHead>
                <TableHead className="text-right">Inspect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groundTraffic.length === 0 && nearbyAirborne.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {taxiLoading
                      ? `Polling live surface receivers around ${selectedIcao}`
                      : `No live ground transponders currently broadcasting at ${selectedIcao}`}
                  </TableCell>
                </TableRow>
              ) : (
                [...groundTraffic, ...nearbyAirborne].slice(0, 12).map((f) => {
                  const liv = resolveAirlineLivery(f.airlineIcao, f.callsign);
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono font-semibold text-foreground">
                        {f.callsign}
                        <span className="ml-2 font-sans font-normal text-muted-foreground">{liv.name}</span>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {f.aircraftType} {f.registration ? `· ${f.registration}` : ''}
                      </TableCell>
                      <TableCell className="font-mono text-foreground">
                        {f.onGround ? (f.groundSpeedKts > 4 ? 'TAXIING' : 'STAND') : `APP ${f.altitudeFt} ft`}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-right text-foreground">
                        {f.groundSpeedKts} kt
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-right text-foreground">
                        {String(Math.round(f.trueTrackDeg)).padStart(3, '0')}°
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="link" size="sm" onClick={() => onInspectFlight(f)}>
                          <Plane className="w-3.5 h-3.5" />
                          3D Deck
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Right: Live ACARS & VDL2 Datalink Feed */}
      <Card className="lg:col-span-5 flex flex-col">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-base">Live ACARS Datalink</CardTitle>
            <CardDescription>{acarsStatus}</CardDescription>
          </div>
          <Button variant="outline" size="default" onClick={onRefreshAcars}>
            <Radio className="w-3.5 h-3.5" />
            Poll ACARS
          </Button>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 flex-1">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter callsign, tail, message"
                className="pl-8"
              />
            </div>

            <TabsList className="w-full justify-start overflow-x-auto">
              {(['ALL', 'OOOI', 'POS', 'WX', 'ATC', 'MAINT'] as const).map((cat) => (
                <TabsTrigger key={cat} active={acarsFilter === cat} onClick={() => setAcarsFilter(cat)}>
                  {cat}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 max-h-[600px] overflow-y-auto divide-y divide-border">
            {filteredAcars.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No ACARS messages matched the active filter
              </div>
            ) : (
              filteredAcars.map((msg) => (
                <div key={msg.id} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-mono font-semibold">
                      <span className="text-primary">{msg.callsign}</span>
                      {msg.tail && <span className="text-muted-foreground">{msg.tail}</span>}
                      <Badge variant="warning">{msg.labelName}</Badge>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {new Date(msg.epochMs).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{msg.decodedSummary}</p>
                  <pre className="mt-1.5 rounded-md bg-secondary border border-border px-2.5 py-1.5 font-mono text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap">
                    {msg.rawText}
                  </pre>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
