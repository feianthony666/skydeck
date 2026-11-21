// Runs in GitHub Actions: downloads OSM airfield geometry (runways, taxiways, aprons, terminals, stands) for every
// catalog airport once and publishes it as same-origin JSON (public/data/surface/ICAO.json).
// Existing fresh files (restored from the Actions cache) are skipped, so Overpass is only hit for missing airports.
import fs from 'node:fs';
import path from 'node:path';
import {AIRPORT_CATALOG} from '../src/data/aviationCatalog';
import {buildOverpassAirfieldQuery, GLOBAL_OVERPASS_MIRRORS, parseOverpassAirfieldElements} from '../src/utils/airfieldGeometry';
import type {OverpassElement} from '../src/utils/airfieldGeometry';

const OUT = path.resolve(import.meta.dirname, '../public/data/surface');
fs.mkdirSync(OUT, {recursive: true});
const MAX_AGE_MS = 21 * 86400000;
const BUDGET_MS = 14 * 60000; // keep the workflow short; the rest is picked up on the next run
const started = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(q: string): Promise<{elements?: OverpassElement[]} | null> {
  for (const ep of GLOBAL_OVERPASS_MIRRORS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'SkyDeck-Airfield-Bake/1.0'},
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(100000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {elements?: OverpassElement[]};
      if (Array.isArray(json.elements) && json.elements.length > 0) return json;
    } catch {
      /* try next mirror */
    }
  }
  return null;
}

let done = 0;
let failed = 0;
for (const ap of AIRPORT_CATALOG) {
  if (Date.now() - started > BUDGET_MS) break;
  const file = path.join(OUT, `${ap.icao}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < MAX_AGE_MS) continue;
  } catch {
    /* missing */
  }
  const json = await query(buildOverpassAirfieldQuery(ap.lat, ap.lon, 90));
  if (!json) {
    failed++;
    console.warn('fail', ap.icao);
    continue;
  }
  const p = parseOverpassAirfieldElements(json.elements ?? []);
  fs.writeFileSync(
    file,
    JSON.stringify({
      generatedAt: Date.now(),
      data: {
        osmRunways: p.osmRunways,
        taxiways: p.taxiways.slice(0, 2600),
        aprons: p.aprons,
        labeledAprons: p.labeledAprons,
        terminals: p.terminals,
        stands: p.stands,
        holdingPositions: p.holdingPositions,
        gates: p.gates,
      },
    }),
  );
  done++;
  console.log('ok  ', ap.icao, `${p.taxiways.length} twy`);
  await sleep(1500);
}
console.log(`baked ${done}, failed ${failed}`);
