# SkyDeck — Live ADS-B Radar, ACARS & 3D Flight Deck

SkyDeck is an offline-capable aviation tracking and dispatch progressive web application combining direct live web radar feeds (Flightradar24 web feed + AirNav/VariFlight web adapters + OpenSky/adsb.lol/adsb.fi), East Asia / Chinese corridor telemetry, real-time ACARS messaging, interactive Three.js 3D aircraft liveries, a 3D EFIS flight deck cockpit, a live airport taxiing feed, and a weather-coupled flight planner.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Per your revision, Chinese airspace and global coverage will be fetched **directly from live public web tracking feeds** through our server-side Express proxy—specifically **Flightradar24's live map web feed** (`data-cloud.flightradar24.com/zones/fcgi/feed.js` and `data-live.flightradar24.com/clickhandler/`), **AirNav Radar (`airnavradar.com`)** and **VariFlight (`variflight.com`)** public web adapters, and **adsb.lol / adsb.fi / OpenSky Network** as multi-source backups. This delivers dense live airborne and ground-taxiing flights across Mainland China (`ZBAA`, `ZSPD`, `ZGGG`, `ZUUU`, `ZGSZ`, `ZPPP`, `ZLXY`, `VHHH`) without requiring paid API keys. Note that third-party websites like AirNav and VariFlight employ anti-bot/Cloudflare protections that may intermittently block automated server fetches; when a site blocks or throttles, the aggregator transparently merges whichever live feeds succeed and displays explicit source attribution (`FR24-WEB`, `AIRNAV-WEB`, `VARIFLIGHT-WEB`, `ADSB-LOL`, `OPENSKY`, or `DR-EST` when dead-reckoned). No flights or telemetry are ever fabricated.

- **Confirmed Decision 1 (Direct Web-Feed Sourcing for China & Global)**: Fetch live bounding-box flight vectors and ground-taxi positions directly from Flightradar24's web map feed (`feed.js` with `gnd=1&air=1&adsb=1&mlat=1&satellite=1`), paired with AirNav/VariFlight web lookup adapters and `adsb.lol` / `adsb.fi` / OpenSky Network, plus NOAA AviationWeather.gov, RainViewer radar tiles, Airframes.io ACARS, and FAA NAS Status.
- **Confirmed Decision 2 (Visual Direction — "Promote All")**: Provide a unified workspace supporting both **Dark ATC Radar & EFIS Glass Cockpit** and **High-Contrast Daylight Dispatch** themes, alongside an instant **Split Tactical Map + 3D Viewport** layout mode.
- **Confirmed Decision 3 (3D Visualization — "Prioritize All")**: Deliver full Three.js support across all three modes inside a unified WebGL inspector: **Interactive 3D Cockpit** (Captain/Overhead/Pedestal/HUD cameras with live telemetry-driven PFD/ND/EICAS), **3D Exterior Aircraft Models** (multi-part procedural airframes like C919, A350, B787, B777, A320, B737 with airline liveries), and **3D Ground Taxi Feed** (live ground-state aircraft moving along airport aprons and runways).
- **Confirmed Decision 4 (Offline & Low-Connectivity)**: Implement full PWA compliance (`vite-plugin-pwa`, install prompt, offline indicator) backed by IndexedDB caching for radar snapshots, weather reports, map tiles, and flight plans, coupled with a **Dead-Reckoning Vector Estimator** for black-spot corridors.

---

## 1. Overview & Core Concept

