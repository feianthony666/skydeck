export interface AirportSpec {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevationFt: number;
  runways: Array<{
    ident: string;
    headingDeg: number;
    lengthFt: number;
  }>;
}

export interface RegionPreset {
  id: string;
  label: string;
  subtitle: string;
  center: [number, number];
  zoom: number;
  bounds: {
    lamin: number;
    lomin: number;
    lamax: number;
    lomax: number;
  };
}

export interface AirlineLivery {
  icao: string;
  iata: string;
  name: string;
  fuselageHex: string;
  tailHex: string;
  accentHex: string;
  bellyHex: string;
  titleColor: string;
}

export interface AircraftGeometrySpec {
  code: string;
  name: string;
  category: 'widebody' | 'narrowbody' | 'regional';
  lengthScale: number;
  wingspanScale: number;
  fuselageRadius: number;
  engines: 2 | 4;
  winglets: boolean;
  tTail?: boolean;
}

export const REGION_PRESETS: RegionPreset[] = [
  {
    id: 'china-east',
    label: 'China & East Asia',
    subtitle: 'Beijing · Shanghai · Guangzhou · Chengdu · Hong Kong',
    center: [31.2, 114.5],
    zoom: 5,
    bounds: {lamin: 18.0, lomin: 98.0, lamax: 43.0, lomax: 126.0},
  },
  {
    id: 'zbaa-hub',
    label: 'Beijing (ZBAA / ZBAD)',
    subtitle: 'Capital & Daxing Approach + Surface Taxi',
    center: [39.92, 116.52],
    zoom: 10,
    bounds: {lamin: 39.35, lomin: 115.85, lamax: 40.45, lomax: 117.15},
  },
  {
    id: 'zspd-hub',
    label: 'Shanghai (ZSPD / ZSSS)',
    subtitle: 'Pudong & Hongqiao Yangtze Corridor',
    center: [31.16, 121.62],
    zoom: 10,
    bounds: {lamin: 30.75, lomin: 120.95, lamax: 31.65, lomax: 122.25},
  },
  {
    id: 'zggg-hub',
    label: 'Greater Bay (ZGGG / VHHH)',
    subtitle: 'Guangzhou · Shenzhen · Hong Kong TMA',
    center: [22.88, 113.65],
    zoom: 9,
    bounds: {lamin: 21.95, lomin: 112.75, lamax: 23.85, lomax: 114.65},
  },
  {
    id: 'na-east',
    label: 'North America East',
    subtitle: 'New York · Atlanta · Chicago · FAA NAS',
    center: [39.5, -78.5],
    zoom: 5,
    bounds: {lamin: 25.0, lomin: -95.0, lamax: 46.0, lomax: -68.0},
  },
  {
    id: 'europe',
    label: 'Europe Core',
    subtitle: 'London · Frankfurt · Paris · Amsterdam',
    center: [49.8, 6.2],
    zoom: 5,
    bounds: {lamin: 42.0, lomin: -6.0, lamax: 56.0, lomax: 18.0},
  },
];

