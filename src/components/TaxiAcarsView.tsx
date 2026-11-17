import L from 'leaflet';
import {Plane, Radio, RefreshCw, Search} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AIRPORT_CATALOG, resolveAirlineLivery, type AirportSpec} from '../data/aviationCatalog';
import {apiFetchJson} from '../services/directAviationClient';
import type {
  AcarsMessage,
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
    try {
      const data = await apiFetchJson<{
        groundTraffic: LiveFlight[];
        nearbyAirborne: LiveFlight[];
        segments: TaxiwaySegment[];
      }>(`/api/airport-taxi?icao=${encodeURIComponent(icao)}`);
      setGroundTraffic(data.groundTraffic ?? []);
      setNearbyAirborne(data.nearbyAirborne ?? []);
      setSegments(data.segments ?? []);
    } catch {
      // Keep cached state when offline
    } finally {
      setTaxiLoading(false);
    }
  };

  useEffect(() => {
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
      maxZoom: 18,
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

  // Verified zero-API-key real surface tiles (Esri World Imagery / Dark Gray / OSM)
  useEffect(() => {
    const map = taxiMapRef.current;
    if (!map) return;
    for (const old of taxiTileRef.current) map.removeLayer(old);
    taxiTileRef.current = [];

    const layers: L.TileLayer[] =
      theme === 'dark'
        ? [
            L.tileLayer(
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              {maxZoom: 16, attribution: 'Tiles &copy; Esri'},
            ),
            L.tileLayer(
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
              {maxZoom: 16, opacity: 0.85},
            ),
          ]
        : [
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
              maxZoom: 19,
              attribution: '&copy; OpenStreetMap',
            }),
          ];

    for (const tile of layers) {
      tile.addTo(map);
      tile.bringToBack();
    }
    if (layers.length > 1) layers[0].bringToBack();
    taxiTileRef.current = layers;
  }, [theme]);

  useEffect(() => {
    const layer = taxiGeomRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const seg of segments) {
      L.polyline(seg.coords, {
        color: seg.kind === 'runway' ? '#38BDF8' : '#F59E0B',
        weight: seg.kind === 'runway' ? 5 : 2,
        opacity: seg.kind === 'runway' ? 0.8 : 0.65,
      }).addTo(layer);
    }
  }, [segments]);

  useEffect(() => {
    const layer = taxiPlaneRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const f of [...groundTraffic, ...nearbyAirborne]) {
      const color = f.onGround ? '#22C55E' : '#38BDF8';
      const icon = L.divIcon({
        className: 'skydeck-taxi-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="transform:rotate(${Math.round(f.trueTrackDeg)}deg);width:22px;height:22px;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="${color}" stroke="#0B0E14" stroke-width="1.4">
            <path d="M12 2L14.2 9.2L21 13V15L14.2 13V18.5L17 20.5V22L12 20.8L7 22V20.5L9.8 18.5V13L3 15V13L9.8 9.2L12 2Z"/>
          </svg>
        </div>`,
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