- **What It Does**:
  - **Live Multi-Region Web Radar Map**: Tracks airborne and ground aircraft across Mainland China, East Asia, and global hubs using Flightradar24's live web feed (`feed.js`) merged with `adsb.lol`, `adsb.fi`, OpenSky, and AirNav/VariFlight web adapters—overlaid with live RainViewer precipitation radar tiles, NOAA SIGMET/AIRMET weather hazard polygons, airport METAR markers, and live aircraft flight trails (`clickhandler`).
  - **Dead-Reckoning Black-Spot Estimator**: When aircraft enter low-connectivity oceanic or mountainous regions (or when the user goes offline), projects position along great-circle heading, groundspeed, and winds aloft, displaying an explicit `DR-EST` indicator and uncertainty radius ring.
  - **Live ACARS & Airport Taxiing Feed**: Streams decoded ACARS operational messages (OOOI pushback/off/on/in, weather requests, clearances) from Airframes.io alongside a dedicated ground-movement feed filtering `on_ground` live contacts (`gnd=1` from FR24 web feed & ADS-B) across active aprons, taxiways, and runways.
  - **3D Flight Deck, Exterior Liveries & Taxi Camera**: Renders the selected aircraft in 3D with airline-accurate livery colors (Air China, China Eastern, China Southern, Hainan, Cathay Pacific, United, Delta, Lufthansa, etc.), animated gear/flaps/navigation lights, an interactive 3D ground-taxi chase view, and an inside-the-cockpit 3D glass flight deck driven directly by the aircraft's live altitude, groundspeed, vertical rate, and heading.
  - **Weather-Coupled Interactive Flight Planner**: Plans origin-to-destination routes with live METAR/TAF runway wind components (headwind/crosswind per runway), SIGMET hazard intersection checks, real-time FAA NAS / airport delay disruptions, and diversion alternate selection.

- **Target Audience**: Aviation enthusiasts, flight-sim pilots, and dispatchers seeking FlightDeck-style operational depth (ACARS, taxiing, 3D liveries, cockpit instrumentation) with dense Chinese and global live traffic.

- **Key Value**: Solves sparse Chinese ADS-B receiver coverage by querying live web tracking feeds directly via a clean server proxy while unifying 2D radar, cockpit avionics, ground-movement visibility, weather/runway planning, and offline dead-reckoning.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Initial Radar & Region Focus**: Opens directly into the **Split Tactical Radar & 3D Viewport** (defaulting to `China & East Asia` or user-selected hub). Users can switch regional focus presets (`China & East Asia`, `Beijing / ZBAA`, `Shanghai / ZSPD`, `Guangzhou / ZGGG`, `North America`, `Europe`) or pan/zoom anywhere to fetch live bounding-box traffic.
2. **Selecting an Aircraft**: Clicking any radar target fetches its live trail/origin-destination metadata (via FR24 `clickhandler` + ADS-B enrichment) and opens the uncluttered Flight Telemetry & 3D Inspector. Users toggle seamlessly between **3D Exterior Livery**, **3D Cockpit View** (PFD, ND, EICAS, real METAR cloud/visibility horizon), and **3D Ground Taxi View**, while inspecting live ACARS logs and source badges.
3. **Monitoring Ground Taxi & Disruptions**: Switching to **Taxi & ACARS** highlights active surface traffic (`on_ground = true`) at Chinese and global airports (`ZBAA`, `ZSPD`, `ZGGG`, `KJFK`, `EGLL`, `KLAX`) with runway occupancy, pushback/taxi OOOI events, and live airport delay / ground-stop advisories.
4. **Interactive Flight Planning**: In **Flight Plan**, users pick departure/arrival ICAOs, inspect real runway crosswind/headwind calculations against live METARs, review active SIGMET turbulence/icing intersections and airport disruption alerts, and save routes offline to IndexedDB.
5. **Offline & Low-Connectivity Transition**: Installing via the in-app PWA prompt or losing internet switches SkyDeck into cached mode—preserving cached map tiles, weather briefings, and flight plans while the Dead-Reckoning engine continues estimating active enroute tracks.

### Visual Identity & Theme