export const AIRPORT_CATALOG: AirportSpec[] = [
  {
    icao: 'ZBAA',
    iata: 'PEK',
    name: 'Beijing Capital International',
    city: 'Beijing',
    country: 'CN',
    lat: 40.0799,
    lon: 116.6031,
    elevationFt: 116,
    runways: [
      {ident: '36R/18L', headingDeg: 359, lengthFt: 12467},
      {ident: '36L/18R', headingDeg: 359, lengthFt: 10499},
      {ident: '01/19', headingDeg: 359, lengthFt: 12467},
    ],
  },
  {
    icao: 'ZBAD',
    iata: 'PKX',
    name: 'Beijing Daxing International',
    city: 'Beijing',
    country: 'CN',
    lat: 39.5092,
    lon: 116.4106,
    elevationFt: 98,
    runways: [
      {ident: '35R/17L', headingDeg: 350, lengthFt: 12467},
      {ident: '35L/17R', headingDeg: 350, lengthFt: 12467},
      {ident: '01L/19R', headingDeg: 10, lengthFt: 11155},
    ],
  },
  {
    icao: 'ZSPD',
    iata: 'PVG',
    name: 'Shanghai Pudong International',
    city: 'Shanghai',
    country: 'CN',
    lat: 31.1443,
    lon: 121.8083,
    elevationFt: 13,
    runways: [
      {ident: '34L/16R', headingDeg: 342, lengthFt: 13123},
      {ident: '34R/16L', headingDeg: 342, lengthFt: 12467},
      {ident: '35L/17R', headingDeg: 342, lengthFt: 12467},
      {ident: '35R/17L', headingDeg: 342, lengthFt: 11155},
    ],
  },
  {
    icao: 'ZSSS',
    iata: 'SHA',
    name: 'Shanghai Hongqiao International',
    city: 'Shanghai',
    country: 'CN',
    lat: 31.1979,
    lon: 121.3363,
    elevationFt: 10,
    runways: [
      {ident: '36L/18R', headingDeg: 356, lengthFt: 10827},
      {ident: '36R/18L', headingDeg: 356, lengthFt: 11155},
    ],
  },
  {
    icao: 'ZGGG',
    iata: 'CAN',
    name: 'Guangzhou Baiyun International',
    city: 'Guangzhou',
    country: 'CN',
    lat: 23.3924,
    lon: 113.2988,
    elevationFt: 50,
    runways: [
      {ident: '02L/20R', headingDeg: 18, lengthFt: 12467},
      {ident: '02R/20L', headingDeg: 18, lengthFt: 12467},
      {ident: '01/19', headingDeg: 18, lengthFt: 11811},
    ],
  },
  {
    icao: 'ZGSZ',
    iata: 'SZX',
    name: 'Shenzhen Bao’an International',
    city: 'Shenzhen',
    country: 'CN',
    lat: 22.6393,
    lon: 113.8107,
    elevationFt: 13,
    runways: [
      {ident: '15/33', headingDeg: 152, lengthFt: 11155},
      {ident: '16/34', headingDeg: 152, lengthFt: 12467},
    ],
  },
  {
    icao: 'ZUUU',
    iata: 'CTU',
    name: 'Chengdu Shuangliu International',
    city: 'Chengdu',
    country: 'CN',
    lat: 30.5785,
    lon: 103.9471,
    elevationFt: 1625,
    runways: [
      {ident: '02L/20R', headingDeg: 22, lengthFt: 11811},
      {ident: '02R/20L', headingDeg: 22, lengthFt: 11811},
    ],
  },
  {
    icao: 'ZPPP',
    iata: 'KMG',
    name: 'Kunming Changshui International',
    city: 'Kunming',
    country: 'CN',
    lat: 25.1019,
    lon: 102.9292,
    elevationFt: 6900,
    runways: [
      {ident: '03/21', headingDeg: 32, lengthFt: 13123},
      {ident: '04/22', headingDeg: 32, lengthFt: 14764},
    ],
  },
  {
    icao: 'ZLXY',
    iata: 'XIY',
    name: 'Xi’an Xianyang International',
    city: 'Xi’an',
    country: 'CN',
    lat: 34.4471,
    lon: 108.7516,
    elevationFt: 1572,
    runways: [
      {ident: '05L/23R', headingDeg: 47, lengthFt: 9843},
      {ident: '05R/23L', headingDeg: 47, lengthFt: 12467},
    ],
  },
  {
    icao: 'VHHH',
    iata: 'HKG',
    name: 'Hong Kong International',
    city: 'Hong Kong',
    country: 'HK',
    lat: 22.308,
    lon: 113.9185,
    elevationFt: 28,
    runways: [
      {ident: '07L/25R', headingDeg: 74, lengthFt: 12467},
      {ident: '07C/25C', headingDeg: 74, lengthFt: 12467},
      {ident: '07R/25L', headingDeg: 74, lengthFt: 12467},
    ],
  },
  {
    icao: 'RJTT',
    iata: 'HND',
    name: 'Tokyo Haneda Airport',
    city: 'Tokyo',
    country: 'JP',
    lat: 35.5494,
    lon: 139.7798,
    elevationFt: 21,
    runways: [
      {ident: '34L/16R', headingDeg: 337, lengthFt: 9843},
      {ident: '34R/16L', headingDeg: 337, lengthFt: 9843},
      {ident: '04/22', headingDeg: 38, lengthFt: 8202},
    ],
  },
  {
    icao: 'RKSI',
    iata: 'ICN',
    name: 'Seoul Incheon International',
    city: 'Seoul',
    country: 'KR',
    lat: 37.4602,
    lon: 126.4407,
    elevationFt: 23,
    runways: [
      {ident: '33L/15R', headingDeg: 332, lengthFt: 12303},
      {ident: '34/16', headingDeg: 332, lengthFt: 13123},
    ],
  },
  {
    icao: 'KJFK',
    iata: 'JFK',
    name: 'John F. Kennedy International',
    city: 'New York',
    country: 'US',
    lat: 40.6413,
    lon: -73.7781,
    elevationFt: 13,
    runways: [
      {ident: '04R/22L', headingDeg: 31, lengthFt: 8400},
      {ident: '13R/31L', headingDeg: 121, lengthFt: 14511},
      {ident: '04L/22R', headingDeg: 31, lengthFt: 12079},
    ],
  },
  {
    icao: 'KLAX',
    iata: 'LAX',
    name: 'Los Angeles International',
    city: 'Los Angeles',
    country: 'US',
    lat: 33.9416,
    lon: -118.4085,
    elevationFt: 128,
    runways: [
      {ident: '24R/06L', headingDeg: 251, lengthFt: 8926},
      {ident: '25L/07R', headingDeg: 251, lengthFt: 11095},
    ],
  },
  {
    icao: 'KORD',
    iata: 'ORD',
    name: 'Chicago O’Hare International',
    city: 'Chicago',
    country: 'US',
    lat: 41.9742,
    lon: -87.9073,
    elevationFt: 680,
    runways: [
      {ident: '28C/10C', headingDeg: 273, lengthFt: 10801},
      {ident: '27L/09R', headingDeg: 273, lengthFt: 11260},
    ],
  },
  {
    icao: 'EGLL',
    iata: 'LHR',
    name: 'London Heathrow Airport',
    city: 'London',
    country: 'GB',
    lat: 51.47,
    lon: -0.4543,
    elevationFt: 83,
    runways: [
      {ident: '27R/09L', headingDeg: 270, lengthFt: 12799},
      {ident: '27L/09R', headingDeg: 270, lengthFt: 12008},
    ],
  },
  {
    icao: 'EDDF',
    iata: 'FRA',
    name: 'Frankfurt Airport',
    city: 'Frankfurt',
    country: 'DE',
    lat: 50.0379,
    lon: 8.5622,
    elevationFt: 364,
    runways: [
      {ident: '25C/07C', headingDeg: 248, lengthFt: 13123},
      {ident: '25L/07R', headingDeg: 248, lengthFt: 13123},
      {ident: '18/36', headingDeg: 179, lengthFt: 13123},
    ],
  },
  {
    icao: 'LFPG',
    iata: 'CDG',
    name: 'Paris Charles de Gaulle',
    city: 'Paris',
    country: 'FR',
    lat: 49.0097,
    lon: 2.5479,
    elevationFt: 392,
    runways: [
      {ident: '26R/08L', headingDeg: 266, lengthFt: 13829},
      {ident: '27L/09R', headingDeg: 266, lengthFt: 13780},
    ],
  },
  {
    icao: 'RCTP',
    iata: 'TPE',
    name: 'Taiwan Taoyuan International',
    city: 'Taipei',
    country: 'TW',
    lat: 25.0777,
    lon: 121.2328,
    elevationFt: 108,
    runways: [
      {ident: '05L/23R', headingDeg: 51, lengthFt: 12008},
      {ident: '05R/23L', headingDeg: 51, lengthFt: 12467},
    ],
  },
  {
    icao: 'RCSS',
    iata: 'TSA',
    name: 'Taipei Songshan Airport',
    city: 'Taipei',
    country: 'TW',
    lat: 25.0694,
    lon: 121.5525,
    elevationFt: 18,
    runways: [{ident: '10/28', headingDeg: 95, lengthFt: 8547}],
  },
  {
    icao: 'RJAA',
    iata: 'NRT',
    name: 'Tokyo Narita International',
    city: 'Tokyo',
    country: 'JP',
    lat: 35.7647,
    lon: 140.3864,
    elevationFt: 141,
    runways: [
      {ident: '34L/16R', headingDeg: 335, lengthFt: 13123},
      {ident: '34R/16L', headingDeg: 335, lengthFt: 8202},
    ],
  },
  {
    icao: 'WSSS',
    iata: 'SIN',
    name: 'Singapore Changi Airport',
    city: 'Singapore',
    country: 'SG',
    lat: 1.3644,
    lon: 103.9915,
    elevationFt: 22,
    runways: [
      {ident: '02L/20R', headingDeg: 23, lengthFt: 13123},
      {ident: '02C/20C', headingDeg: 23, lengthFt: 13123},
    ],
  },
  {
    icao: 'ZSHC',
    iata: 'HGH',
    name: 'Hangzhou Xiaoshan International',
    city: 'Hangzhou',
    country: 'CN',
    lat: 30.2295,
    lon: 120.4344,
    elevationFt: 23,
    runways: [
      {ident: '06/24', headingDeg: 58, lengthFt: 11811},
      {ident: '07/25', headingDeg: 58, lengthFt: 11155},
    ],
  },
  {
    icao: 'ZUCK',
    iata: 'CKG',
    name: 'Chongqing Jiangbei International',
    city: 'Chongqing',
    country: 'CN',
    lat: 29.7192,
    lon: 106.6417,
    elevationFt: 1365,
    runways: [
      {ident: '02L/20R', headingDeg: 22, lengthFt: 11811},
      {ident: '03/21', headingDeg: 22, lengthFt: 12467},
    ],
  },
  {
    icao: 'OMDB',
    iata: 'DXB',
    name: 'Dubai International',
    city: 'Dubai',
    country: 'AE',
    lat: 25.2528,
    lon: 55.3644,
    elevationFt: 62,
    runways: [
      {ident: '12L/30R', headingDeg: 120, lengthFt: 13123},
      {ident: '12R/30L', headingDeg: 120, lengthFt: 14600},
    ],
  },
  {
    icao: 'EHAM',
    iata: 'AMS',
    name: 'Amsterdam Airport Schiphol',
    city: 'Amsterdam',
    country: 'NL',
    lat: 52.3086,
    lon: 4.7639,
    elevationFt: -11,
    runways: [
      {ident: '18R/36L', headingDeg: 183, lengthFt: 12467},
      {ident: '06/24', headingDeg: 58, lengthFt: 11483},
    ],
  },
  {
    icao: 'KATL',
    iata: 'ATL',
    name: 'Hartsfield-Jackson Atlanta',
    city: 'Atlanta',
    country: 'US',
    lat: 33.6407,
    lon: -84.4277,
    elevationFt: 1026,
    runways: [
      {ident: '08L/26R', headingDeg: 95, lengthFt: 9000},
      {ident: '09L/27R', headingDeg: 95, lengthFt: 12390},
    ],
  },
];

