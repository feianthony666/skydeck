// Runs in GitHub Actions (server side, so no CORS). Writes same-origin JSON snapshots to public/data/
// which the static site reads instead of calling CORS-blocked APIs from the browser.
// usage: node scripts/fetch-snapshots.mjs "<comma separated hub ICAOs>"
import fs from 'node:fs';
import path from 'node:path';

const OUT = new URL('../public/data/', import.meta.url).pathname;
fs.mkdirSync(OUT, {recursive: true});
const hubs = (process.argv[2] || '').trim();
const UA = 'SkyDeck-Snapshots/1.0 (+https://github.com)';

const jobs = {
  'airsigmet-geojson': 'https://aviationweather.gov/api/data/airsigmet?format=geojson',
  'isigmet-geojson': 'https://aviationweather.gov/api/data/isigmet?format=geojson',
  'gairmet-geojson': 'https://aviationweather.gov/api/data/gairmet?format=geojson',
  'airsigmet-json': 'https://aviationweather.gov/api/data/airsigmet?format=json',
  'isigmet-json': 'https://aviationweather.gov/api/data/isigmet?format=json',
  'adsb-ladd': 'https://api.adsb.lol/v2/ladd',
  'adsb-mil': 'https://api.adsb.lol/v2/mil',
};
if (hubs) jobs['metar-hubs'] = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(hubs)}&format=json`;

let ok = 0;
await Promise.all(
  Object.entries(jobs).map(async ([name, url]) => {
    try {
      const res = await fetch(url, {headers: {'User-Agent': UA, Accept: 'application/json'}, signal: AbortSignal.timeout(25000)});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('empty body'); // AWC returns an empty body when there is nothing to report
      const data = JSON.parse(text);
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({generatedAt: Date.now(), data}));
      ok++;
      console.log('ok  ', name);
    } catch (e) {
      console.warn('skip', name, String(e));
    }
  }),
);
console.log(`${ok}/${Object.keys(jobs).length} snapshots written`);
