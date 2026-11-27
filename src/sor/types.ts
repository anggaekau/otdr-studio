export type SorVersion = 1 | 2;

export type DistanceUnit = 'km' | 'mt' | 'ft' | 'kf' | 'mi';

export interface MapBlockEntry {
  id: string;
  revision: number;
  size: number;
}

export interface GenParams {
  languageCode: string; // 2 chars e.g. 'EN'
  cableId: string;
  fiberId: string;
  fiberType: number; // e.g. 652 for G.652
  nominalWavelength: number; // nm, e.g. 1550
  originatingLocation: string;
  terminatingLocation: string;
  cableCode: string;
  currentDataFlag: string; // 2 chars e.g. 'BC'
  userOffset: number; // 100 ps
  userOffsetDistance: number; // in distance units
  operator: string;
  comments: string;
}

export interface SupParams {
  supplierName: string;
  otdrMainframeId: string;
  otdrMainframeSerial: string;
  opticalModuleId: string;
  opticalModuleSerial: string;
  softwareVersion: string;
  other: string;
}

export interface PulseWidthEntry {
  pulseWidthNs: number; // uint16
  dataSpacing: number; // uint32 (100 ps per 10,000 points)
  numDataPoints: number; // uint32
}

export interface FxdParams {
  timestamp: number; // Unix seconds UTC
  units: DistanceUnit;
  actualWavelengthNm: number; // stored as 0.1 nm uint16
  acquisitionOffset: number; // int32 (100 ps)
  acquisitionOffsetDistance: number; // int32
  pulseEntries: PulseWidthEntry[];
  groupIndex: number; // e.g. 1.46800 (stored as uint32 * 100000)
  backscatterCoeffDb: number; // e.g. -79.4 (stored as uint16 * -0.1)
  numAverages: number; // uint32
  averagingTimeSec: number; // stored as uint16 * 0.1
  acquisitionRange: number; // uint32 (100 ps)
  acquisitionRangeDistance: number; // int32
  frontPanelOffset: number; // int32 (100 ps)
  noiseFloorLevelDb: number; // stored as uint16 * -0.001
  noiseFloorScaleFactor: number; // int16, typically 1000
  powerOffsetFirstPointDb: number; // stored as uint16 * 0.001
  lossThresholdDb: number; // stored as uint16 * 0.001
  reflectanceThresholdDb: number; // stored as uint16 * -0.001
  endOfFiberThresholdDb: number; // stored as uint16 * 0.001
  traceType: string; // 2 chars e.g. 'ST'
  windowCoordinates: [number, number, number, number];
}

export type EventKind =
  | 'non-reflective' // splice / macrobend
  | 'reflective' // connector / mechanical splice
  | 'saturated'
  | 'end-of-fiber'
  | 'other';

export interface KeyEvent {
  eventNumber: number;
  propagationTime: number; // 100 ps (1-way)
  attenuationCoeffDbKm: number; // dB/km (stored as int16 * 0.001)
  eventLossDb: number; // dB (stored as int16 * 0.001)
  eventReflectanceDb: number; // dB (stored as int32 * 0.001, negative or 0)
  eventCode: string; // 6 ASCII chars e.g. '0F9999', '1F9999', '1E9999'
  lossMeasurementTechnique: string; // 2 ASCII chars e.g. '2P', 'LS'
  markerLocations: [number, number, number, number, number]; // 5 * int32 (100 ps)
  comment: string;
}

export interface KeyEventsBlock {
  events: KeyEvent[];
  endToEndLossDb: number; // int32 * 0.001
  endToEndMarkerStart: number; // int32 (100 ps)
  endToEndMarkerEnd: number; // int32 (100 ps)
  opticalReturnLossDb: number; // uint16 * 0.001
  orlMarkerStart: number; // int32 (100 ps)
  orlMarkerEnd: number; // int32 (100 ps)
}

export interface DataPtsBlock {
  scalingFactor: number; // typically 1000
  /** Raw uint16 trace values (0 = highest power, 65535 = lowest power) */
  rawPoints: number[];
}

export interface ExtraBlock {
  id: string;
  revision: number;
  /** Payload bytes excluding the v2 "BlockId\0" prefix */
  payload: Uint8Array;
}

export interface SorDocument {
  version: SorVersion;
  revisionNumber: number; // e.g. 200 or 100
  fileName: string;
  genParams: GenParams;
  supParams: SupParams;
  fxdParams: FxdParams;
  keyEvents: KeyEventsBlock;
  dataPts: DataPtsBlock;
  extraBlocks: ExtraBlock[];
  checksumInfo: {
    present: boolean;
    stored: number;
    computed: number;
    valid: boolean;
  };
  /** Block order encountered in original Map */
  blockOrder: string[];
}
