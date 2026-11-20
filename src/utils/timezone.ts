/**
 * Resolves accurate IANA timezone & UTC offset for global airports/coordinates
 * so "Airport" time mode always shows the true local time at that airport rather
 * than mirroring the user's browser timezone.
 */

const ICAO_TIMEZONE_OVERRIDES: Record<string, string> = {
  // China / East Asia
  ZBAA: 'Asia/Shanghai',
  ZBAD: 'Asia/Shanghai',
  ZSPD: 'Asia/Shanghai',
  ZSSS: 'Asia/Shanghai',
  ZGGG: 'Asia/Shanghai',
  ZGSZ: 'Asia/Shanghai',
  ZUUU: 'Asia/Shanghai',
  ZUTF: 'Asia/Shanghai',
  ZUCK: 'Asia/Shanghai',
  ZHCC: 'Asia/Shanghai',
  ZLXY: 'Asia/Shanghai',
  ZHHH: 'Asia/Shanghai',
  ZPPP: 'Asia/Shanghai',
  ZSAM: 'Asia/Shanghai',
  ZSHC: 'Asia/Shanghai',
  VHHH: 'Asia/Hong_Kong',
  VMMC: 'Asia/Macau',
  RCTP: 'Asia/Taipei',
  RCSS: 'Asia/Taipei',
  RJTT: 'Asia/Tokyo',
  RJAA: 'Asia/Tokyo',
  RJBB: 'Asia/Tokyo',
  RJOO: 'Asia/Tokyo',
  RJFF: 'Asia/Tokyo',
  RJCC: 'Asia/Tokyo',
  RKSI: 'Asia/Seoul',
  RKSS: 'Asia/Seoul',
  RKPK: 'Asia/Seoul',
  // Southeast Asia / South Asia
  WSSS: 'Asia/Singapore',
  WMKK: 'Asia/Kuala_Lumpur',
  VTBS: 'Asia/Bangkok',
  VTBD: 'Asia/Bangkok',
  VVNB: 'Asia/Ho_Chi_Minh',
  VVTS: 'Asia/Ho_Chi_Minh',
  RPLL: 'Asia/Manila',
  WIII: 'Asia/Jakarta',
  WADD: 'Asia/Makassar',
  VIDP: 'Asia/Kolkata',
  VABB: 'Asia/Kolkata',
  VOBL: 'Asia/Kolkata',
  VOMM: 'Asia/Kolkata',
  VGHS: 'Asia/Dhaka',
  OPIS: 'Asia/Karachi',
  // Middle East
  OMDB: 'Asia/Dubai',
  OMAA: 'Asia/Dubai',
  OTHH: 'Asia/Qatar',
  OEJN: 'Asia/Riyadh',
  OERK: 'Asia/Riyadh',
  OBBI: 'Asia/Bahrain',
  OKKK: 'Asia/Kuwait',
  LLBG: 'Asia/Jerusalem',
  OJAI: 'Asia/Amman',
  // Europe
  EGLL: 'Europe/London',
  EGKK: 'Europe/London',
  EGSS: 'Europe/London',
  EGCC: 'Europe/London',
  EIDW: 'Europe/Dublin',
  LFPG: 'Europe/Paris',
  LFPO: 'Europe/Paris',
  LFMN: 'Europe/Paris',
  EDDF: 'Europe/Berlin',
  EDDM: 'Europe/Berlin',
  EDDB: 'Europe/Berlin',
  EHAM: 'Europe/Amsterdam',
  EBBR: 'Europe/Brussels',
  LSZH: 'Europe/Zurich',
  LSGG: 'Europe/Zurich',
  LOWW: 'Europe/Vienna',
  LIRF: 'Europe/Rome',
  LIMC: 'Europe/Rome',
  LEMD: 'Europe/Madrid',
  LEBL: 'Europe/Madrid',
  LPPT: 'Europe/Lisbon',
  EKCH: 'Europe/Copenhagen',
  ENGM: 'Europe/Oslo',
  ESSA: 'Europe/Stockholm',
  EFHK: 'Europe/Helsinki',
  EPWA: 'Europe/Warsaw',
  LKPR: 'Europe/Prague',
  LGAV: 'Europe/Athens',
  LTFM: 'Europe/Istanbul',
  LTFJ: 'Europe/Istanbul',
  UUEE: 'Europe/Moscow',
  UUDD: 'Europe/Moscow',
  // North America
  KJFK: 'America/New_York',
  KLGA: 'America/New_York',
  KEWR: 'America/New_York',
  KBOS: 'America/New_York',
  KIAD: 'America/New_York',
  KDCA: 'America/New_York',
  KATL: 'America/New_York',
  KMIA: 'America/New_York',
  KFLL: 'America/New_York',
  KMCO: 'America/New_York',
  KCLT: 'America/New_York',
  KDTW: 'America/Detroit',
  KPHL: 'America/New_York',
  KORD: 'America/Chicago',
  KMDW: 'America/Chicago',
  KDFW: 'America/Chicago',
  KIAH: 'America/Chicago',
  KMSP: 'America/Chicago',
  KAUS: 'America/Chicago',
  KBNA: 'America/Chicago',
  KDEN: 'America/Denver',
  KSLC: 'America/Denver',
  KPHX: 'America/Phoenix',
  KLAS: 'America/Los_Angeles',
  KLAX: 'America/Los_Angeles',
  KSFO: 'America/Los_Angeles',
  KOAK: 'America/Los_Angeles',
  KSJC: 'America/Los_Angeles',
  KSAN: 'America/Los_Angeles',
  KSEA: 'America/Los_Angeles',
  KPDX: 'America/Los_Angeles',
  PANC: 'America/Anchorage',
  PHNL: 'Pacific/Honolulu',
  CYYZ: 'America/Toronto',
  CYUL: 'America/Toronto',
  CYVR: 'America/Vancouver',
  CYYC: 'America/Edmonton',
  MMMX: 'America/Mexico_City',
  MMUN: 'America/Cancun',
  // South America
  SBGR: 'America/Sao_Paulo',
  SBGL: 'America/Sao_Paulo',
  SBSP: 'America/Sao_Paulo',
  SBBR: 'America/Sao_Paulo',
  SAEZ: 'America/Argentina/Buenos_Aires',
  SCEL: 'America/Santiago',
  SKBO: 'America/Bogota',
  SPJC: 'America/Lima',
  SEQM: 'America/Guayaquil',
  MPTO: 'America/Panama',
  // Africa
  FAOR: 'Africa/Johannesburg',
  FACT: 'Africa/Johannesburg',
  HECA: 'Africa/Cairo',
  GMMN: 'Africa/Casablanca',
  HAAB: 'Africa/Addis_Ababa',
  HKJK: 'Africa/Nairobi',
  DNMM: 'Africa/Lagos',
  DAAG: 'Africa/Algiers',
  DTTA: 'Africa/Tunis',
  // Oceania
  YSSY: 'Australia/Sydney',
  YMML: 'Australia/Melbourne',
  YBBN: 'Australia/Brisbane',
  YPPH: 'Australia/Perth',
  YPAD: 'Australia/Adelaide',
  NZAA: 'Pacific/Auckland',
  NZCH: 'Pacific/Auckland',
  NZWN: 'Pacific/Auckland',
  NFFN: 'Pacific/Fiji',
};