- **Aesthetic Direction**: Precision avionics & tactical ATC dispatch. Generous breathing room (`gap-6`, `p-6` containers), strict single-elevation hairline surfaces (never cards nested inside cards), and zero static pill enclosures—all telemetry metadata uses clean unboxed typography with `·` or `/` separators.
- **Dual-Theme Color Palette & Mood**:
  - **Dark ATC Radar & Glass Cockpit (Default)**:
    - `--background`: `#080D16` (deep radar obsidian)
    - `--surface`: `#0F1724` (matte avionics slate, 1px hairline `#1E293B`)
    - `--primary`: `#0EA5E9` (EFIS sky cyan for active selection & flight vectors)
    - `--accent`: `#F59E0B` (amber caution / dead-reckoning / crosswind alerts)
    - Semantic flight categories: `#22C55E` (VFR / Nominal), `#38BDF8` (MVFR), `#EF4444` (IFR / Ground Stop), `#D946EF` (LIFR).
  - **High-Contrast Daylight Dispatch (Toggleable via Workspace Toolbar)**:
    - `--background`: `#F4F6F9` (crisp aeronautical chart paper)
    - `--surface`: `#FFFFFF` (clean dispatch sheet, 1px hairline `#CBD5E1`)
    - `--primary`: `#0284C7` (deep chart blue)
    - `--text`: `#0F172A` (high-contrast ink).
  - Configured with `@custom-variant dark (&:where(.dark, .dark *));` in Tailwind v4 so `.dark` toggling works cleanly across every surface without contrast mismatches.
- **Typography & Hierarchy**:
  - *Display*: `Outfit` (crisp geometric headings, `text-wrap: balance`)
  - *Body & Controls*: `Plus Jakarta Sans` (clean scannability, single-line `whitespace-nowrap` tabs/buttons)
  - *Avionics & Telemetry*: `JetBrains Mono` with `tabular-nums` on all altitudes, speeds, headings, coordinates, squawks, and METAR strings.
- **Top Bar Contract & Spatial Discipline**:
  - One-row 3-zone header: `SkyDeck` wordmark (left) — 4 concise navigation links `Radar`, `3D Deck`, `Taxi & ACARS`, `Flight Plan` (center) — 1 primary action button `Install App` / `Sync Live` (right).
  - Workspace mode controls (Region selector, Theme toggle `ATC Dark / Daylight`, Split/Focus layout toggle, Weather layer switches) live cleanly in a spacious secondary **Workspace Toolbar** below the header.
  - 3D Viewport keeps all camera/livery/instrument controls in a **collapsible bottom control dock** so the 3D cockpit and aircraft remain 100% unobstructed.

### Interactive Feedback & Motion

