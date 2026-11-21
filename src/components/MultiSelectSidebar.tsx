import {Crosshair, Layers, Plane, Trash2, X} from 'lucide-react';
import React from 'react';
import type {LiveFlight} from '../types/aviation';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardHeader, CardTitle} from './ui/card';

interface MultiSelectSidebarProps {
  flights: LiveFlight[];
  activeFlightId: string | null;
  multiSelectMode: boolean;
  onToggleMultiSelectMode: () => void;
  onFocusFlight: (flight: LiveFlight) => void;
  onRemoveFlight: (flightId: string) => void;
  onClearAll: () => void;
  isPortraitMobile?: boolean;
}

export const MultiSelectSidebar: React.FC<MultiSelectSidebarProps> = ({
  flights,
  activeFlightId,
  multiSelectMode,
  onToggleMultiSelectMode,
  onFocusFlight,
  onRemoveFlight,
  onClearAll,
  isPortraitMobile = false,
}) => {
  if (flights.length === 0) return null;

  return (
    <aside
      aria-label="Multi-selected aircraft comparison sidebar"
      className={
        isPortraitMobile
          ? 'fixed top-[60px] right-2 z-[530] w-[min(300px,calc(100vw-16px))] max-h-[38dvh] flex flex-col'
          : 'fixed top-20 right-3 z-[530] w-[min(320px,calc(100vw-24px))] max-h-[calc(100dvh-180px)] flex flex-col'
      }
    >
      <Card className="bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col min-h-0">
        <CardHeader className="px-3 py-2.5 border-b border-border/70 flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
            <CardTitle className="text-xs font-semibold tracking-tight truncate">
              Tracked ({flights.length})
            </CardTitle>
            <button
              type="button"
              onClick={onToggleMultiSelectMode}
              title="Toggle click-to-multiselect on radar"
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold border cursor-pointer ${
                multiSelectMode
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {multiSelectMode ? 'MULTI ON' : 'SHIFT/MULTI'}
            </button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearAll}
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive shrink-0"
            title="Clear all selected aircraft"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </CardHeader>

        <CardContent className="p-2 space-y-1.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {flights.map((f) => {
            const isPrimary = f.id === activeFlightId;
            const fl = Math.round(f.altitudeFt / 100);
            const vfpm = Math.round(f.verticalRateFpm || 0);
            return (
              <div
                key={f.id}
                className={`rounded-xl border p-2 transition-colors flex items-start justify-between gap-2 ${
                  isPrimary
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background/80 hover:bg-accent/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onFocusFlight(f)}
                  className="flex-1 min-w-0 text-left cursor-pointer space-y-1"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Plane className="w-3 h-3 text-primary shrink-0" />
                    <span className="font-mono text-xs font-bold text-foreground">
                      {f.callsign || f.flightNumber || f.icao24}
                    </span>
                    {f.airlineIcao && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {f.airlineIcao}
                      </span>
                    )}
                    {f.aircraftType && (
                      <Badge variant="outline" className="h-4 px-1 text-[9.5px] font-mono">
                        {f.aircraftType}
                      </Badge>
                    )}
                    <Badge
                      variant={f.isEstimated ? 'warning' : 'success'}
                      className="h-4 px-1 text-[9.5px] font-mono"
                    >
                      {f.isEstimated ? 'DR' : 'LIVE'}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground tabular-nums">
                    <span className="truncate">
                      {f.origin || '—'} → {f.destination || '—'}
                    </span>
                    {f.squawk && (
                      <span
                        className={
                          f.squawk === '7700' || f.squawk === '7600' || f.squawk === '7500'
                            ? 'text-red-500 font-bold'
                            : ''
                        }
                      >
                        SQK {f.squawk}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[10.5px] font-mono tabular-nums text-foreground">
                    <span>
                      {f.onGround ? 'GND' : f.altitudeFt >= 18000 ? `FL${fl}` : `${f.altitudeFt.toLocaleString()}ft`}
                    </span>
                    <span>{Math.round(f.groundSpeedKts)} kt</span>
                    <span
                      className={
                        vfpm > 250
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : vfpm < -250
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                      }
                    >
                      {vfpm >= 0 ? `+${vfpm}` : vfpm} fpm
                    </span>
                  </div>
                </button>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onFocusFlight(f)}
                    aria-label={`Inspect ${f.callsign || f.icao24}`}
                    title="Inspect & center"
                    className="h-6 w-6 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveFlight(f.id)}
                    aria-label={`Remove ${f.callsign || f.icao24} from selection`}
                    title="Remove"
                    className="h-6 w-6 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </aside>
  );
};
