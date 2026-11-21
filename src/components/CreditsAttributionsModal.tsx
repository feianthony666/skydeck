import {ExternalLink, Scale, X} from 'lucide-react';
import React from 'react';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './ui/card';
import {Separator} from './ui/separator';

interface CreditsAttributionsModalProps {
  open: boolean;
  onClose: () => void;
}

const ATTRIBUTION_ITEMS = [
  {
    name: 'FlightGear Project',
    badge: 'GPLv2',
    desc: '3D aircraft exterior and cockpit modeling conventions, aerodynamic silhouettes, and open-source flight simulation standards.',
    href: 'https://www.flightgear.org/',
  },
  {
    name: 'Flightradar24 / AirNav Radar / amvlab',
    badge: 'UI & Visual Inspiration',
    desc: 'Radar symbology, operator badge framing, and high-visibility golden-yellow & live-livery 3D aircraft rendering styles.',
    href: 'https://www.airnavradar.com/',
  },
  {
    name: 'OpenSky Network, adsb.lol & adsb.fi',
    badge: 'Live ADS-B Feeds',
    desc: 'Real-time ADS-B state vectors, ICAO24 hex registries, LADD/Military/PIA metadata, and emergency squawk alerts.',
    href: 'https://opensky-network.org/',
  },
  {
    name: 'ViewfinderPanoramas (Jonathan de Ferranti)',
    badge: 'SRTM3 DEM',
    desc: '3D terrain relief elevation grids powering continuous topographic shading underneath global airfields and flight paths.',
    href: 'http://www.viewfinderpanoramas.org/',
  },
  {
    name: 'Open-Meteo, NOAA AWC, RainViewer & LiveATC',
    badge: 'WX & ATC Audio',
    desc: 'Upper-air winds aloft, global cloud/precipitation tiles, SIGMET/AIRMET/PIREP hazards, volcanic alerts, and live ATC tower audio.',
    href: 'https://www.liveatc.net/',
  },
  {
    name: 'MapTiler, OpenStreetMap, Overpass & Cesium Ion',
    badge: 'Cartography & Airfields',
    desc: 'MapTiler Dataviz Light/Dark vector tiles, runway/taxiway/apron surfaces, hold-short markings, and optional 3D terminal/city buildings.',
    href: 'https://www.maptiler.com/copyright/',
  },
] as const;

export const CreditsAttributionsModal: React.FC<CreditsAttributionsModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Credits, data sources, and legal attributions"
      className="fixed inset-0 z-[750] bg-black/65 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <Card
        className="w-[min(640px,100%)] max-h-[86dvh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2 min-w-0">
            <Scale className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Credits &amp; Data Attributions</CardTitle>
              <CardDescription className="text-xs">
                Open aviation data sources, 3D model inspirations, and trademark notices
              </CardDescription>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close credits modal"
            className="h-8 w-8 shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="p-4 overflow-y-auto overscroll-contain space-y-3 [scrollbar-width:thin]">
          <div className="space-y-2">
            {ATTRIBUTION_ITEMS.map((item) => (
              <div
                key={item.name}
                className="rounded-xl border border-border bg-background/70 p-3 space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{item.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {item.badge}
                  </Badge>
                </div>
                <p className="text-[11.5px] text-muted-foreground leading-relaxed">{item.desc}</p>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Source Reference
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>

          <Separator />

          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
            <div className="text-xs font-semibold text-foreground">
              Airline Trademark &amp; Operational Disclaimer
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              All airline names, ICAO/IATA designators, aircraft tail registrations, operator badges, and
              3D/2D livery schemes remain the trademarks and property of their respective carriers and
              airframe owners. SkyDeck is an independent aviation radar enthusiast and educational
              visualization tool not affiliated with or endorsed by any airline, ATC authority, or
              commercial tracker. Do not use for real-world navigation or separation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
