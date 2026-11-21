import {resolveAirlineLivery} from './aviationCatalog';

export interface AircraftModelManifestEntry {
  icaoType: string;
  displayName: string;
  modelClass:
    | 'a380'
    | 'heavy4'
    | 'widebody'
    | 'narrowbody'
    | 'rearjet'
    | 'bizjet'
    | 'turboprop'
    | 'lightprop'
    | 'milcargo'
    | 'fighter'
    | 'heli';
  wingSpanM: number;
  lengthM: number;
  engines: number;
  /** Normalized UV bounds inside 512x512 livery sheet */
  tailUvRect: [number, number, number, number];
  stripeUvRect: [number, number, number, number];
}

export interface AirlineManifestEntry {
  icao: string;
  iata: string;
  displayName: string;
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
  tailStyle: 'cheatline' | 'eurowhite' | 'fulltail' | 'billboard' | 'wave' | 'stripe';
  motifText: string;
}

export const AIRCRAFT_MODELS_MANIFEST: Record<string, AircraftModelManifestEntry> = {
  B738: {icaoType: 'B738', displayName: 'Boeing 737-800', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 39.5, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  B38M: {icaoType: 'B38M', displayName: 'Boeing 737 MAX 8', modelClass: 'narrowbody', wingSpanM: 35.9, lengthM: 39.5, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  B39M: {icaoType: 'B39M', displayName: 'Boeing 737 MAX 9', modelClass: 'narrowbody', wingSpanM: 35.9, lengthM: 42.2, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  A319: {icaoType: 'A319', displayName: 'Airbus A319', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 33.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  A320: {icaoType: 'A320', displayName: 'Airbus A320', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 37.6, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  A20N: {icaoType: 'A20N', displayName: 'Airbus A320neo', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 37.6, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  A321: {icaoType: 'A321', displayName: 'Airbus A321', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 44.5, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  A21N: {icaoType: 'A21N', displayName: 'Airbus A321neo', modelClass: 'narrowbody', wingSpanM: 35.8, lengthM: 44.5, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  BCS3: {icaoType: 'BCS3', displayName: 'Airbus A220-300', modelClass: 'narrowbody', wingSpanM: 35.1, lengthM: 38.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  B752: {icaoType: 'B752', displayName: 'Boeing 757-200', modelClass: 'narrowbody', wingSpanM: 38.1, lengthM: 47.3, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  B763: {icaoType: 'B763', displayName: 'Boeing 767-300ER', modelClass: 'widebody', wingSpanM: 47.6, lengthM: 54.9, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  B772: {icaoType: 'B772', displayName: 'Boeing 777-200ER', modelClass: 'widebody', wingSpanM: 60.9, lengthM: 63.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  B77W: {icaoType: 'B77W', displayName: 'Boeing 777-300ER', modelClass: 'widebody', wingSpanM: 64.8, lengthM: 73.9, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  B788: {icaoType: 'B788', displayName: 'Boeing 787-8', modelClass: 'widebody', wingSpanM: 60.1, lengthM: 56.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  B789: {icaoType: 'B789', displayName: 'Boeing 787-9', modelClass: 'widebody', wingSpanM: 60.1, lengthM: 62.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  B78X: {icaoType: 'B78X', displayName: 'Boeing 787-10', modelClass: 'widebody', wingSpanM: 60.1, lengthM: 68.3, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A332: {icaoType: 'A332', displayName: 'Airbus A330-200', modelClass: 'widebody', wingSpanM: 60.3, lengthM: 58.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A333: {icaoType: 'A333', displayName: 'Airbus A330-300', modelClass: 'widebody', wingSpanM: 60.3, lengthM: 63.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A339: {icaoType: 'A339', displayName: 'Airbus A330-900neo', modelClass: 'widebody', wingSpanM: 64.0, lengthM: 63.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A359: {icaoType: 'A359', displayName: 'Airbus A350-900', modelClass: 'widebody', wingSpanM: 64.8, lengthM: 66.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A35K: {icaoType: 'A35K', displayName: 'Airbus A350-1000', modelClass: 'widebody', wingSpanM: 64.8, lengthM: 73.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.16]},
  A388: {icaoType: 'A388', displayName: 'Airbus A380-800', modelClass: 'a380', wingSpanM: 79.8, lengthM: 72.7, engines: 4, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.40, 0.96, 0.18]},
  B744: {icaoType: 'B744', displayName: 'Boeing 747-400', modelClass: 'heavy4', wingSpanM: 64.4, lengthM: 70.7, engines: 4, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.40, 0.96, 0.18]},
  B748: {icaoType: 'B748', displayName: 'Boeing 747-8', modelClass: 'heavy4', wingSpanM: 68.4, lengthM: 76.3, engines: 4, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.40, 0.96, 0.18]},
  E190: {icaoType: 'E190', displayName: 'Embraer E190', modelClass: 'narrowbody', wingSpanM: 28.7, lengthM: 36.2, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  E75L: {icaoType: 'E75L', displayName: 'Embraer E175', modelClass: 'narrowbody', wingSpanM: 28.7, lengthM: 31.7, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  CRJ9: {icaoType: 'CRJ9', displayName: 'Bombardier CRJ-900', modelClass: 'rearjet', wingSpanM: 24.9, lengthM: 36.2, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  DH8D: {icaoType: 'DH8D', displayName: 'De Havilland Dash 8-Q400', modelClass: 'turboprop', wingSpanM: 28.4, lengthM: 32.8, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  AT76: {icaoType: 'AT76', displayName: 'ATR 72-600', modelClass: 'turboprop', wingSpanM: 27.1, lengthM: 27.2, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.14]},
  GLF6: {icaoType: 'GLF6', displayName: 'Gulfstream G650', modelClass: 'bizjet', wingSpanM: 30.4, lengthM: 30.4, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.44, 0.96, 0.12]},
  C172: {icaoType: 'C172', displayName: 'Cessna 172 Skyhawk', modelClass: 'lightprop', wingSpanM: 11.0, lengthM: 8.3, engines: 1, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.44, 0.96, 0.12]},
  C17: {icaoType: 'C17', displayName: 'Boeing C-17 Globemaster III', modelClass: 'milcargo', wingSpanM: 51.8, lengthM: 53.0, engines: 4, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.42, 0.96, 0.15]},
  EC35: {icaoType: 'EC35', displayName: 'Airbus H135', modelClass: 'heli', wingSpanM: 10.2, lengthM: 12.2, engines: 2, tailUvRect: [0.68, 0.06, 0.28, 0.28], stripeUvRect: [0.02, 0.44, 0.96, 0.12]},
};

export const AIRLINES_MANIFEST: Record<string, AirlineManifestEntry> = {
  UAL: {icao: 'UAL', iata: 'UA', displayName: 'United Airlines', primaryHex: '#002244', secondaryHex: '#005DAA', accentHex: '#60A5FA', tailStyle: 'fulltail', motifText: 'UNITED'},
  DAL: {icao: 'DAL', iata: 'DL', displayName: 'Delta Air Lines', primaryHex: '#003366', secondaryHex: '#C8102E', accentHex: '#E11D48', tailStyle: 'fulltail', motifText: 'DELTA'},
  AAL: {icao: 'AAL', iata: 'AA', displayName: 'American Airlines', primaryHex: '#1D4ED8', secondaryHex: '#DC2626', accentHex: '#94A3B8', tailStyle: 'stripe', motifText: 'AA'},
  SWA: {icao: 'SWA', iata: 'WN', displayName: 'Southwest Airlines', primaryHex: '#1D4ED8', secondaryHex: '#E11D48', accentHex: '#F59E0B', tailStyle: 'fulltail', motifText: 'SWA'},
  JBU: {icao: 'JBU', iata: 'B6', displayName: 'JetBlue Airways', primaryHex: '#003876', secondaryHex: '#00A3E0', accentHex: '#38BDF8', tailStyle: 'fulltail', motifText: 'jetBlue'},
  ASA: {icao: 'ASA', iata: 'AS', displayName: 'Alaska Airlines', primaryHex: '#01426A', secondaryHex: '#41B6E6', accentHex: '#10B981', tailStyle: 'wave', motifText: 'ALASKA'},
  ACA: {icao: 'ACA', iata: 'AC', displayName: 'Air Canada', primaryHex: '#0F172A', secondaryHex: '#D8292F', accentHex: '#DC2626', tailStyle: 'fulltail', motifText: 'AIR CANADA'},
  BAW: {icao: 'BAW', iata: 'BA', displayName: 'British Airways', primaryHex: '#075AAA', secondaryHex: '#D81E05', accentHex: '#1D4ED8', tailStyle: 'wave', motifText: 'SPEEDMARQUE'},
  VIR: {icao: 'VIR', iata: 'VS', displayName: 'Virgin Atlantic', primaryHex: '#C8102E', secondaryHex: '#4C0519', accentHex: '#F43F5E', tailStyle: 'fulltail', motifText: 'VIRGIN'},
  DLH: {icao: 'DLH', iata: 'LH', displayName: 'Lufthansa', primaryHex: '#05164D', secondaryHex: '#FFAD00', accentHex: '#FACC15', tailStyle: 'fulltail', motifText: 'LUFTHANSA'},
  AFR: {icao: 'AFR', iata: 'AF', displayName: 'Air France', primaryHex: '#002157', secondaryHex: '#ED1C24', accentHex: '#EF4444', tailStyle: 'stripe', motifText: 'AIR FRANCE'},
  KLM: {icao: 'KLM', iata: 'KL', displayName: 'KLM Royal Dutch', primaryHex: '#00A1DE', secondaryHex: '#003145', accentHex: '#38BDF8', tailStyle: 'cheatline', motifText: 'KLM'},
  SWR: {icao: 'SWR', iata: 'LX', displayName: 'SWISS', primaryHex: '#D52B1E', secondaryHex: '#991B1B', accentHex: '#FFFFFF', tailStyle: 'fulltail', motifText: 'SWISS'},
  RYR: {icao: 'RYR', iata: 'FR', displayName: 'Ryanair', primaryHex: '#073590', secondaryHex: '#F1C933', accentHex: '#FACC15', tailStyle: 'fulltail', motifText: 'RYANAIR'},
  EZY: {icao: 'EZY', iata: 'U2', displayName: 'easyJet', primaryHex: '#FF6600', secondaryHex: '#EA580C', accentHex: '#FDBA74', tailStyle: 'billboard', motifText: 'easyJet'},
  UAE: {icao: 'UAE', iata: 'EK', displayName: 'Emirates', primaryHex: '#D71921', secondaryHex: '#007A3D', accentHex: '#C59B27', tailStyle: 'fulltail', motifText: 'EMIRATES'},
  QTR: {icao: 'QTR', iata: 'QR', displayName: 'Qatar Airways', primaryHex: '#5C0632', secondaryHex: '#881337', accentHex: '#D1D5DB', tailStyle: 'fulltail', motifText: 'QATAR'},
  ETD: {icao: 'ETD', iata: 'EY', displayName: 'Etihad Airways', primaryHex: '#8A6E4B', secondaryHex: '#433829', accentHex: '#D4AF37', tailStyle: 'wave', motifText: 'ETIHAD'},
  THY: {icao: 'THY', iata: 'TK', displayName: 'Turkish Airlines', primaryHex: '#C8102E', secondaryHex: '#0F172A', accentHex: '#EF4444', tailStyle: 'fulltail', motifText: 'TURKISH'},
  SIA: {icao: 'SIA', iata: 'SQ', displayName: 'Singapore Airlines', primaryHex: '#1D2951', secondaryHex: '#F4A900', accentHex: '#FBBF24', tailStyle: 'fulltail', motifText: 'SINGAPORE'},
  CPA: {icao: 'CPA', iata: 'CX', displayName: 'Cathay Pacific', primaryHex: '#006564', secondaryHex: '#064E3B', accentHex: '#A7F3D0', tailStyle: 'wave', motifText: 'CATHAY'},
  ANA: {icao: 'ANA', iata: 'NH', displayName: 'All Nippon Airways', primaryHex: '#003893', secondaryHex: '#0081C8', accentHex: '#38BDF8', tailStyle: 'wave', motifText: 'ANA'},
  JAL: {icao: 'JAL', iata: 'JL', displayName: 'Japan Airlines', primaryHex: '#CC0000', secondaryHex: '#111827', accentHex: '#EF4444', tailStyle: 'eurowhite', motifText: 'JAL'},
  KAL: {icao: 'KAL', iata: 'KE', displayName: 'Korean Air', primaryHex: '#0091D5', secondaryHex: '#00256C', accentHex: '#DC2626', tailStyle: 'fulltail', motifText: 'KOREAN'},
  QFA: {icao: 'QFA', iata: 'QF', displayName: 'Qantas', primaryHex: '#E40000', secondaryHex: '#991B1B', accentHex: '#F8FAFC', tailStyle: 'fulltail', motifText: 'QANTAS'},
  ANZ: {icao: 'ANZ', iata: 'NZ', displayName: 'Air New Zealand', primaryHex: '#0F172A', secondaryHex: '#06B6D4', accentHex: '#E2E8F0', tailStyle: 'fulltail', motifText: 'AIR NZ'},
  CCA: {icao: 'CCA', iata: 'CA', displayName: 'Air China', primaryHex: '#C8102E', secondaryHex: '#1D4ED8', accentHex: '#FACC15', tailStyle: 'cheatline', motifText: 'AIR CHINA'},
  CSN: {icao: 'CSN', iata: 'CZ', displayName: 'China Southern', primaryHex: '#0072CE', secondaryHex: '#E11D48', accentHex: '#38BDF8', tailStyle: 'fulltail', motifText: 'CSN'},
  CES: {icao: 'CES', iata: 'MU', displayName: 'China Eastern', primaryHex: '#C8102E', secondaryHex: '#1D4ED8', accentHex: '#E11D48', tailStyle: 'eurowhite', motifText: 'MU'},
  FDX: {icao: 'FDX', iata: 'FX', displayName: 'FedEx Express', primaryHex: '#4D148C', secondaryHex: '#FF6600', accentHex: '#F97316', tailStyle: 'fulltail', motifText: 'FedEx'},
  UPS: {icao: 'UPS', iata: '5X', displayName: 'UPS Airlines', primaryHex: '#351C15', secondaryHex: '#FFB500', accentHex: '#F59E0B', tailStyle: 'fulltail', motifText: 'UPS'},
  GTI: {icao: 'GTI', iata: '5Y', displayName: 'Atlas Air', primaryHex: '#002E6D', secondaryHex: '#F59E0B', accentHex: '#FBBF24', tailStyle: 'fulltail', motifText: 'ATLAS'},
};

export function resolveAirlineManifest(airlineIcao?: string, callsign?: string): AirlineManifestEntry {
  const clean = (airlineIcao || (callsign ?? '').slice(0, 3)).toUpperCase().replace(/[^A-Z]/g, '');
  const exact = AIRLINES_MANIFEST[clean];
  if (exact) return exact;
  const fallback = resolveAirlineLivery(airlineIcao || '', callsign);
  return {
    icao: clean || fallback.icao || 'GEN',
    iata: fallback.iata || clean.slice(0, 2) || 'GN',
    displayName: fallback.name,
    primaryHex: fallback.tailHex || fallback.fuselageHex || '#1D4ED8',
    secondaryHex: fallback.accentHex || '#38BDF8',
    accentHex: fallback.accentHex || '#F59E0B',
    tailStyle: 'cheatline',
    motifText: clean || fallback.icao || 'SKY',
  };
}
