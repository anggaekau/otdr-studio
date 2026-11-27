import { computeCrc16CcittFalse } from './crc16';
import { ExtraBlock, FxdParams, GenParams, KeyEventsBlock, SorDocument, SorVersion, SupParams } from './types';

const utf8Encoder = new TextEncoder();

class BinaryWriter {
  private buf: number[] = [];

  writeUint8(v: number): void {
    this.buf.push(v & 0xff);
  }

  writeUint16(v: number): void {
    const val = Math.round(v) & 0xffff;
    this.buf.push(val & 0xff, (val >> 8) & 0xff);
  }

  writeInt16(v: number): void {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(v)));
    this.writeUint16(clamped & 0xffff);
  }

  writeUint32(v: number): void {
    const val = Math.round(v) >>> 0;
    this.buf.push(val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff);
  }

  writeInt32(v: number): void {
    const clamped = Math.max(-2147483648, Math.min(2147483647, Math.round(v)));
    this.writeUint32(clamped >>> 0);
  }

  writeFixedAscii(str: string, length: number, padChar = ' '): void {
    const encoded = utf8Encoder.encode(str);
    for (let i = 0; i < length; i++) {
      this.buf.push(i < encoded.length ? encoded[i] : padChar.charCodeAt(0));
    }
  }

  writeCStr(str: string): void {
    const encoded = utf8Encoder.encode(str);
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] !== 0) this.buf.push(encoded[i]);
    }
    this.buf.push(0);
  }

  writeBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      this.buf.push(bytes[i]);
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

function writeBlockPrefix(w: BinaryWriter, blockId: string, version: SorVersion): void {
  if (version === 2) {
    w.writeCStr(blockId);
  }
}

function serializeGenParams(g: GenParams, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, 'GenParams', version);
  w.writeFixedAscii(g.languageCode || 'EN', 2);
  w.writeCStr(g.cableId);
  w.writeCStr(g.fiberId);
  if (version === 2) {
    w.writeUint16(g.fiberType);
  }
  w.writeUint16(g.nominalWavelength);
  w.writeCStr(g.originatingLocation);
  w.writeCStr(g.terminatingLocation);
  w.writeCStr(g.cableCode);
  w.writeFixedAscii(g.currentDataFlag || 'BC', 2);
  w.writeInt32(g.userOffset);
  if (version === 2) {
    w.writeInt32(g.userOffsetDistance);
  }
  w.writeCStr(g.operator);
  w.writeCStr(g.comments);
  return w.toUint8Array();
}

function serializeSupParams(s: SupParams, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, 'SupParams', version);
  w.writeCStr(s.supplierName);
  w.writeCStr(s.otdrMainframeId);
  w.writeCStr(s.otdrMainframeSerial);
  w.writeCStr(s.opticalModuleId);
  w.writeCStr(s.opticalModuleSerial);
  w.writeCStr(s.softwareVersion);
  w.writeCStr(s.other);
  return w.toUint8Array();
}