- Smooth exponential damping (`THREE.MathUtils.damp`) on 3D camera transitions between Captain Seat, Overhead, Exterior Chase, and Runway Taxi cams.
- Micro-interactions settle within `150ms–200ms` (`cubic-bezier(0.16, 1, 0.3, 1)`); zero decorative pulsing dots, zero fake version tags, and zero bottom telemetry tickers.
- Explicit loading skeletons, clear per-provider source status indicators (e.g., showing whether FR24 web feed, AirNav/VariFlight web adapter, or ADS-B backup supplied the frame), and empty states with direct region-switch actions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Side Web-Feed Aggregator (FR24 Web Feed + AirNav/VariFlight Adapters + ADS-B Backups)**
  - *Chosen Approach*: Express backend (`server.ts`) fetches directly from Flightradar24's live web map endpoint (`data-cloud.flightradar24.com/zones/fcgi/feed.js`) and flight-detail endpoint (`data-live.flightradar24.com/clickhandler/`), attempts AirNav Radar (`airnavradar.com`) and VariFlight (`variflight.com`) public web endpoints with browser headers, and merges/falls back cleanly to `adsb.lol`, `adsb.fi`, and OpenSky Network. Short-TTL (5–8s) server caching prevents upstream IP throttling while keeping live motion smooth.
  - *Why*: Bypasses browser CORS blocks, delivers rich real-time Chinese domestic traffic (including `on_ground` taxiing planes, aircraft ICAO types, registrations, and origin/destination airport codes from FR24's web feed), and remains resilient if any individual website changes anti-bot rules.
  - *Alternatives Considered*: OpenSky-only (too sparse inside Mainland China) or paid commercial VariFlight DataWorks API (requires enterprise credentials).

- **Decision 2: Leaflet Open-Tile Radar vs. Google Maps**
  - *Chosen Approach*: Leaflet with dark Carto/OSM raster tiles + RainViewer live precipitation tile layers + custom SVG/Canvas aircraft vector markers, paired with Service Worker & IndexedDB tile caching.
  - *Why*: Enables full offline PWA tile caching, seamless live RainViewer radar frame animation, and unobstructed custom airspace/SIGMET/runway polygon overlays without requiring paid Google Maps keys.

- **Decision 3: Procedural Composite Three.js Aircraft & Cockpit Models vs. External `.glb` Assets**
  - *Chosen Approach*: Build modular procedural `THREE.Group` builders (fuselage, swept wings, winglets, turbofans, horizontal/vertical stabilizers, landing gear, and airline livery `CanvasTexture` decals) plus a full interactive 3D Flight Deck (glare shield, MCP panel, dual PFD/ND/EICAS dynamic `CanvasTexture` displays, throttle quadrant, yoke/sidestick, windshield framing with live METAR weather skybox).
  - *Why*: Guarantees zero 404 asset failures, works 100% offline in PWA mode, renders airline-specific liveries (Air China `CCA`, China Eastern `CES`, China Southern `CSN`, Hainan `CHH`, XiamenAir `CXA`, Cathay `CPA`, United, Delta, Lufthansa, etc.) dynamically for any live ICAO type/airline code, and respects software-WebGL performance guards.

- **Decision 4: Honest Dead-Reckoning Estimation for Sparse Regions**
  - *Chosen Approach*: Whenever an active flight's last live contact ages past 15 seconds (or when offline), compute deterministic great-circle dead-reckoning (`lat`, `lon` projected via true track, groundspeed, and elapsed time) and tag the track `DR-EST` with a translucent uncertainty ring.
  - *Why*: Strictly honors the "do not simulate anything" constraint while giving accurate mathematical location estimation in limited-connectivity corridors.

---

## 4. Technical Architecture & Data Strategy

### System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SkyDeck PWA Client (React)                       │
│                                                                          │
│  ┌────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  Top Bar &     │  │   IndexedDB + SW     │  │  Dead-Reckoning      │  │
│  │  Workspace Bar │  │   Offline Cache      │  │  Vector Estimator    │  │
│  └───────┬────────┘  └──────────┬───────────┘  └──────────┬───────────┘  │
│          │                      │                         │              │
│  ┌───────▼──────────────────────▼─────────────────────────▼───────────┐  │
│  │                    Unified Live Telemetry Store                    │  │
│  └───┬─────────────────┬────────────────────┬────────────────────┬────┘  │
│      │                 │                    │                    │       │
│  ┌───▼──────┐   ┌──────▼───────┐   ┌────────▼───────┐   ┌────────▼────┐  │
│  │ Live     │   │ 3D Flight    │   │ Ground Taxi &  │   │ Weather-    │  │
│  │ Radar    │   │ Deck / Plane │   │ ACARS Message  │   │ Coupled     │  │
│  │ Map      │   │ Viewport     │   │ Stream         │   │ Flight Plan │  │
│  └──────────┘   └──────────────┘   └────────────────┘   └─────────────┘  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS / JSON
┌─────────────────────────────────▼────────────────────────────────────────┐
│                     Express Backend Proxy (server.ts)                    │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Web-Feed     │  │ ACARS Feed   │  │ NOAA AWC &   │  │ Disruption   │  │
│  │ Aggregator   │  │ Airframes.io │  │ RainViewer   │  │ FAA NAS XML  │  │
│  │ FR24 Web /   │  │ & OOOI       │  │ METAR/TAF/   │  │ & Airport    │  │
│  │ AirNav /     │  │ Decoder      │  │ SIGMET/PIREP │  │ Delay Status │  │
│  │ VariFlight / │  └──────────────┘  └──────────────┘  └──────────────┘  │
│  │ adsb.lol /   │                                                        │
│  │ OpenSky      │                                                        │
│  └──────────────┘                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Aircraft State Vector (`LiveFlight`)**: `id`, `icao24`, `callsign`, `flightNumber`, `registration`, `airlineIcao`, `aircraftType` (`C919`, `A359`, `B789`, `A320`, `B738`, etc.), `lat`, `lon`, `altitudeFt`, `groundSpeedKts`, `trueTrackDeg`, `verticalRateFpm`, `onGround`, `squawk`, `origin`, `destination`, `lastContactEpoch`, `source` (`fr24-web` | `airnav-web` | `variflight-web` | `adsb.lol` | `adsb.fi` | `opensky`), `isEstimated`, `uncertaintyNm`, and fetched flight trail coordinates.
- **ACARS Message (`AcarsMessage`)**: `id`, `timestamp`, `flightNumber`, `tail`, `airline`, `label` (e.g., `OOOI`, `POS`, `WX`, `PDC`, `MAINT`), `frequencyMhz`, `rawText`, `decodedSummary`.
- **Weather & Runway State (`AirportWeather`)**: `icao`, `rawMetar`, `flightCategory` (`VFR` | `MVFR` | `IFR` | `LIFR`), `windDirDeg`, `windSpeedKts`, `windGustKts`, `visibilitySm`, `ceilingFt`, `tempC`, `altimeterHpa`, `tafRaw`, `runways` (headings, lengths, live calculated headwind/crosswind components, surface/braking condition from remarks).
- **Disruption & Hazard (`AirspaceAlert`)**: Active `SIGMET`/`AIRMET` polygons (hazard type, FL base/top, coordinates) and airport delay/ground-stop bulletins.
- **Offline Store (IndexedDB)**: Stores latest region snapshots, weather briefings, ACARS logs, and user-saved flight plans with explicit `cachedAt` timestamps so offline transitions preserve full operational context.

### Interactive Component & State Mapping

- **Region & Search Bar**: Triggers `/api/flights?bounds=...` against the Express web-feed aggregator (querying FR24 web `feed.js` + AirNav/VariFlight web adapters + `adsb.lol`/OpenSky) on region switch or map pan/zoom; filters airborne vs. ground-taxi traffic (`onGround === true`) cleanly in client state and persists snapshots to IndexedDB.
- **Flight Trail & Clickhandler Detail**: Selecting an aircraft triggers `/api/flight-detail?id=...` (pulling live route, airline, aircraft model, and historical waypoint trail from FR24 `clickhandler` + Airframes ACARS correlation).
- **Map Layer Toggles**: Controls live RainViewer radar timestamp frames (with play/pause timeline scrubber), SIGMET hazard polygons, airport METAR dots, and dead-reckoning uncertainty rings.
- **3D Viewport Mode & Camera Dock**: Switches the mounted Three.js scene seamlessly between **Cockpit 3D** (Captain, First Officer, Overhead, Pedestal, HUD views), **Exterior Livery 3D** (orbit around procedural airframe + airline livery + deployable gear/flaps), and **Ground Taxi 3D** (airport apron/runway plane with live surrounding ground traffic vectors), updating dynamic `CanvasTexture` PFD/ND/EICAS screens from the active `LiveFlight` state.
- **Flight Planner Form**: Accepts departure/arrival ICAOs, cruise altitude, and aircraft type; queries live METAR/TAF/SIGMET/disruption endpoints; computes runway crosswind limits, active weather corridor intersections, and alternate airport recommendations; saves complete briefing packages to IndexedDB for offline access.