const EXTRA_AIRPORT_COORDS: Record<string, {lat: number; lon: number; name: string}> = {
  KHH: {lat: 22.5771, lon: 120.35, name: 'Kaohsiung International'},
  RMQ: {lat: 24.2647, lon: 120.621, name: 'Taichung International'},
  MFM: {lat: 22.1496, lon: 113.592, name: 'Macau International'},
  XMN: {lat: 24.544, lon: 118.128, name: 'Xiamen Gaoqi'},
  FOC: {lat: 25.9351, lon: 119.663, name: 'Fuzhou Changle'},
  NKG: {lat: 31.742, lon: 118.862, name: 'Nanjing Lukou'},
  WUH: {lat: 30.7838, lon: 114.208, name: 'Wuhan Tianhe'},
  CSX: {lat: 28.1892, lon: 113.22, name: 'Changsha Huanghua'},
  CGO: {lat: 34.5197, lon: 113.841, name: 'Zhengzhou Xinzheng'},
  TAO: {lat: 36.2661, lon: 120.374, name: 'Qingdao Jiaodong'},
  DLC: {lat: 38.9657, lon: 121.539, name: 'Dalian Zhoushuizi'},
  SHE: {lat: 41.6398, lon: 123.483, name: 'Shenyang Taoxian'},
  HRB: {lat: 45.6234, lon: 126.25, name: 'Harbin Taiping'},
  URC: {lat: 43.9071, lon: 87.4742, name: 'Urumqi Diwopu'},
  SYX: {lat: 18.3029, lon: 109.412, name: 'Sanya Phoenix'},
  HAK: {lat: 19.9349, lon: 110.459, name: 'Haikou Meilan'},
  KIX: {lat: 34.4273, lon: 135.244, name: 'Osaka Kansai'},
  FUK: {lat: 33.5859, lon: 130.451, name: 'Fukuoka Airport'},
  CTS: {lat: 42.7752, lon: 141.692, name: 'Sapporo New Chitose'},
  OKA: {lat: 26.1958, lon: 127.646, name: 'Okinawa Naha'},
  GMP: {lat: 37.5583, lon: 126.791, name: 'Seoul Gimpo'},
  PUS: {lat: 35.1795, lon: 128.938, name: 'Busan Gimhae'},
  MNL: {lat: 14.5086, lon: 121.019, name: 'Manila Ninoy Aquino'},
  BKK: {lat: 13.6811, lon: 100.747, name: 'Bangkok Suvarnabhumi'},
  DMK: {lat: 13.9126, lon: 100.607, name: 'Bangkok Don Mueang'},
  CNX: {lat: 18.7668, lon: 98.9626, name: 'Chiang Mai'},
  KUL: {lat: 2.7456, lon: 101.7099, name: 'Kuala Lumpur'},
  CGK: {lat: -6.1256, lon: 106.6558, name: 'Jakarta Soekarno-Hatta'},
  SGN: {lat: 10.8188, lon: 106.652, name: 'Ho Chi Minh City'},
  HAN: {lat: 21.2212, lon: 105.807, name: 'Hanoi Noi Bai'},
  DAD: {lat: 16.0439, lon: 108.199, name: 'Da Nang'},
  DEL: {lat: 28.5665, lon: 77.1031, name: 'Delhi Indira Gandhi'},
  BOM: {lat: 19.0887, lon: 72.8679, name: 'Mumbai Chhatrapati Shivaji'},
  DOH: {lat: 25.2731, lon: 51.6081, name: 'Doha Hamad'},
  IST: {lat: 41.2753, lon: 28.7519, name: 'Istanbul Airport'},
  ZRH: {lat: 47.4647, lon: 8.5492, name: 'Zurich Airport'},
  MUC: {lat: 48.3538, lon: 11.7861, name: 'Munich Airport'},
  MAD: {lat: 40.4719, lon: -3.5626, name: 'Madrid Barajas'},
  FCO: {lat: 41.8003, lon: 12.2389, name: 'Rome Fiumicino'},
  LGW: {lat: 51.1481, lon: -0.1903, name: 'London Gatwick'},
  SFO: {lat: 37.6213, lon: -122.379, name: 'San Francisco'},
  SEA: {lat: 47.4502, lon: -122.309, name: 'Seattle-Tacoma'},
  DFW: {lat: 32.8998, lon: -97.0403, name: 'Dallas/Fort Worth'},
  MIA: {lat: 25.7959, lon: -80.287, name: 'Miami International'},
  BOS: {lat: 42.3656, lon: -71.0096, name: 'Boston Logan'},
  EWR: {lat: 40.6895, lon: -74.1745, name: 'Newark Liberty'},
  YYZ: {lat: 43.6777, lon: -79.6248, name: 'Toronto Pearson'},
  YVR: {lat: 49.1967, lon: -123.182, name: 'Vancouver International'},
  SYD: {lat: -33.9461, lon: 151.177, name: 'Sydney Kingsford Smith'},
  MEL: {lat: -37.6733, lon: 144.843, name: 'Melbourne Airport'},
  AKL: {lat: -37.0082, lon: 174.785, name: 'Auckland Airport'},
  YIW: {lat: 29.3447, lon: 120.032, name: 'Yiwu Airport'},
};