function serializeFxdParams(f: FxdParams, numPoints: number, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, 'FxdParams', version);

  const entries =
    f.pulseEntries.length > 0
      ? f.pulseEntries.map((entry, idx) =>
          idx === 0 ? { ...entry, numDataPoints: numPoints } : entry
        )
      : [{ pulseWidthNs: 100, dataSpacing: 489672, numDataPoints: numPoints }];

  w.writeUint32(f.timestamp);
  w.writeFixedAscii(f.units || 'km', 2);
  w.writeUint16(Math.round(f.actualWavelengthNm * 10));
  w.writeInt32(f.acquisitionOffset);
  if (version === 2) {
    w.writeInt32(f.acquisitionOffsetDistance);
  }

  w.writeUint16(entries.length);
  for (const e of entries) w.writeUint16(e.pulseWidthNs);
  for (const e of entries) w.writeUint32(e.dataSpacing);
  for (const e of entries) w.writeUint32(e.numDataPoints);

  w.writeUint32(Math.round(f.groupIndex * 100000));
  w.writeUint16(Math.round(Math.abs(f.backscatterCoeffDb) * 10));
  w.writeUint32(f.numAverages);
  if (version === 2) {
    w.writeUint16(Math.round(f.averagingTimeSec * 10));
  }
  w.writeUint32(f.acquisitionRange);
  if (version === 2) {
    w.writeInt32(f.acquisitionRangeDistance);
  }
  w.writeInt32(f.frontPanelOffset);
  w.writeUint16(Math.round(Math.abs(f.noiseFloorLevelDb) * 1000));
  w.writeInt16(f.noiseFloorScaleFactor || 1000);
  w.writeUint16(Math.round(Math.max(0, f.powerOffsetFirstPointDb) * 1000));
  w.writeUint16(Math.round(Math.max(0, f.lossThresholdDb) * 1000));
  w.writeUint16(Math.round(Math.abs(f.reflectanceThresholdDb) * 1000));
  w.writeUint16(Math.round(Math.max(0, f.endOfFiberThresholdDb) * 1000));

  if (version === 2) {
    w.writeFixedAscii(f.traceType || 'ST', 2);
    for (let i = 0; i < 4; i++) {
      w.writeInt32(f.windowCoordinates[i] ?? 0);
    }
  }

  return w.toUint8Array();
}

function serializeKeyEvents(k: KeyEventsBlock, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, 'KeyEvents', version);

  w.writeUint16(k.events.length);
  for (let idx = 0; idx < k.events.length; idx++) {
    const ev = k.events[idx];
    w.writeUint16(ev.eventNumber || idx + 1);
    w.writeUint32(ev.propagationTime);
    w.writeInt16(Math.round(ev.attenuationCoeffDbKm * 1000));
    w.writeInt16(Math.round(ev.eventLossDb * 1000));
    w.writeInt32(Math.round(ev.eventReflectanceDb * 1000));
    w.writeFixedAscii(ev.eventCode || '0F9999', 6, '9');
    w.writeFixedAscii(ev.lossMeasurementTechnique || '2P', 2, ' ');
    if (version === 2) {
      for (let m = 0; m < 5; m++) {
        w.writeInt32(ev.markerLocations[m] ?? 0);
      }
    }
    w.writeCStr(ev.comment || '');
  }

  w.writeInt32(Math.round(k.endToEndLossDb * 1000));
  w.writeInt32(k.endToEndMarkerStart);
  w.writeInt32(k.endToEndMarkerEnd);
  w.writeUint16(Math.round(Math.max(0, k.opticalReturnLossDb) * 1000));
  w.writeInt32(k.orlMarkerStart);
  w.writeInt32(k.orlMarkerEnd);

  return w.toUint8Array();
}

function serializeDataPts(rawPoints: number[], scalingFactor: number, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, 'DataPts', version);

  w.writeUint32(rawPoints.length);
  w.writeUint16(1); // 1 trace
  w.writeUint32(rawPoints.length);
  w.writeUint16(scalingFactor || 1000);
  for (let i = 0; i < rawPoints.length; i++) {
    const clamped = Math.max(0, Math.min(65535, Math.round(rawPoints[i])));
    w.writeUint16(clamped);
  }
  return w.toUint8Array();
}

function serializeExtraBlock(block: ExtraBlock, version: SorVersion): Uint8Array {
  const w = new BinaryWriter();
  writeBlockPrefix(w, block.id, version);
  w.writeBytes(block.payload);
  return w.toUint8Array();
}

export interface SerializeOptions {
  includeExtraBlocks?: boolean;
  targetVersion?: SorVersion;
}