const ICAO_PREFIX_TIMEZONE: Array<[string, string]> = [
  ['ZB', 'Asia/Shanghai'],
  ['ZS', 'Asia/Shanghai'],
  ['ZG', 'Asia/Shanghai'],
  ['ZH', 'Asia/Shanghai'],
  ['ZJ', 'Asia/Shanghai'],
  ['ZL', 'Asia/Shanghai'],
  ['ZP', 'Asia/Shanghai'],
  ['ZU', 'Asia/Shanghai'],
  ['ZW', 'Asia/Urumqi'],
  ['ZY', 'Asia/Shanghai'],
  ['VH', 'Asia/Hong_Kong'],
  ['RC', 'Asia/Taipei'],
  ['RJ', 'Asia/Tokyo'],
  ['RO', 'Asia/Tokyo'],
  ['RK', 'Asia/Seoul'],
  ['WS', 'Asia/Singapore'],
  ['WM', 'Asia/Kuala_Lumpur'],
  ['VT', 'Asia/Bangkok'],
  ['VV', 'Asia/Ho_Chi_Minh'],
  ['RP', 'Asia/Manila'],
  ['EG', 'Europe/London'],
  ['EI', 'Europe/Dublin'],
  ['LF', 'Europe/Paris'],
  ['ED', 'Europe/Berlin'],
  ['ET', 'Europe/Berlin'],
  ['EH', 'Europe/Amsterdam'],
  ['EB', 'Europe/Brussels'],
  ['LS', 'Europe/Zurich'],
  ['LO', 'Europe/Vienna'],
  ['LI', 'Europe/Rome'],
  ['LE', 'Europe/Madrid'],
  ['LP', 'Europe/Lisbon'],
  ['EK', 'Europe/Copenhagen'],
  ['EN', 'Europe/Oslo'],
  ['ES', 'Europe/Stockholm'],
  ['EF', 'Europe/Helsinki'],
  ['EP', 'Europe/Warsaw'],
  ['LK', 'Europe/Prague'],
  ['LG', 'Europe/Athens'],
  ['LT', 'Europe/Istanbul'],
  ['OM', 'Asia/Dubai'],
  ['OT', 'Asia/Qatar'],
  ['OE', 'Asia/Riyadh'],
  ['OB', 'Asia/Bahrain'],
  ['LL', 'Asia/Jerusalem'],
  ['VI', 'Asia/Kolkata'],
  ['VA', 'Asia/Kolkata'],
  ['VO', 'Asia/Kolkata'],
  ['VE', 'Asia/Kolkata'],
  ['SA', 'America/Argentina/Buenos_Aires'],
  ['SC', 'America/Santiago'],
  ['SK', 'America/Bogota'],
  ['SP', 'America/Lima'],
  ['SB', 'America/Sao_Paulo'],
  ['FA', 'Africa/Johannesburg'],
  ['HE', 'Africa/Cairo'],
  ['GM', 'Africa/Casablanca'],
  ['HA', 'Africa/Addis_Ababa'],
  ['HK', 'Africa/Nairobi'],
  ['NZ', 'Pacific/Auckland'],
  ['PH', 'Pacific/Honolulu'],
  ['PA', 'America/Anchorage'],
  ['MM', 'America/Mexico_City'],
];

