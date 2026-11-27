import { computeCrc16CcittFalse } from './crc16';
import {
  DataPtsBlock,
  DistanceUnit,
  ExtraBlock,
  FxdParams,
  GenParams,
  KeyEvent,
  KeyEventsBlock,
  MapBlockEntry,
  PulseWidthEntry,
  SorDocument,
  SorVersion,
  SupParams,
} from './types';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  public offset: number;
  private end: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = start;
    this.end = end;
  }

  get remaining(): number {
    return Math.max(0, this.end - this.offset);
  }

  ensure(n: number, context: string): void {
    if (this.offset + n > this.end) {
      throw new Error(`Unexpected end of block while reading ${context} (need ${n} bytes, have ${this.remaining})`);
    }
  }

  readUint8(): number {
    this.ensure(1, 'uint8');
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readUint16(): number {
    this.ensure(2, 'uint16');
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readInt16(): number {
    this.ensure(2, 'int16');
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint32(): number {
    this.ensure(4, 'uint32');
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readInt32(): number {
    this.ensure(4, 'int32');
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFixedAscii(length: number): string {
    this.ensure(length, `ascii(${length})`);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return utf8Decoder.decode(slice).replace(/\0+$/, '');
  }

  readCStr(): string {
    let endIdx = this.offset;
    while (endIdx < this.end && this.bytes[endIdx] !== 0) {
      endIdx++;
    }
    const slice = this.bytes.subarray(this.offset, endIdx);
    this.offset = endIdx < this.end ? endIdx + 1 : endIdx;
    return utf8Decoder.decode(slice);
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length, `bytes(${length})`);
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  peekString(expected: string): boolean {
    const needed = expected.length + 1;
    if (this.offset + needed > this.end) return false;
    for (let i = 0; i < expected.length; i++) {
      if (this.bytes[this.offset + i] !== expected.charCodeAt(i)) return false;
    }
    return this.bytes[this.offset + expected.length] === 0;
  }
}

function normalizeUnit(u: string): DistanceUnit {
  const clean = u.trim().toLowerCase();
  if (clean === 'km' || clean === 'mt' || clean === 'ft' || clean === 'kf' || clean === 'mi') {
    return clean;
  }
  return 'km';
}

function stripBlockHeaderIfV2(reader: BinaryReader, blockId: string, version: SorVersion): void {
  if (version === 2 && reader.peekString(blockId)) {
    reader.readCStr();
  }
}

function parseGenParams(bytes: Uint8Array, start: number, end: number, version: SorVersion): GenParams {
  const r = new BinaryReader(bytes, start, end);
  stripBlockHeaderIfV2(r, 'GenParams', version);

  const languageCode = r.readFixedAscii(2);
  const cableId = r.readCStr();
  const fiberId = r.readCStr();
  const fiberType = version === 2 ? r.readUint16() : 652;
  const nominalWavelength = r.readUint16();
  const originatingLocation = r.readCStr();
  const terminatingLocation = r.readCStr();
  const cableCode = r.readCStr();
  const currentDataFlag = r.readFixedAscii(2);
  const userOffset = r.readInt32();
  const userOffsetDistance = version === 2 && r.remaining >= 4 ? r.readInt32() : 0;
  const operator = r.remaining > 0 ? r.readCStr() : '';
  const comments = r.remaining > 0 ? r.readCStr() : '';

  return {
    languageCode,
    cableId,
    fiberId,
    fiberType,
    nominalWavelength,
    originatingLocation,
    terminatingLocation,
    cableCode,
    currentDataFlag,
    userOffset,
    userOffsetDistance,
    operator,
    comments,
  };
}

function parseSupParams(bytes: Uint8Array, start: number, end: number, version: SorVersion): SupParams {
  const r = new BinaryReader(bytes, start, end);
  stripBlockHeaderIfV2(r, 'SupParams', version);

  const readOpt = () => (r.remaining > 0 ? r.readCStr() : '');
  return {
    supplierName: readOpt(),
    otdrMainframeId: readOpt(),
    otdrMainframeSerial: readOpt(),
    opticalModuleId: readOpt(),
    opticalModuleSerial: readOpt(),
    softwareVersion: readOpt(),
    other: readOpt(),
  };
}

function parseFxdParams(bytes: Uint8Array, start: number, end: number, version: SorVersion): FxdParams {
  const r = new BinaryReader(bytes, start, end);
  stripBlockHeaderIfV2(r, 'FxdParams', version);

  const timestamp = r.readUint32();
  const units = normalizeUnit(r.readFixedAscii(2));
  const actualWavelengthNm = r.readUint16() / 10;
  const acquisitionOffset = r.readInt32();
  const acquisitionOffsetDistance = version === 2 ? r.readInt32() : 0;

  const numPulseWidths = Math.max(1, r.readUint16());
  const pulseWidths: number[] = [];
  const dataSpacings: number[] = [];
  const numDataPointsPerPulse: number[] = [];

  for (let i = 0; i < numPulseWidths; i++) {
    pulseWidths.push(r.readUint16());
  }
  for (let i = 0; i < numPulseWidths; i++) {
    dataSpacings.push(r.readUint32());
  }
  for (let i = 0; i < numPulseWidths; i++) {
    numDataPointsPerPulse.push(r.readUint32());
  }

  const pulseEntries: PulseWidthEntry[] = [];
  for (let i = 0; i < numPulseWidths; i++) {
    pulseEntries.push({
      pulseWidthNs: pulseWidths[i],
      dataSpacing: dataSpacings[i],
      numDataPoints: numDataPointsPerPulse[i],
    });
  }

  const groupIndex = r.readUint32() / 100000;
  const backscatterCoeffDb = -(r.readUint16() / 10);
  const numAverages = r.readUint32();
  const averagingTimeSec = version === 2 ? r.readUint16() / 10 : 0;
  const acquisitionRange = r.readUint32();
  const acquisitionRangeDistance = version === 2 ? r.readInt32() : 0;
  const frontPanelOffset = r.readInt32();
  const noiseFloorLevelDb = -(r.readUint16() / 1000);
  const noiseFloorScaleFactor = r.readInt16();
  const powerOffsetFirstPointDb = r.readUint16() / 1000;
  const lossThresholdDb = r.readUint16() / 1000;
  const reflectanceThresholdDb = -(r.readUint16() / 1000);
  const endOfFiberThresholdDb = r.readUint16() / 1000;

  const traceType = version === 2 && r.remaining >= 2 ? r.readFixedAscii(2) : 'ST';
  const windowCoordinates: [number, number, number, number] =
    version === 2 && r.remaining >= 16
      ? [r.readInt32(), r.readInt32(), r.readInt32(), r.readInt32()]
      : [0, 0, 0, 0];

  return {
    timestamp,
    units,
    actualWavelengthNm,
    acquisitionOffset,
    acquisitionOffsetDistance,
    pulseEntries,
    groupIndex,
    backscatterCoeffDb,
    numAverages,
    averagingTimeSec,
    acquisitionRange,
    acquisitionRangeDistance,
    frontPanelOffset,
    noiseFloorLevelDb,
    noiseFloorScaleFactor,
    powerOffsetFirstPointDb,
    lossThresholdDb,
    reflectanceThresholdDb,
    endOfFiberThresholdDb,
    traceType,
    windowCoordinates,
  };
}

function parseKeyEvents(bytes: Uint8Array, start: number, end: number, version: SorVersion): KeyEventsBlock {
  const r = new BinaryReader(bytes, start, end);
  stripBlockHeaderIfV2(r, 'KeyEvents', version);

  const numEvents = r.readUint16();
  const events: KeyEvent[] = [];

  for (let i = 0; i < numEvents; i++) {
    const eventNumber = r.readUint16();
    const propagationTime = r.readUint32();
    const attenuationCoeffDbKm = r.readInt16() / 1000;
    const eventLossDb = r.readInt16() / 1000;
    const eventReflectanceDb = r.readInt32() / 1000;
    const eventCode = r.readFixedAscii(6);
    const lossMeasurementTechnique = r.readFixedAscii(2);
    const markerLocations: [number, number, number, number, number] =
      version === 2
        ? [r.readInt32(), r.readInt32(), r.readInt32(), r.readInt32(), r.readInt32()]
        : [0, 0, 0, 0, 0];
    const comment = r.remaining > 0 ? r.readCStr() : '';

    events.push({
      eventNumber,
      propagationTime,
      attenuationCoeffDbKm,
      eventLossDb,
      eventReflectanceDb,
      eventCode,
      lossMeasurementTechnique,
      markerLocations,
      comment,
    });
  }

  const endToEndLossDb = r.remaining >= 4 ? r.readInt32() / 1000 : 0;
  const endToEndMarkerStart = r.remaining >= 4 ? r.readInt32() : 0;
  const endToEndMarkerEnd = r.remaining >= 4 ? r.readInt32() : 0;
  const opticalReturnLossDb = r.remaining >= 2 ? r.readUint16() / 1000 : 0;
  const orlMarkerStart = r.remaining >= 4 ? r.readInt32() : 0;
  const orlMarkerEnd = r.remaining >= 4 ? r.readInt32() : 0;

  return {
    events,
    endToEndLossDb,
    endToEndMarkerStart,
    endToEndMarkerEnd,
    opticalReturnLossDb,
    orlMarkerStart,
    orlMarkerEnd,
  };
}

function parseDataPts(bytes: Uint8Array, start: number, end: number, version: SorVersion): DataPtsBlock {
  const r = new BinaryReader(bytes, start, end);
  stripBlockHeaderIfV2(r, 'DataPts', version);

  const totalPoints = r.readUint32();
  const numTraces = Math.max(1, r.readInt16());

  let scalingFactor = 1000;
  let rawPoints: number[] = [];

  for (let t = 0; t < numTraces; t++) {
    const numInTrace = r.readUint32();
    const traceScaling = r.readUint16();
    const count = Math.min(numInTrace || totalPoints, Math.floor(r.remaining / 2));
    const pts = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      pts[i] = r.readUint16();
    }
    if (t === 0) {
      scalingFactor = traceScaling || 1000;
      rawPoints = pts;
    }
  }

  return {
    scalingFactor,
    rawPoints,
  };
}

export function parseSorBuffer(buffer: ArrayBuffer, fileName = 'trace.sor'): SorDocument {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) {
    throw new Error('File terlalu kecil untuk format .sor yang valid.');
  }

  const r = new BinaryReader(bytes, 0, bytes.length);
  const isV2 = r.peekString('Map');
  const version: SorVersion = isV2 ? 2 : 1;
  if (isV2) {
    r.readCStr();
  }

  const revisionNumber = r.readUint16();
  const mapBlockSize = r.readUint32();
  const numBlocks = r.readUint16();

  if (numBlocks < 2 || numBlocks > 128) {
    throw new Error(`Jumlah blok tidak valid dalam Map: ${numBlocks}`);
  }
  if (mapBlockSize > bytes.length) {
    throw new Error(`Ukuran blok Map (${mapBlockSize}) melebihi ukuran file (${bytes.length}).`);
  }

  const entries: MapBlockEntry[] = [];
  for (let i = 0; i < numBlocks - 1; i++) {
    const id = r.readCStr();
    const revision = r.readUint16();
    const size = r.readUint32();
    entries.push({ id, revision, size });
  }

  let cursor = mapBlockSize;
  let genParams: GenParams | null = null;
  let supParams: SupParams | null = null;
  let fxdParams: FxdParams | null = null;
  let keyEvents: KeyEventsBlock | null = null;
  let dataPts: DataPtsBlock | null = null;
  const extraBlocks: ExtraBlock[] = [];
  const blockOrder: string[] = [];

  let checksumInfo = {
    present: false,
    stored: 0,
    computed: 0,
    valid: true,
  };

  for (const entry of entries) {
    const blockStart = cursor;
    const blockEnd = cursor + entry.size;
    if (blockEnd > bytes.length) {
      throw new Error(
        `Blok "${entry.id}" melebihi panjang file (offset ${blockStart} + ${entry.size} > ${bytes.length}).`
      );
    }
    blockOrder.push(entry.id);

    switch (entry.id) {
      case 'GenParams':
        genParams = parseGenParams(bytes, blockStart, blockEnd, version);
        break;
      case 'SupParams':
        supParams = parseSupParams(bytes, blockStart, blockEnd, version);
        break;
      case 'FxdParams':
        fxdParams = parseFxdParams(bytes, blockStart, blockEnd, version);
        break;
      case 'KeyEvents':
        keyEvents = parseKeyEvents(bytes, blockStart, blockEnd, version);
        break;
      case 'DataPts':
        dataPts = parseDataPts(bytes, blockStart, blockEnd, version);
        break;
      case 'Cksum': {
        const cr = new BinaryReader(bytes, blockStart, blockEnd);
        stripBlockHeaderIfV2(cr, 'Cksum', version);
        const cksumPos = cr.offset;
        const stored = cr.readUint16();
        const computed = computeCrc16CcittFalse(bytes, cksumPos);
        checksumInfo = {
          present: true,
          stored,
          computed,
          valid: stored === computed,
        };
        break;
      }
      default: {
        const er = new BinaryReader(bytes, blockStart, blockEnd);
        stripBlockHeaderIfV2(er, entry.id, version);
        extraBlocks.push({
          id: entry.id,
          revision: entry.revision,
          payload: bytes.slice(er.offset, blockEnd),
        });
        break;
      }
    }

    cursor = blockEnd;
  }

  if (!fxdParams || !dataPts) {
    throw new Error('File .sor tidak memiliki blok wajib FxdParams atau DataPts.');
  }

  return {
    version,
    revisionNumber,
    fileName,
    genParams: genParams ?? {
      languageCode: 'EN',
      cableId: '',
      fiberId: '',
      fiberType: 652,
      nominalWavelength: Math.round(fxdParams.actualWavelengthNm),
      originatingLocation: '',
      terminatingLocation: '',
      cableCode: '',
      currentDataFlag: 'BC',
      userOffset: 0,
      userOffsetDistance: 0,
      operator: '',
      comments: '',
    },
    supParams: supParams ?? {
      supplierName: '',
      otdrMainframeId: '',
      otdrMainframeSerial: '',
      opticalModuleId: '',
      opticalModuleSerial: '',
      softwareVersion: '',
      other: '',
    },
    fxdParams,
    keyEvents: keyEvents ?? {
      events: [],
      endToEndLossDb: 0,
      endToEndMarkerStart: 0,
      endToEndMarkerEnd: 0,
      opticalReturnLossDb: 0,
      orlMarkerStart: 0,
      orlMarkerEnd: 0,
    },
    dataPts,
    extraBlocks,
    checksumInfo,
    blockOrder,
  };
}
