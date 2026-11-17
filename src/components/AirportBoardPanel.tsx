import {AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock, Filter, Plane, X} from 'lucide-react';
import React, {useMemo, useState} from 'react';
import type {AirportBoardFlight, AirportBoardResponse, AirportWeather} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardHeader, CardTitle} from './ui/card';
import {Separator} from './ui/separator';
import {TabsList, TabsTrigger} from './ui/tabs';

interface AirportBoardPanelProps {
  airport: {icao: string; iata: string; name: string};
  board: AirportBoardResponse | null;
  loading: boolean;
  weather?: AirportWeather;
  timeDisplayMode: 'airport' | 'local' | 'utc';
  onTimeDisplayModeChange: (mode: 'airport' | 'local' | 'utc') => void;
  activeFilter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed';
  onFilterChange: (filter: 'none' | 'all' | 'arrivals' | 'departures' | 'delayed') => void;
  onSelectFlightFromBoard: (item: AirportBoardFlight) => void;
  onClose: () => void;
}

function formatEpochInMode(
  ts: number | undefined,
  mode: 'airport' | 'local' | 'utc',
  tzName?: string,
  utcOffsetSec?: number,
): string {
  if (!ts) return '—';
  try {
    if (mode === 'utc') {
      return new Intl.DateTimeFormat([], {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ts * 1000));
    }
    if (mode === 'airport') {
      if (tzName) {
        return new Intl.DateTimeFormat([], {
          timeZone: tzName,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ts * 1000));
      }
      if (typeof utcOffsetSec === 'number') {
        return new Intl.DateTimeFormat([], {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date((ts + utcOffsetSec) * 1000));
      }
    }
    return new Date(ts * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date(ts * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}

function formatSynchronizedStatus(
  item: AirportBoardFlight,
  tab: 'departures' | 'arrivals',
  mode: 'airport' | 'local' | 'utc',
  tzName?: string,
  utcOffsetSec?: number,
): string {
  const raw = item.statusText || '';
  if (/cancel/i.test(raw)) return 'Canceled';

  const fmt = (t?: number) => formatEpochInMode(t, mode, tzName, utcOffsetSec);

  if (/landed/i.test(raw)) {
    const t = item.actualTime || item.estimatedTime || item.scheduledTime;
    return t ? `Landed ${fmt(t)}` : raw;
  }
  if (/departed/i.test(raw)) {
    const t = item.actualTime || item.estimatedTime || item.scheduledTime;
    return t ? `Departed ${fmt(t)}` : raw;
  }
  if (/delay/i.test(raw)) {
    const t = item.estimatedTime || item.actualTime || item.scheduledTime;
    return t ? `Delayed ${fmt(t)}` : 'Delayed';
  }
  if (item.actualTime) {
    return `${tab === 'departures' ? 'Departed' : 'Arrived'} ${fmt(item.actualTime)}`;
  }
  if (item.estimatedTime) {
    return `${tab === 'departures' ? 'Est Dep' : 'Est Arr'} ${fmt(item.estimatedTime)}`;
  }
  if (item.scheduledTime && /est|sched/i.test(raw)) {
    return `Sched ${fmt(item.scheduledTime)}`;
  }
  return raw || 'Scheduled';
}

function delayBadgeVariant(index: number | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (index === null) return 'secondary';
  if (index >= 3) return 'destructive';
  if (index >= 1.5) return 'warning';
  return 'success';
}

function delayLabel(index: number | null): string {
  if (index === null) return 'N/A';
  if (index >= 3) return 'High Delays';
  if (index >= 1.5) return 'Moderate';
  return 'Normal Ops';
}

export const AirportBoardPanel: React.FC<AirportBoardPanelProps> = ({
  airport,
  board,
  loading,
  weather,
  timeDisplayMode,
  onTimeDisplayModeChange,
  activeFilter,
  onFilterChange,
  onSelectFlightFromBoard,
  onClose,
}) => {
  const [boardTab, setBoardTab] = useState<'departures' | 'arrivals'>('departures');
  const [onlyDelayedInList, setOnlyDelayedInList] = useState(false);

  const listItems = useMemo(() => {
    const raw = boardTab === 'departures' ? (board?.departures ?? []) : (board?.arrivals ?? []);
    if (!onlyDelayedInList) return raw;
    return raw.filter((item) => item.isDelayed);
  }, [board, boardTab, onlyDelayedInList]);

  const delayedTotalCount = useMemo(() => {
    const all = [...(board?.departures ?? []), ...(board?.arrivals ?? [])];
    return all.filter((f) => f.isDelayed).length;
  }, [board]);

  const delayIdx = board?.delayIndex;
  const tzAbbr =
    timeDisplayMode === 'utc'
      ? 'UTC'
      : timeDisplayMode === 'airport'
        ? board?.timezoneAbbr || 'APT'
        : 'LOCAL';

  return (
    <aside
      role="complementary"
      aria-label={`Airport arrivals, departures, and delay index for ${airport.iata || airport.icao}`}
      className="h-full"
    >
      <Card className="h-full flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-base font-semibold text-foreground">
                {airport.iata ? `${airport.iata} · ${airport.icao}` : airport.icao}
              </CardTitle>
              {weather && (
                <Badge
                  variant={
                    weather.flightCategory === 'VFR'
                      ? 'success'
                      : weather.flightCategory === 'MVFR'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {weather.flightCategory}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{board?.name || airport.name}</p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close airport board"
            className="shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto flex flex-col gap-4 pt-0">
          {/* Live Delay Index Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Dep Delay Index
                </span>
                <Badge variant={delayBadgeVariant(delayIdx?.departuresIndex ?? null)}>
                  {delayIdx?.departuresIndex !== null && delayIdx?.departuresIndex !== undefined
                    ? delayIdx.departuresIndex.toFixed(2)
                    : '—'}
                </Badge>
              </div>
              <div className="mt-1.5 font-mono text-xs font-semibold text-foreground tabular-nums">
                {delayIdx?.departuresDelayAvgMin !== null && delayIdx?.departuresDelayAvgMin !== undefined
                  ? `${delayIdx.departuresDelayAvgMin} min avg`
                  : delayLabel(delayIdx?.departuresIndex ?? null)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {delayIdx?.departuresDelayedPct !== null && delayIdx?.departuresDelayedPct !== undefined
                  ? `${delayIdx.departuresDelayedPct}% delayed · ${delayIdx.departuresDelayedCount ?? 0}/${
                      (delayIdx.departuresOnTimeCount ?? 0) + (delayIdx.departuresDelayedCount ?? 0)
                    }`
                  : 'Live ops monitor'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  Arr Delay Index
                </span>
                <Badge variant={delayBadgeVariant(delayIdx?.arrivalsIndex ?? null)}>
                  {delayIdx?.arrivalsIndex !== null && delayIdx?.arrivalsIndex !== undefined
                    ? delayIdx.arrivalsIndex.toFixed(2)
                    : '—'}
                </Badge>
              </div>
              <div className="mt-1.5 font-mono text-xs font-semibold text-foreground tabular-nums">
                {delayIdx?.arrivalsDelayAvgMin !== null && delayIdx?.arrivalsDelayAvgMin !== undefined
                  ? `${delayIdx.arrivalsDelayAvgMin} min avg`
                  : delayLabel(delayIdx?.arrivalsIndex ?? null)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {delayIdx?.arrivalsDelayedPct !== null && delayIdx?.arrivalsDelayedPct !== undefined
                  ? `${delayIdx.arrivalsDelayedPct}% delayed · ${delayIdx.arrivalsDelayedCount ?? 0}/${
                      (delayIdx.arrivalsOnTimeCount ?? 0) + (delayIdx.arrivalsDelayedCount ?? 0)
                    }`
                  : 'Live ops monitor'}
              </div>
            </div>
          </div>

          {weather && (
            <div className="rounded-xl border border-border bg-secondary/50 px-3 py-2 text-[11px] font-mono text-foreground">
              Wind {weather.windDirDeg ?? 'VRB'}° @ {weather.windSpeedKts} kt · Vis {weather.visibilitySm ?? '—'} SM · QNH{' '}
              {weather.altimeterHpa ?? '—'} hPa
            </div>
          )}

          {/* Filter Radar Traffic to this Airport */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Filter className="w-3 h-3" />
                Filter Radar Traffic
              </span>
              {activeFilter !== 'none' && (
                <Button size="sm" variant="ghost" onClick={() => onFilterChange('none')}>
                  Reset
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={activeFilter === 'none' ? 'default' : 'outline'}
                onClick={() => onFilterChange('none')}
              >
                All Sector
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'all' ? 'default' : 'outline'}
                onClick={() => onFilterChange('all')}
              >
                {airport.iata || airport.icao} All
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'departures' ? 'default' : 'outline'}
                onClick={() => onFilterChange('departures')}
              >
                Departures
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'arrivals' ? 'default' : 'outline'}
                onClick={() => onFilterChange('arrivals')}
              >
                Arrivals
              </Button>
              <Button
                size="sm"
                variant={activeFilter === 'delayed' ? 'destructive' : 'outline'}
                onClick={() => onFilterChange('delayed')}
              >
                Delayed ({delayedTotalCount})
              </Button>
            </div>
          </div>

          <Separator />

          {/* Synchronized Schedule Timezone Switcher + Board Tabs */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Times ({tzAbbr})
              </span>
              <TabsList>
                <TabsTrigger
                  active={timeDisplayMode === 'airport'}
                  onClick={() => onTimeDisplayModeChange('airport')}
                >
                  Airport
                </TabsTrigger>
                <TabsTrigger
                  active={timeDisplayMode === 'local'}
                  onClick={() => onTimeDisplayModeChange('local')}
                >
                  My Local
                </TabsTrigger>
                <TabsTrigger
                  active={timeDisplayMode === 'utc'}
                  onClick={() => onTimeDisplayModeChange('utc')}
                >
                  UTC
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger active={boardTab === 'departures'} onClick={() => setBoardTab('departures')}>
                  Departures ({board?.departures.length ?? 0})
                </TabsTrigger>
                <TabsTrigger active={boardTab === 'arrivals'} onClick={() => setBoardTab('arrivals')}>
                  Arrivals ({board?.arrivals.length ?? 0})
                </TabsTrigger>
              </TabsList>

              <Button
                size="sm"
                variant={onlyDelayedInList ? 'destructive' : 'outline'}
                onClick={() => setOnlyDelayedInList((v) => !v)}
              >
                <AlertTriangle className="w-3 h-3" />
                Delayed
              </Button>
            </div>
          </div>

          {/* Flight Board Rows (All fetched entries, >25) */}
          <div className="space-y-2">
            {loading && !board ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Fetching live arrivals, departures, and delay index…
              </div>
            ) : listItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No {onlyDelayedInList ? 'delayed ' : ''}
                {boardTab} matched right now.
              </div>
            ) : (
              listItems.map((item) => {
                const peerCode = boardTab === 'departures' ? item.destinationIata : item.originIata;
                const peerName = boardTab === 'departures' ? item.destinationName : item.originName;
                const schedClock = formatEpochInMode(
                  item.scheduledTime || item.estimatedTime || item.actualTime,
                  timeDisplayMode,
                  board?.timezoneName,
                  board?.utcOffsetSec,
                );
                const syncStatus = formatSynchronizedStatus(
                  item,
                  boardTab,
                  timeDisplayMode,
                  board?.timezoneName,
                  board?.utcOffsetSec,
                );

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectFlightFromBoard(item)}
                    className="w-full text-left rounded-xl border border-border bg-background/70 hover:bg-accent/70 p-2.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {item.flightNumber || item.callsign}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground truncate">
                          {boardTab === 'departures' ? `→ ${peerCode || '—'}` : `← ${peerCode || '—'}`}
                        </span>
                        {item.aircraftCode && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {item.aircraftCode}
                          </span>
                        )}
                      </div>
                      <Badge
                        variant={
                          item.statusColor === 'red'
                            ? 'destructive'
                            : item.statusColor === 'amber'
                              ? 'warning'
                              : item.statusColor === 'green'
                                ? 'success'
                                : 'secondary'
                        }
                      >
                        {syncStatus}
                      </Badge>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {peerName || item.airlineName || 'Scheduled service'}
                      </span>
                      <span className="font-mono tabular-nums shrink-0 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Sched {schedClock} {tzAbbr}
                      </span>
                    </div>

                    {(item.terminal || item.gate || item.baggage || item.registration) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-foreground">
                        {item.terminal && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">T{item.terminal}</span>
                        )}
                        {item.gate && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">Gate {item.gate}</span>
                        )}
                        {item.baggage && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">Bag {item.baggage}</span>
                        )}
                        {item.registration && (
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Plane className="w-2.5 h-2.5" />
                            {item.registration}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
};