export function resolveTimezoneByCoordsAndCode(opts: {
  icao?: string;
  iata?: string;
  lat?: number;
  lon?: number;
}): {timezoneName?: string; utcOffsetSec: number; timezoneAbbr: string} {
  const icao = (opts.icao || '').trim().toUpperCase();
  let tzName = icao ? ICAO_TIMEZONE_OVERRIDES[icao] : undefined;

  if (!tzName && icao.length >= 2) {
    const p2 = icao.slice(0, 2);
    for (const [pref, tz] of ICAO_PREFIX_TIMEZONE) {
      if (p2 === pref) {
        tzName = tz;
        break;
      }
    }
  }

  // Regional US/Canada band estimation if ICAO starts with K or C
  if (!tzName && typeof opts.lon === 'number' && Number.isFinite(opts.lon)) {
    const lon = opts.lon;
    const lat = opts.lat ?? 35;
    if (icao.startsWith('K')) {
      if (lon < -114.5) tzName = 'America/Los_Angeles';
      else if (lon < -102.0) tzName = 'America/Denver';
      else if (lon < -85.5) tzName = 'America/Chicago';
      else tzName = 'America/New_York';
    } else if (icao.startsWith('C')) {
      if (lon < -119) tzName = 'America/Vancouver';
      else if (lon < -102) tzName = 'America/Edmonton';
      else if (lon < -88) tzName = 'America/Winnipeg';
      else if (lon < -64) tzName = 'America/Toronto';
      else tzName = 'America/Halifax';
    } else if (icao.startsWith('Y') && lon > 110) {
      if (lon < 129) tzName = 'Australia/Perth';
      else if (lon < 141) tzName = lat < -26 ? 'Australia/Adelaide' : 'Australia/Darwin';
      else tzName = lat < -29 ? 'Australia/Sydney' : 'Australia/Brisbane';
    }
  }

  if (tzName) {
    try {
      const now = new Date();
      const utcMs = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
      );
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzName,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const h = get('hour') === 24 ? 0 : get('hour');
      const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
      const offsetSec = Math.round((tzMs - utcMs) / 1000);
      const abbrParts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzName,
        timeZoneName: 'short',
      }).formatToParts(now);
      const abbr = abbrParts.find((p) => p.type === 'timeZoneName')?.value ?? formatUtcOffsetLabel(offsetSec);
      return {timezoneName: tzName, utcOffsetSec: offsetSec, timezoneAbbr: abbr};
    } catch {
      // fall through
    }
  }

  const lon = typeof opts.lon === 'number' && Number.isFinite(opts.lon) ? opts.lon : 0;
  const offsetHours = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  const offsetSec = offsetHours * 3600;
  return {
    utcOffsetSec: offsetSec,
    timezoneAbbr: formatUtcOffsetLabel(offsetSec),
  };
}

export function formatUtcOffsetLabel(offsetSec: number): string {
  const hrs = offsetSec / 3600;
  if (hrs === 0) return 'UTC';
  const sign = hrs > 0 ? '+' : '-';
  const abs = Math.abs(hrs);
  const whole = Math.floor(abs);
  const mins = Math.round((abs - whole) * 60);
  return mins > 0
    ? `UTC${sign}${whole}:${String(mins).padStart(2, '0')}`
    : `UTC${sign}${whole}`;
}

export function formatEpochInTimezone(
  ts: number | undefined,
  mode: 'airport' | 'local' | 'utc',
  tzName?: string,
  utcOffsetSec?: number,
): string {
  if (!ts) return '—';
  try {
    if (mode === 'utc') {
      return `${new Intl.DateTimeFormat([], {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ts * 1000))}Z`;
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
      if (typeof utcOffsetSec === 'number' && Number.isFinite(utcOffsetSec)) {
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
