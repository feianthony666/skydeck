import {
  Activity,
  ArrowLeft,
  Clock,
  ExternalLink,
  History,
  Plane,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import React, {useEffect, useMemo, useState} from 'react';
import {apiFetchJson} from '../services/directAviationClient';
import type {
  FlightDetail,
  LiveFlight,
  PastFlightRecord,
  SafetyRecordResponse,
  TrailPoint,
} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Input} from './ui/input';

interface FlightHistoryViewProps {
  liveFlights: LiveFlight[];
  selectedFlight: LiveFlight | null;
  initialQuery?: string;
  onBackToRadar: () => void;
  onInspectLiveFlight: (flight: LiveFlight) => void;
  onFlyToPoint?: (lat: number, lon: number, zoom?: number) => void;
}

function formatSectorClock(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatSectorDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(depTs?: number, arrTs?: number): string {
  if (!depTs || !arrTs || arrTs <= depTs) return '—';
  const mins = Math.round((arrTs - depTs) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function altColorCss(altFt: number): string {
  if (altFt >= 40000) return '#BE185D';
  if (altFt >= 30000) return '#7C5CBF';
  if (altFt >= 20000) return '#2563EB';
  if (altFt >= 10000) return '#22C55E';
  return '#FACC15';
}

export const FlightHistoryView: React.FC<FlightHistoryViewProps> = ({
  liveFlights,
  selectedFlight,
  initialQuery = '',
  onBackToRadar,
  onInspectLiveFlight,
  onFlyToPoint,
}) => {
  const [query, setQuery] = useState(
    () => initialQuery || selectedFlight?.flightNumber || selectedFlight?.callsign || selectedFlight?.registration || '',
  );
  const [loading, setLoading] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [records, setRecords] = useState<PastFlightRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<PastFlightRecord | null>(null);

  const [playbackTrail, setPlaybackTrail] = useState<TrailPoint[]>([]);
  const [playbackSource, setPlaybackSource] = useState<string>('');
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const [detailMeta, setDetailMeta] = useState<FlightDetail | null>(null);
  const [safetyData, setSafetyData] = useState<SafetyRecordResponse | null>(null);
  const [safetyLoading, setSafetyLoading] = useState(false);

  const quickFlights = useMemo(() => {
    const list: LiveFlight[] = [];
    const seen = new Set<string>();
    if (selectedFlight) {
      list.push(selectedFlight);
      seen.add(selectedFlight.id);
    }
    for (const f of liveFlights) {
      if (list.length >= 6) break;
      if (seen.has(f.id) || f.onGround || !(f.flightNumber || f.callsign)) continue;
      seen.add(f.id);
      list.push(f);
    }
    return list;
  }, [liveFlights, selectedFlight]);

  const runSearch = async (override?: string, icao24Hint?: string) => {
    const clean = (override ?? query).trim().toUpperCase();
    if (!clean && !icao24Hint) return;
    setLoading(true);
    setSearchedQuery(clean || icao24Hint || '');
    try {
      const qs = new URLSearchParams();
      if (clean) qs.set('query', clean);
      if (icao24Hint) qs.set('icao24', icao24Hint);
      const data = await apiFetchJson<{items?: PastFlightRecord[]}>(`/api/past-flights?${qs.toString()}`);
      const items = Array.isArray(data.items) ? data.items : [];
      setRecords(items);
      setSelectedRecord(items[0] ?? null);
    } catch {
      setRecords([]);
      setSelectedRecord(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const seed =
      initialQuery || selectedFlight?.flightNumber || selectedFlight?.callsign || selectedFlight?.registration;
    if (seed && !searchedQuery) {
      setQuery(seed);
      void runSearch(seed, selectedFlight?.icao24);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRecord) {
      setPlaybackTrail([]);
      setPlaybackSource('');
      setDetailMeta(null);
      setSafetyData(null);
      return;
    }

    let cancelled = false;
    setPlaybackLoading(true);
    setHoverIdx(null);

    const matchLive = liveFlights.find(
      (f) =>
        (selectedRecord.registration &&
          f.registration &&
          f.registration.toUpperCase() === selectedRecord.registration.toUpperCase()) ||
        (selectedRecord.callsign &&
          f.callsign &&
          f.callsign.toUpperCase() === selectedRecord.callsign.toUpperCase()),
    );

    const pbQs = new URLSearchParams({
      flightId: selectedRecord.id,
    });
    if (matchLive?.icao24) pbQs.set('icao24', matchLive.icao24);
    if (selectedRecord.actualDep || selectedRecord.scheduledDep) {
      pbQs.set('time', String(selectedRecord.actualDep || selectedRecord.scheduledDep));
    }

    apiFetchJson<{trail?: TrailPoint[]; source?: string}>(`/api/flight-playback?${pbQs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const pts = Array.isArray(res.trail) ? res.trail : [];
        if (pts.length > 0) {
          setPlaybackTrail(pts);
          setPlaybackSource(res.source || 'recorded');
        } else if (matchLive?.trail && matchLive.trail.length >= 2) {
          setPlaybackTrail(matchLive.trail);
          setPlaybackSource('live-session-trail');
        } else {
          setPlaybackTrail([]);
          setPlaybackSource(res.source || 'unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlaybackTrail(matchLive?.trail ?? []);
          setPlaybackSource(matchLive?.trail?.length ? 'live-session-trail' : 'unavailable');
        }
      })
      .finally(() => {
        if (!cancelled) setPlaybackLoading(false);
      });

    const detailQs = new URLSearchParams({
      fr24Id: selectedRecord.id.startsWith('os-') || selectedRecord.id.startsWith('live-') ? '' : selectedRecord.id,
      icao24: matchLive?.icao24 ?? '',
      callsign: selectedRecord.callsign || selectedRecord.flightNumber,
      reg: selectedRecord.registration ?? '',
      fnum: selectedRecord.flightNumber ?? '',
      orig: selectedRecord.originIata || selectedRecord.originIcao || '',
    });
    apiFetchJson<FlightDetail>(`/api/flight-detail?${detailQs.toString()}`)
      .then((d) => {
        if (!cancelled) setDetailMeta(d);
      })
      .catch(() => {
        if (!cancelled) setDetailMeta(null);
      });

    const reg = (selectedRecord.registration || matchLive?.registration || '').trim().toUpperCase();
    if (reg) {
      setSafetyLoading(true);
      apiFetchJson<SafetyRecordResponse>(`/api/safety-record?registration=${encodeURIComponent(reg)}`)
        .then((res) => {
          if (!cancelled) setSafetyData(res);
        })
        .catch(() => {
          if (!cancelled) setSafetyData(null);
        })
        .finally(() => {
          if (!cancelled) setSafetyLoading(false);
        });
    } else {
      setSafetyData(null);
    }

    return () => {
      cancelled = true;
    };
  }, [selectedRecord, liveFlights]);

  const profileGeom = useMemo(() => {
    if (playbackTrail.length < 2) return null;
    const W = 440;
    const H = 148;
    const PAD_L = 10;
    const PAD_R = 10;
    const PAD_T = 14;
    const PAD_B = 18;
    const pw = W - PAD_L - PAD_R;
    const ph = H - PAD_T - PAD_B;
    const maxAlt = Math.max(4000, ...playbackTrail.map((p) => p.altFt));
    const maxSpd = Math.max(250, ...playbackTrail.map((p) => p.speedKts));
    const xFor = (i: number) => PAD_L + (i / (playbackTrail.length - 1)) * pw;
    const yAlt = (alt: number) => PAD_T + ph - (Math.max(0, alt) / maxAlt) * ph;
    const ySpd = (spd: number) => PAD_T + ph - (Math.max(0, spd) / maxSpd) * ph;

    const altPts = playbackTrail.map((p, i) => `${xFor(i).toFixed(1)},${yAlt(p.altFt).toFixed(1)}`).join(' ');
    const spdPts = playbackTrail.map((p, i) => `${xFor(i).toFixed(1)},${ySpd(p.speedKts).toFixed(1)}`).join(' ');
    const altArea = `${PAD_L},${PAD_T + ph} ${altPts} ${(PAD_L + pw).toFixed(1)},${PAD_T + ph}`;

    return {W, H, PAD_L, PAD_T, pw, ph, maxAlt, maxSpd, xFor, yAlt, ySpd, altPts, spdPts, altArea};
  }, [playbackTrail]);

  const mapPreviewGeom = useMemo(() => {
    if (playbackTrail.length < 2) return null;
    const W = 440;
    const H = 132;
    const PAD = 18;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of playbackTrail) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const midLat = ((minLat + maxLat) * 0.5 * Math.PI) / 180;
    const cosLat = Math.max(0.2, Math.cos(midLat));
    const spanX = Math.max(0.05, (maxLon - minLon) * cosLat);
    const spanY = Math.max(0.05, maxLat - minLat);
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const offX = (W - spanX * scale) * 0.5;
    const offY = (H - spanY * scale) * 0.5;
    const proj = (lat: number, lon: number) => ({
      x: offX + (lon - minLon) * cosLat * scale,
      y: offY + (maxLat - lat) * scale,
    });
    const segs: Array<{x1: number; y1: number; x2: number; y2: number; color: string}> = [];
    for (let i = 0; i < playbackTrail.length - 1; i++) {
      const a = proj(playbackTrail[i].lat, playbackTrail[i].lon);
      const b = proj(playbackTrail[i + 1].lat, playbackTrail[i + 1].lon);
      segs.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: altColorCss((playbackTrail[i].altFt + playbackTrail[i + 1].altFt) * 0.5),
      });
    }
    const startPt = proj(playbackTrail[0].lat, playbackTrail[0].lon);
    const endPt = proj(
      playbackTrail[playbackTrail.length - 1].lat,
      playbackTrail[playbackTrail.length - 1].lon,
    );
    return {W, H, segs, startPt, endPt};
  }, [playbackTrail]);

  const activeHoverPt =
    hoverIdx !== null && playbackTrail[hoverIdx] ? playbackTrail[hoverIdx] : playbackTrail[playbackTrail.length - 1] ?? null;

  const matchingLiveFlight = useMemo(() => {
    if (!selectedRecord) return null;
    return (
      liveFlights.find(
        (f) =>
          (selectedRecord.registration &&
            f.registration &&
            f.registration.toUpperCase() === selectedRecord.registration.toUpperCase()) ||
          (selectedRecord.callsign &&
            f.callsign &&
            f.callsign.toUpperCase() === selectedRecord.callsign.toUpperCase()),
      ) ?? null
    );
  }, [liveFlights, selectedRecord]);

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-6">
      {/* Sub-Domain Header & Search Bar (FlightAware / FR24 Inspired) */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-primary shrink-0" />
              <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-foreground">
                Flight History &amp; Track Logs
              </h1>
              <span className="font-mono text-[11px] text-muted-foreground border border-border rounded-md px-2 py-0.5">
                history.skydeck
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sector logs, actual block/off-chock times, altitude-speed playback curves, and registration safety records.
            </p>
          </div>

          <Button size="sm" variant="outline" onClick={onBackToRadar} className="whitespace-nowrap">
            <ArrowLeft className="w-3.5 h-3.5" />
            Live Radar
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search flight number (UA857, CA981), callsign (UAL857), or registration (B-1356)…"
              aria-label="Search flight history by flight number or tail registration"
              className="h-10 pl-9 font-mono text-xs sm:text-sm"
            />
          </div>
          <Button type="submit" disabled={loading} className="h-10 px-4 whitespace-nowrap">
            {loading ? 'Querying Logs…' : 'Search History'}
          </Button>
        </form>

        {quickFlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground font-medium mr-1">Active sector quick lookup:</span>
            {quickFlights.map((f) => {
              const label = f.flightNumber || f.callsign || f.registration || f.icao24;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    const q = f.registration || f.flightNumber || f.callsign;
                    setQuery(q);
                    void runSearch(q, f.icao24);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 hover:bg-accent px-2 py-1 font-mono font-semibold text-foreground cursor-pointer whitespace-nowrap"
                >
                  <span>{label}</span>
                  {f.origin && f.destination && (
                    <span className="text-muted-foreground">
                      {f.origin}→{f.destination}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Split Workspace: Activity Log Table (Left) + Playback & Airframe Dossier (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: FlightAware-style Sector Activity Log */}
        <div className="lg:col-span-7 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <span>
                {searchedQuery ? `Sector Activity · ${searchedQuery}` : 'Recent Sector Activity'}
              </span>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {records.length} {records.length === 1 ? 'sector' : 'sectors'}
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Fetching Flightradar24 &amp; OpenSky historical sector logs…
            </div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Plane className="w-6 h-6 text-muted-foreground mx-auto opacity-60" />
              <div className="text-xs font-medium text-foreground">
                {searchedQuery
                  ? `No recorded sectors returned for "${searchedQuery}"`
                  : 'Enter a flight number, callsign, or aircraft tail registration above'}
              </div>
              <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                Examples: UA857, BAW117, CA981, or click any active aircraft above to inspect its recent flights and altitude/speed playback track.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Flight</th>
                    <th className="py-2.5 px-3">Route</th>
                    <th className="py-2.5 px-3">Dep</th>
                    <th className="py-2.5 px-3">Arr</th>
                    <th className="py-2.5 px-3">Dur</th>
                    <th className="py-2.5 px-3">Aircraft</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {records.map((rec) => {
                    const active = selectedRecord?.id === rec.id;
                    const depTs = rec.actualDep || rec.scheduledDep;
                    const arrTs = rec.actualArr || rec.scheduledArr;
                    return (
                      <tr
                        key={rec.id}
                        onClick={() => setSelectedRecord(rec)}
                        className={`cursor-pointer transition-colors ${
                          active ? 'bg-primary/12' : 'hover:bg-accent/50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatSectorDate(depTs)}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-foreground whitespace-nowrap">
                          {rec.flightNumber || rec.callsign}
                        </td>
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                          <span className="font-semibold text-foreground">
                            {rec.originIata || rec.originIcao || '—'}
                          </span>
                          <span className="text-muted-foreground mx-1">→</span>
                          <span className="font-semibold text-foreground">
                            {rec.destinationIata || rec.destinationIcao || '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-foreground whitespace-nowrap tabular-nums">
                          {formatSectorClock(depTs)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-foreground whitespace-nowrap tabular-nums">
                          {formatSectorClock(arrTs)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDuration(depTs, arrTs)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                          <span className="text-foreground">{rec.aircraftCode || '—'}</span>
                          {rec.registration && (
                            <span className="text-muted-foreground ml-1">{rec.registration}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <Badge
                            variant={
                              /cancel/i.test(rec.statusText)
                                ? 'destructive'
                                : /delay|divert/i.test(rec.statusText)
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {rec.statusText || 'Completed'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Track Playback, Ground Track Map & Airframe Specs */}
        <div className="lg:col-span-5 space-y-4">
          {selectedRecord ? (
            <>
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-base font-bold text-primary">
                        {selectedRecord.flightNumber || selectedRecord.callsign}
                      </span>
                      {selectedRecord.registration && (
                        <Badge variant="outline">{selectedRecord.registration}</Badge>
                      )}
                      {selectedRecord.aircraftCode && (
                        <span className="text-xs text-muted-foreground">{selectedRecord.aircraftCode}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedRecord.originName || selectedRecord.originIcao || selectedRecord.originIata || 'Origin'} →{' '}
                      {selectedRecord.destinationName ||
                        selectedRecord.destinationIcao ||
                        selectedRecord.destinationIata ||
                        'Destination'}
                    </div>
                  </div>

                  {matchingLiveFlight && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onInspectLiveFlight(matchingLiveFlight)}
                      className="whitespace-nowrap"
                    >
                      <Route className="w-3.5 h-3.5" />
                      Track Live
                    </Button>
                  )}
                </div>

                {/* Airframe Photo (Planespotters.net) */}
                {detailMeta?.photo?.url && (
                  <a
                    href={detailMeta.photo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-border overflow-hidden bg-secondary/40 group"
                  >
                    <img
                      src={detailMeta.photo.url}
                      alt={`${selectedRecord.aircraftCode} ${selectedRecord.registration}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-36 object-cover group-hover:scale-[1.01] transition-transform"
                    />
                    <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground flex items-center justify-between">
                      <span>Photo: {detailMeta.photo.photographer}</span>
                      <span className="inline-flex items-center gap-1 text-primary">
                        Planespotters.net <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </a>
                )}

                {/* Timing & Airframe Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                  <div className="rounded-xl border border-border bg-secondary/35 p-2.5">
                    <div className="text-[10px] font-sans text-muted-foreground">Departure</div>
                    <div className="font-bold text-foreground">
                      {formatSectorClock(selectedRecord.actualDep || selectedRecord.scheduledDep)}
                    </div>
                    {selectedRecord.scheduledDep && selectedRecord.actualDep && (
                      <div className="text-[10px] text-muted-foreground">
                        Sched {formatSectorClock(selectedRecord.scheduledDep)}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/35 p-2.5">
                    <div className="text-[10px] font-sans text-muted-foreground">Arrival</div>
                    <div className="font-bold text-foreground">
                      {formatSectorClock(selectedRecord.actualArr || selectedRecord.scheduledArr)}
                    </div>
                    {selectedRecord.scheduledArr && selectedRecord.actualArr && (
                      <div className="text-[10px] text-muted-foreground">
                        Sched {formatSectorClock(selectedRecord.scheduledArr)}
                      </div>
                    )}
                  </div>
                </div>

                {(detailMeta?.aircraftModel || detailMeta?.aircraftAge || detailMeta?.serialNumber) && (
                  <div className="rounded-xl border border-border bg-secondary/25 p-2.5 text-[11px] flex flex-wrap gap-x-4 gap-y-1">
                    {detailMeta.aircraftModel && (
                      <span>
                        <span className="text-muted-foreground">Type:</span>{' '}
                        <span className="font-medium text-foreground">{detailMeta.aircraftModel}</span>
                      </span>
                    )}
                    {detailMeta.aircraftAge && (
                      <span>
                        <span className="text-muted-foreground">Age:</span>{' '}
                        <span className="font-mono text-foreground">{detailMeta.aircraftAge}</span>
                      </span>
                    )}
                    {detailMeta.serialNumber && (
                      <span>
                        <span className="text-muted-foreground">MSN:</span>{' '}
                        <span className="font-mono text-foreground">{detailMeta.serialNumber}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Interactive Track Altitude + Ground Speed Profile */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                    <span>Flight Track Telemetry &amp; Playback</span>
                  </div>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {playbackTrail.length > 0 ? `${playbackTrail.length} pts · ${playbackSource}` : playbackSource}
                  </span>
                </div>

                {playbackLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Downloading telemetry track points…
                  </div>
                ) : profileGeom && mapPreviewGeom ? (
                  <>
                    {/* Mini 2D Altitude-Colored Ground Track */}
                    <div className="rounded-xl border border-border bg-[#141923] p-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>GROUND TRACK · ALTITUDE GRADIENT</span>
                        {onFlyToPoint && playbackTrail[0] && (
                          <button
                            type="button"
                            onClick={() => {
                              const mid = playbackTrail[Math.floor(playbackTrail.length * 0.5)];
                              onFlyToPoint(mid.lat, mid.lon, 5.5);
                              onBackToRadar();
                            }}
                            className="text-sky-400 hover:underline cursor-pointer"
                          >
                            Center on Radar
                          </button>
                        )}
                      </div>
                      <svg viewBox={`0 0 ${mapPreviewGeom.W} ${mapPreviewGeom.H}`} className="w-full h-[126px] block">
                        <rect width={mapPreviewGeom.W} height={mapPreviewGeom.H} fill="#141923" />
                        {mapPreviewGeom.segs.map((s, idx) => (
                          <line
                            key={idx}
                            x1={s.x1}
                            y1={s.y1}
                            x2={s.x2}
                            y2={s.y2}
                            stroke={s.color}
                            strokeWidth="2.4"
                            strokeLinecap="round"
                          />
                        ))}
                        <circle cx={mapPreviewGeom.startPt.x} cy={mapPreviewGeom.startPt.y} r="4" fill="#22C55E" />
                        <circle cx={mapPreviewGeom.endPt.x} cy={mapPreviewGeom.endPt.y} r="4" fill="#FACC15" />
                      </svg>
                    </div>

                    {/* Interactive Altitude & Ground Speed Hover Chart */}
                    <div className="rounded-xl border border-border bg-[#141923] p-2 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono tabular-nums">
                        <span className="text-sky-300">
                          ALT {activeHoverPt ? `${activeHoverPt.altFt.toLocaleString()} ft` : '—'}
                        </span>
                        <span className="text-amber-300">
                          GS {activeHoverPt ? `${Math.round(activeHoverPt.speedKts)} kt` : '—'}
                        </span>
                        <span className="text-slate-300">
                          HDG {activeHoverPt ? `${String(Math.round(activeHoverPt.trackDeg)).padStart(3, '0')}°` : '—'}
                        </span>
                        <span className="text-slate-400">
                          {activeHoverPt?.ts ? formatSectorClock(activeHoverPt.ts) : '—'}
                        </span>
                      </div>

                      <svg
                        viewBox={`0 0 ${profileGeom.W} ${profileGeom.H}`}
                        className="w-full h-[140px] block cursor-crosshair"
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * profileGeom.W;
                          const norm = Math.max(
                            0,
                            Math.min(1, (relX - profileGeom.PAD_L) / Math.max(1, profileGeom.pw)),
                          );
                          setHoverIdx(Math.round(norm * (playbackTrail.length - 1)));
                        }}
                        onMouseLeave={() => setHoverIdx(null)}
                      >
                        <rect width={profileGeom.W} height={profileGeom.H} fill="#141923" />
                        <polygon points={profileGeom.altArea} fill="rgba(56, 189, 248, 0.16)" />
                        <polyline
                          points={profileGeom.altPts}
                          fill="none"
                          stroke="#38BDF8"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <polyline
                          points={profileGeom.spdPts}
                          fill="none"
                          stroke="#F59E0B"
                          strokeWidth="1.6"
                          strokeDasharray="4 2"
                          strokeLinejoin="round"
                        />
                        {hoverIdx !== null && playbackTrail[hoverIdx] && (
                          <g>
                            <line
                              x1={profileGeom.xFor(hoverIdx)}
                              y1={profileGeom.PAD_T}
                              x2={profileGeom.xFor(hoverIdx)}
                              y2={profileGeom.PAD_T + profileGeom.ph}
                              stroke="rgba(248, 250, 252, 0.55)"
                              strokeDasharray="2 2"
                            />
                            <circle
                              cx={profileGeom.xFor(hoverIdx)}
                              cy={profileGeom.yAlt(playbackTrail[hoverIdx].altFt)}
                              r="3.5"
                              fill="#38BDF8"
                            />
                            <circle
                              cx={profileGeom.xFor(hoverIdx)}
                              cy={profileGeom.ySpd(playbackTrail[hoverIdx].speedKts)}
                              r="3.2"
                              fill="#F59E0B"
                            />
                          </g>
                        )}
                      </svg>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center text-xs text-muted-foreground">
                    Historical 4D track points are not archived for this sector ({selectedRecord.source}). Live radar paths remain active for current flights.
                  </div>
                )}
              </div>

              {/* Aviation Safety Network Airframe Summary */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
                    {safetyData && safetyData.items.length > 0 ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    ASN Airframe Safety Record
                  </span>
                  {safetyData?.searchUrl && (
                    <a
                      href={safetyData.searchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Open ASN <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {!selectedRecord.registration ? (
                  <div className="text-xs text-muted-foreground">
                    Registration not assigned to this sector log.
                  </div>
                ) : safetyLoading ? (
                  <div className="text-xs text-muted-foreground">
                    Checking Aviation Safety Network for {selectedRecord.registration}…
                  </div>
                ) : safetyData && safetyData.items.length > 0 ? (
                  <div className="space-y-1.5">
                    {safetyData.items.slice(0, 4).map((ev, idx) => (
                      <a
                        key={`${ev.date}-${idx}`}
                        href={ev.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-xl border border-border bg-secondary/30 hover:bg-accent/50 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 font-mono">
                          <span className="font-bold text-foreground">{ev.date}</span>
                          <Badge variant={ev.damage ? 'warning' : 'outline'}>
                            {ev.damage || 'Recorded'}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {ev.type} · {ev.location}
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {safetyData?.note || `No recorded ASN occurrences found for ${selectedRecord.registration}.`}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
              Select any flight sector from the history table to view its ground track, altitude/speed playback profile, and airframe dossier.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