export function resolveAirportCoords(code: string): {lat: number; lon: number; name: string} | null {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  const cat = AIRPORT_CATALOG.find((a) => a.iata === c || a.icao === c);
  if (cat) return {lat: cat.lat, lon: cat.lon, name: cat.name};
  return EXTRA_AIRPORT_COORDS[c] ?? null;
}

export const AIRLINE_LIVERIES: Record<string, AirlineLivery> = {
  CCA: {icao: 'CCA', iata: 'CA', name: 'Air China', fuselageHex: '#F8FAFC', tailHex: '#DC2626', accentHex: '#2563EB', bellyHex: '#CBD5E1', titleColor: '#1E293B'},
  CES: {icao: 'CES', iata: 'MU', name: 'China Eastern', fuselageHex: '#F8FAFC', tailHex: '#1D4ED8', accentHex: '#EF4444', bellyHex: '#E2E8F0', titleColor: '#0F172A'},
  CSN: {icao: 'CSN', iata: 'CZ', name: 'China Southern', fuselageHex: '#F8FAFC', tailHex: '#0284C7', accentHex: '#EF4444', bellyHex: '#CBD5E1', titleColor: '#0369A1'},
  CHH: {icao: 'CHH', iata: 'HU', name: 'Hainan Airlines', fuselageHex: '#F8FAFC', tailHex: '#B91C1C', accentHex: '#F59E0B', bellyHex: '#E2E8F0', titleColor: '#991B1B'},
  CXA: {icao: 'CXA', iata: 'MF', name: 'XiamenAir', fuselageHex: '#F8FAFC', tailHex: '#0369A1', accentHex: '#38BDF8', bellyHex: '#E2E8F0', titleColor: '#075985'},
  CSC: {icao: 'CSC', iata: '3U', name: 'Sichuan Airlines', fuselageHex: '#F8FAFC', tailHex: '#DC2626', accentHex: '#1E293B', bellyHex: '#CBD5E1', titleColor: '#B91C1C'},
  DKH: {icao: 'DKH', iata: 'HO', name: 'Juneyao Air', fuselageHex: '#F8FAFC', tailHex: '#9F1239', accentHex: '#D97706', bellyHex: '#E2E8F0', titleColor: '#881337'},
  CQH: {icao: 'CQH', iata: '9C', name: 'Spring Airlines', fuselageHex: '#F8FAFC', tailHex: '#15803D', accentHex: '#22C55E', bellyHex: '#E2E8F0', titleColor: '#166534'},
  CSZ: {icao: 'CSZ', iata: 'ZH', name: 'Shenzhen Airlines', fuselageHex: '#F8FAFC', tailHex: '#B91C1C', accentHex: '#1D4ED8', bellyHex: '#CBD5E1', titleColor: '#1E293B'},
  CPA: {icao: 'CPA', iata: 'CX', name: 'Cathay Pacific', fuselageHex: '#F8FAFC', tailHex: '#006564', accentHex: '#84CC16', bellyHex: '#CBD5E1', titleColor: '#006564'},
  ANA: {icao: 'ANA', iata: 'NH', name: 'All Nippon Airways', fuselageHex: '#F8FAFC', tailHex: '#1E3A8A', accentHex: '#0EA5E9', bellyHex: '#CBD5E1', titleColor: '#1E3A8A'},
  JAL: {icao: 'JAL', iata: 'JL', name: 'Japan Airlines', fuselageHex: '#FFFFFF', tailHex: '#DC2626', accentHex: '#1E293B', bellyHex: '#E2E8F0', titleColor: '#0F172A'},
  KAL: {icao: 'KAL', iata: 'KE', name: 'Korean Air', fuselageHex: '#38BDF8', tailHex: '#0284C7', accentHex: '#DC2626', bellyHex: '#F1F5F9', titleColor: '#0F172A'},
  UAL: {icao: 'UAL', iata: 'UA', name: 'United Airlines', fuselageHex: '#F8FAFC', tailHex: '#1D4ED8', accentHex: '#38BDF8', bellyHex: '#94A3B8', titleColor: '#1E3A8A'},
  DAL: {icao: 'DAL', iata: 'DL', name: 'Delta Air Lines', fuselageHex: '#F8FAFC', tailHex: '#1E293B', accentHex: '#DC2626', bellyHex: '#1E293B', titleColor: '#0F172A'},
  AAL: {icao: 'AAL', iata: 'AA', name: 'American Airlines', fuselageHex: '#CBD5E1', tailHex: '#DC2626', accentHex: '#1D4ED8', bellyHex: '#94A3B8', titleColor: '#1E293B'},
  BAW: {icao: 'BAW', iata: 'BA', name: 'British Airways', fuselageHex: '#F8FAFC', tailHex: '#1E3A8A', accentHex: '#DC2626', bellyHex: '#1E293B', titleColor: '#1E3A8A'},
  DLH: {icao: 'DLH', iata: 'LH', name: 'Lufthansa', fuselageHex: '#F8FAFC', tailHex: '#0F172A', accentHex: '#FACC15', bellyHex: '#E2E8F0', titleColor: '#0F172A'},
  AFR: {icao: 'AFR', iata: 'AF', name: 'Air France', fuselageHex: '#F8FAFC', tailHex: '#1E3A8A', accentHex: '#DC2626', bellyHex: '#E2E8F0', titleColor: '#1E3A8A'},
  UAE: {icao: 'UAE', iata: 'EK', name: 'Emirates', fuselageHex: '#F8FAFC', tailHex: '#DC2626', accentHex: '#16A34A', bellyHex: '#E2E8F0', titleColor: '#B45309'},
  SIA: {icao: 'SIA', iata: 'SQ', name: 'Singapore Airlines', fuselageHex: '#F8FAFC', tailHex: '#1E3A8A', accentHex: '#F59E0B', bellyHex: '#E2E8F0', titleColor: '#1E3A8A'},
};

