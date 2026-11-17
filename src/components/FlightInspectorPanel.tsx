import {Camera, DoorOpen, ExternalLink, Gauge, MapPin, Plane, Radio, X} from 'lucide-react';
import React, {useEffect, useState} from 'react';
import {resolveAirlineLivery} from '../data/aviationCatalog';
import {haversineNm} from '../services/offlineStore';
import type {AcarsMessage, FlightDetail, LiveFlight, ThreeViewMode} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardHeader, CardTitle} from './ui/card';
import {Separator} from './ui/separator';

interface FlightInspectorPanelProps {
  flight: LiveFlight;
  detail: FlightDetail | null;
  detailLoading: boolean;
  nowEpochSec: number;
  timeDisplayMode?: 'airport' | 'local' | 'utc';
  userLocation?: {lat: number; lon: number; label?: string} | null;
  matchingAcars: AcarsMessage[];
  onClose: () => void;
  onOpen3DMode: (mode: ThreeViewMode) => void;
  onSelectAirport?: (airport: {icao: string; iata: string; name: string}) => void;
}

function formatEpochTime(ts?: number, mode: 'airport' | 'local' | 'utc' = 'local'): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  if (mode === 'utc') {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
}

export const FlightInspectorPanel: React.FC<FlightInspectorPanelProps> = ({
  flight,
  detail,
  detailLoading,
  nowEpochSec,
  timeDisplayMode = 'local',
  userLocation,
  matchingAcars,
  onClose,
  onOpen3DMode,
  onSelectAirport,
}) => {
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    setPhotoError(false);
  }, [flight.id, detail?.photo?.url]);

  const livery = resolveAirlineLivery(
    detail?.airlineIcao || flight.airlineIcao,
    flight.callsign,
  );

  const registration = detail?.registration || flight.registration || '—';
  const aircraftModel = detail?.aircraftModel || flight.aircraftType || '—';
  const aircraftCode = detail?.aircraftCode || flight.aircraftType || '';
  const operatorName = detail?.registeredOwner || detail?.airlineName || livery.name;
  const originCode = detail?.originIata || flight.origin || '—';
  const destCode = detail?.destinationIata || flight.destination || '—';
  const originIcao = detail?.originIcao || '';
  const destIcao = detail?.destinationIcao || '';

  const altitudeM = Math.round(flight.altitudeFt * 0.3048);
  const flightLevel = Math.round(flight.altitudeFt / 100);
  const speedKmh = Math.round(flight.groundSpeedKts * 1.852);
  const vRateLabel =
    flight.verticalRateFpm > 120
      ? 'Climbing'
      : flight.verticalRateFpm < -120
        ? 'Descending'
        : 'Level';

  const contactAgeSec = Math.max(0, nowEpochSec - flight.lastContactEpoch);
  const distanceNm = userLocation
    ? haversineNm(userLocation.lat, userLocation.lon, flight.lat, flight.lon)
    : null;
  const trailCount = detail?.trail?.length ?? flight.trail?.length ?? 0;

  const photo = !photoError ? detail?.photo : null;
  const planespottersHexUrl = `https://www.planespotters.net/hex/${encodeURIComponent(flight.icao24)}`;

  return (
    <aside
      role="complementary"
      aria-label={`Flight details for ${flight.callsign}`}
      className="h-full"
    >
      <Card className="h-full flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-base font-semibold text-primary">
                {flight.callsign}
              </CardTitle>
              {flight.flightNumber && flight.flightNumber !== flight.callsign && (
                <span className="font-mono text-xs text-foreground">{flight.flightNumber}</span>
              )}
              <Badge variant={flight.isEstimated ? 'warning' : 'secondary'}>
                {flight.isEstimated ? `DR-EST ±${flight.uncertaintyNm} NM` : flight.source.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {operatorName} · {aircraftModel}
              {registration !== '—' ? ` · ${registration}` : ''}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close aircraft sidebar"
            className="shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto flex flex-col gap-4 pt-0">
          {/* Full-Frame Aircraft Photo (Uncropped) */}
          <div className="rounded-xl border border-border bg-[#0b1320] overflow-hidden shrink-0">
            <div className="aspect-[16/9] w-full relative flex items-center justify-center bg-[#0b1320] p-1">
              {photo?.url ? (
                <img
                  src={photo.url}
                  alt={`${registration !== '—' ? registration : flight.callsign} (${aircraftModel})`}
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoError(true)}
                  className="max-w-full max-h-full w-auto h-auto object-contain rounded"
                />
              ) : detailLoading ? (
                <div className="flex flex-col items-center gap-2 text-xs text-slate-300 px-4 text-center">
                  <Camera className="w-5 h-5" />
                  <span>Loading full-frame aircraft photo…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-xs text-slate-300 px-4 text-center">
                  <Plane className="w-6 h-6" />
                  <span className="font-medium text-white">No photo indexed for {flight.icao24}</span>
                  <a
                    href={planespottersHexUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
                  >
                    Search on Planespotters.net
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            {photo?.url && (
              <div className="px-3 py-1.5 border-t border-border bg-card flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  Photo © {photo.photographer}
                  {photo.width && photo.height ? ` · ${photo.width}×${photo.height}` : ''}
                </span>
                <a
                  href={photo.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                >
                  {photo.source === 'wikimedia' ? 'Wikimedia Full' : photo.source === 'airport-data' ? 'Airport-Data' : 'Planespotters.net'}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Route Strip */}
          <div className="flex items-center justify-between border-y border-border py-3 font-mono">
            <button
              type="button"
              disabled={!onSelectAirport || originCode === '—'}
              onClick={() =>
                originCode !== '—' &&
                onSelectAirport?.({
                  icao: originIcao || originCode,
                  iata: originCode,
                  name: detail?.originName || `${originCode} Airport`,
                })
              }
              className="min-w-0 text-left hover:opacity-80 disabled:cursor-default cursor-pointer"
              title={originCode !== '—' ? `Open ${originCode} departures & delay index` : undefined}
            >
              <div className="text-xl font-semibold text-foreground">{originCode}</div>
              <div className="text-[11px] font-sans text-muted-foreground truncate max-w-[110px]">
                {detail?.originName || 'Origin'}
              </div>
            </button>
            <div className="text-center text-[11px] text-muted-foreground px-2">
              <div className="font-medium text-foreground">
                {detailLoading
                  ? 'SYNCING'
                  : detail?.statusText || (flight.onGround ? 'SURFACE TAXI' : 'ENROUTE LIVE')}
              </div>
              <div className="text-primary tracking-tighter">─────────</div>
            </div>
            <button
              type="button"
              disabled={!onSelectAirport || destCode === '—'}
              onClick={() =>
                destCode !== '—' &&
                onSelectAirport?.({
                  icao: destIcao || destCode,
                  iata: destCode,
                  name: detail?.destinationName || `${destCode} Airport`,
                })
              }
              className="text-right min-w-0 hover:opacity-80 disabled:cursor-default cursor-pointer"
              title={destCode !== '—' ? `Open ${destCode} arrivals & delay index` : undefined}
            >
              <div className="text-xl font-semibold text-foreground">{destCode}</div>
              <div className="text-[11px] font-sans text-muted-foreground truncate max-w-[110px]">
                {detail?.destinationName || 'Destination'}
              </div>
            </button>
          </div>

          {/* Departure & Arrival Terminal, Gate & Schedule Service */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
              <DoorOpen className="w-3.5 h-3.5" />
              Departure & Arrival Service
            </h3>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-border bg-background/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">Departure</span>
                  <span className="font-mono text-[11px] font-semibold text-foreground">{originCode}</span>
                </div>
                <div className="font-mono text-xs font-semibold text-foreground">
                  {detail?.originTerminal ? `Terminal ${detail.originTerminal}` : 'Terminal —'}
                  {' · '}
                  {detail?.originGate ? `Gate ${detail.originGate}` : 'Gate —'}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
                  Sched {formatEpochTime(detail?.scheduledDep, timeDisplayMode)} · Act{' '}
                  {formatEpochTime(detail?.actualDep, timeDisplayMode)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">Arrival</span>
                  <span className="font-mono text-[11px] font-semibold text-foreground">{destCode}</span>
                </div>
                <div className="font-mono text-xs font-semibold text-foreground">
                  {detail?.destTerminal ? `Terminal ${detail.destTerminal}` : 'Terminal —'}
                  {detail?.destGate ? ` · Gate ${detail.destGate}` : ''}
                  {detail?.destBaggage ? ` · Bag ${detail.destBaggage}` : ''}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
                  Sched {formatEpochTime(detail?.scheduledArr, timeDisplayMode)} · Est{' '}
                  {formatEpochTime(detail?.estimatedArr, timeDisplayMode)}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Altitude & Flight Dynamics */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Altitude & Flight Dynamics
            </h3>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-border bg-background/60 p-2.5">
                <div className="text-[11px] text-muted-foreground">Barometric Altitude</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {flight.onGround ? 'ON GROUND' : `${flight.altitudeFt.toLocaleString()} ft`}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {flight.onGround ? '0 m' : `FL${String(flightLevel).padStart(3, '0')} · ${altitudeM.toLocaleString()} m`}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-2.5">
                <div className="text-[11px] text-muted-foreground">Vertical Speed</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {flight.verticalRateFpm >= 0 ? '+' : ''}
                  {flight.verticalRateFpm} fpm
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{vRateLabel}</div>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-2.5">
                <div className="text-[11px] text-muted-foreground">Groundspeed</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {flight.groundSpeedKts} kt
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {speedKmh} km/h
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-2.5">
                <div className="text-[11px] text-muted-foreground">True Track</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {String(Math.round(flight.trueTrackDeg)).padStart(3, '0')}°
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {flight.onGround ? 'Taxiing' : 'Airborne'}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Airplane Information */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Airplane Information
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <dt className="text-[11px] text-muted-foreground">Registration</dt>
                <dd className="mt-0.5 font-mono font-semibold text-foreground">{registration}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">ICAO24 Hex</dt>
                <dd className="mt-0.5 font-mono font-semibold text-foreground">{flight.icao24}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Manufacturer</dt>
                <dd className="mt-0.5 font-medium text-foreground truncate">
                  {detail?.manufacturer || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Model / Type</dt>
                <dd className="mt-0.5 font-medium text-foreground truncate">
                  {aircraftModel}
                  {aircraftCode && aircraftCode !== aircraftModel ? ` (${aircraftCode})` : ''}
                </dd>
              </div>
              <div className={detail?.aircraftAge ? '' : 'col-span-2'}>
                <dt className="text-[11px] text-muted-foreground">Airline / Owner</dt>
                <dd className="mt-0.5 font-medium text-foreground truncate">{operatorName}</dd>
              </div>
              {detail?.aircraftAge && (
                <div>
                  <dt className="text-[11px] text-muted-foreground">Airframe Age</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-foreground">{detail.aircraftAge} yrs</dd>
                </div>
              )}
            </dl>
          </div>

          <Separator />

          {/* Transponder, Position & Range */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Transponder & Position
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <dt className="text-[11px] text-muted-foreground">Squawk</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {detail?.squawk || flight.squawk || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Last Contact</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {contactAgeSec}s ago · {trailCount} pts
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Coordinates</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {flight.lat.toFixed(3)}, {flight.lon.toFixed(3)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  Distance from You
                </dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                  {distanceNm !== null
                    ? `${Math.round(distanceNm)} NM (${Math.round(distanceNm * 1.852)} km)`
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <Separator />

          {/* Optional 3D / Ground Views */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpen3DMode('cockpit')}>
              <Gauge className="w-3.5 h-3.5" />
              3D Cockpit
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpen3DMode('exterior')}>
              <Plane className="w-3.5 h-3.5" />
              3D Livery
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpen3DMode('taxi')}>
              <Radio className="w-3.5 h-3.5" />
              Ground Taxi
            </Button>
          </div>

          {matchingAcars.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="text-[11px] font-medium text-muted-foreground mb-2">
                  Matched ACARS ({matchingAcars.length})
                </div>
                <div className="space-y-2">
                  {matchingAcars.slice(0, 3).map((m) => (
                    <div key={m.id} className="text-[11px] font-mono text-muted-foreground">
                      <span className="text-amber-600 dark:text-amber-500 mr-1.5">[{m.labelName}]</span>
                      <span className="text-foreground">{m.rawText}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </aside>
  );
};