export function serializeSorDocument(doc: SorDocument, options: SerializeOptions = {}): Uint8Array {
  const version: SorVersion = options.targetVersion ?? doc.version;
  const includeExtra = options.includeExtraBlocks ?? true;
  const revNumber = version === 2 ? Math.max(200, doc.revisionNumber || 200) : Math.min(199, doc.revisionNumber || 100);

  const rawPts = doc.dataPts.rawPoints;
  const blocksMap = new Map<string, { revision: number; data: Uint8Array }>();

  blocksMap.set('GenParams', {
    revision: revNumber,
    data: serializeGenParams(doc.genParams, version),
  });
  blocksMap.set('SupParams', {
    revision: revNumber,
    data: serializeSupParams(doc.supParams, version),
  });
  blocksMap.set('FxdParams', {
    revision: revNumber,
    data: serializeFxdParams(doc.fxdParams, rawPts.length, version),
  });
  blocksMap.set('KeyEvents', {
    revision: revNumber,
    data: serializeKeyEvents(doc.keyEvents, version),
  });
  blocksMap.set('DataPts', {
    revision: revNumber,
    data: serializeDataPts(rawPts, doc.dataPts.scalingFactor, version),
  });

  if (includeExtra) {
    for (const eb of doc.extraBlocks) {
      blocksMap.set(eb.id, {
        revision: eb.revision || revNumber,
        data: serializeExtraBlock(eb, version),
      });
    }
  }

  // Cksum placeholder (2 bytes after optional v2 "Cksum\0")
  const cksumPrefixLen = version === 2 ? 'Cksum'.length + 1 : 0;
  const cksumBlockSize = cksumPrefixLen + 2;

  // Build ordered block list (preserving original order where possible, Cksum always last)
  const orderedIds: string[] = [];
  const baseOrder = doc.blockOrder.length > 0 ? doc.blockOrder : ['GenParams', 'SupParams', 'FxdParams', 'KeyEvents', 'DataPts'];
  for (const id of baseOrder) {
    if (id !== 'Cksum' && blocksMap.has(id) && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }
  for (const id of blocksMap.keys()) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  orderedIds.push('Cksum');

  // Build Map block
  const entriesWriter = new BinaryWriter();
  for (const id of orderedIds) {
    entriesWriter.writeCStr(id);
    if (id === 'Cksum') {
      entriesWriter.writeUint16(revNumber);
      entriesWriter.writeUint32(cksumBlockSize);
    } else {
      const blk = blocksMap.get(id)!;
      entriesWriter.writeUint16(blk.revision);
      entriesWriter.writeUint32(blk.data.length);
    }
  }
  const entriesBytes = entriesWriter.toUint8Array();

  const mapPrefixLen = version === 2 ? 4 : 0; // "Map\0"
  const mapBlockSize = mapPrefixLen + 2 + 4 + 2 + entriesBytes.length;

  const mapWriter = new BinaryWriter();
  if (version === 2) {
    mapWriter.writeCStr('Map');
  }
  mapWriter.writeUint16(revNumber);
  mapWriter.writeUint32(mapBlockSize);
  mapWriter.writeUint16(orderedIds.length + 1); // includes Map itself
  mapWriter.writeBytes(entriesBytes);
  const mapBytes = mapWriter.toUint8Array();

  // Compute total file length
  let totalSize = mapBytes.length;
  for (const id of orderedIds) {
    totalSize += id === 'Cksum' ? cksumBlockSize : blocksMap.get(id)!.data.length;
  }

  const out = new Uint8Array(totalSize);
  let pos = 0;
  out.set(mapBytes, pos);
  pos += mapBytes.length;

  for (const id of orderedIds) {
    if (id === 'Cksum') {
      if (version === 2) {
        const cksumHdr = utf8Encoder.encode('Cksum\0');
        out.set(cksumHdr, pos);
        pos += cksumHdr.length;
      }
      const crc = computeCrc16CcittFalse(out, pos);
      out[pos] = crc & 0xff;
      out[pos + 1] = (crc >> 8) & 0xff;
      pos += 2;
    } else {
      const blkBytes = blocksMap.get(id)!.data;
      out.set(blkBytes, pos);
      pos += blkBytes.length;
    }
  }

  return out;
}