export function resolveAirlineLivery(airlineIcao: string, callsign?: string): AirlineLivery {
  const code = (airlineIcao || callsign?.slice(0, 3) || '').toUpperCase();
  if (AIRLINE_LIVERIES[code]) {
    return AIRLINE_LIVERIES[code];
  }
  return {
    icao: code || 'GEN',
    iata: code.slice(0, 2) || 'FL',
    name: code ? `${code} Operator` : 'Commercial Airliner',
    fuselageHex: '#F1F5F9',
    tailHex: '#0284C7',
    accentHex: '#F59E0B',
    bellyHex: '#94A3B8',
    titleColor: '#0F172A',
  };
}

export function resolveAircraftSpec(typeCode: string): AircraftGeometrySpec {
  const t = (typeCode || 'A320').toUpperCase();
  if (/^(A38|B74)/.test(t)) {
    return {code: t, name: t.startsWith('A38') ? 'Airbus A380' : 'Boeing 747', category: 'widebody', lengthScale: 1.38, wingspanScale: 1.42, fuselageRadius: 0.56, engines: 4, winglets: true};
  }
  if (/^(A35|B77|B78|A33|A34|B76)/.test(t)) {
    return {code: t, name: t, category: 'widebody', lengthScale: 1.24, wingspanScale: 1.28, fuselageRadius: 0.46, engines: t.startsWith('A34') ? 4 : 2, winglets: true};
  }
  if (/^(C919|A32|A20|A21|A31|B73|B38|B39)/.test(t)) {
    return {code: t, name: t === 'C919' ? 'COMAC C919' : t, category: 'narrowbody', lengthScale: 1.0, wingspanScale: 1.0, fuselageRadius: 0.34, engines: 2, winglets: true};
  }
  if (/^(ARJ|C909|CRJ|E17|E19|ERJ)/.test(t)) {
    return {code: t, name: t.startsWith('ARJ') || t.startsWith('C909') ? 'COMAC ARJ21' : t, category: 'regional', lengthScale: 0.82, wingspanScale: 0.84, fuselageRadius: 0.27, engines: 2, winglets: true, tTail: /ARJ|C909|CRJ/.test(t)};
  }
  return {code: t, name: t, category: 'narrowbody', lengthScale: 1.0, wingspanScale: 1.0, fuselageRadius: 0.34, engines: 2, winglets: true};
}
