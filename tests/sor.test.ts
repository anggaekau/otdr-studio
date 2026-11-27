import { describe, expect, it } from 'vitest';
import { computeCrc16CcittFalse } from '../src/sor/crc16';
import { getTotalTraceLengthMeters, propTimeToMeters, rawPointToDb } from '../src/sor/constants';
import {
  addEventWithTraceEffect,
  adjustSegmentSlope,
  changeFiberLength,
  deleteEventWithTraceEffect,
  shiftTraceVerticalDb,
  updateEventAtIndex,
} from '../src/sor/editor';
import { getSampleSpacingMeters } from '../src/sor/constants';
import { parseSorBuffer } from '../src/sor/parser';
import { buildOtdrPdfReport } from '../src/sor/pdfReport';
import { createSampleSorDocument } from '../src/sor/sampleGenerator';
import { serializeSorDocument } from '../src/sor/writer';

describe('CRC-16/CCITT-FALSE', () => {
  it('matches standard test vector 123456789 -> 0x29B1', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(computeCrc16CcittFalse(bytes)).toBe(0x29b1);
  });
});

describe('SOR Parser & Writer round-trip', () => {
  it('serializes and parses v2 sample document with valid CRC-16', () => {
    const sample = createSampleSorDocument('metro-18km');
    const binary = serializeSorDocument(sample);
    const parsed = parseSorBuffer(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), 'test.sor');

    expect(parsed.version).toBe(2);
    expect(parsed.checksumInfo.present).toBe(true);
    expect(parsed.checksumInfo.valid).toBe(true);
    expect(parsed.genParams.cableId).toBe(sample.genParams.cableId);
    expect(parsed.genParams.originatingLocation).toBe(sample.genParams.originatingLocation);
    expect(parsed.supParams.supplierName).toBe(sample.supParams.supplierName);
    expect(parsed.fxdParams.timestamp).toBe(sample.fxdParams.timestamp);
    expect(parsed.fxdParams.actualWavelengthNm).toBeCloseTo(1550, 1);
    expect(parsed.fxdParams.groupIndex).toBeCloseTo(1.4682, 5);
    expect(parsed.keyEvents.events.length).toBe(sample.keyEvents.events.length);
    expect(parsed.dataPts.rawPoints.length).toBe(sample.dataPts.rawPoints.length);
  });

  it('serializes and parses v1 format cleanly', () => {
    const sample = createSampleSorDocument('ftth-4km');
    const v1Binary = serializeSorDocument(sample, { targetVersion: 1 });
    const parsed = parseSorBuffer(
      v1Binary.buffer.slice(v1Binary.byteOffset, v1Binary.byteOffset + v1Binary.byteLength),
      'v1_test.sor'
    );

    expect(parsed.version).toBe(1);
    expect(parsed.checksumInfo.valid).toBe(true);
    expect(parsed.genParams.cableId).toBe(sample.genParams.cableId);
    expect(parsed.keyEvents.events.length).toBe(sample.keyEvents.events.length);
    expect(parsed.dataPts.rawPoints.length).toBe(sample.dataPts.rawPoints.length);
  });

  it('preserves or strips extra vendor blocks based on option', () => {
    const sample = createSampleSorDocument('metro-18km');
    sample.extraBlocks = [
      {
        id: 'VendorProp',
        revision: 200,
        payload: new Uint8Array([1, 2, 3, 4, 5, 6]),
      },
    ];
    sample.blockOrder = ['GenParams', 'SupParams', 'FxdParams', 'KeyEvents', 'DataPts', 'VendorProp', 'Cksum'];

    const withExtra = serializeSorDocument(sample, { includeExtraBlocks: true });
    const parsedWith = parseSorBuffer(withExtra.buffer.slice(withExtra.byteOffset, withExtra.byteOffset + withExtra.byteLength));
    expect(parsedWith.checksumInfo.valid).toBe(true);
    expect(parsedWith.extraBlocks.length).toBe(1);
    expect(parsedWith.extraBlocks[0].id).toBe('VendorProp');
    expect(Array.from(parsedWith.extraBlocks[0].payload)).toEqual([1, 2, 3, 4, 5, 6]);

    const withoutExtra = serializeSorDocument(sample, { includeExtraBlocks: false });
    const parsedWithout = parseSorBuffer(
      withoutExtra.buffer.slice(withoutExtra.byteOffset, withoutExtra.byteOffset + withoutExtra.byteLength)
    );
    expect(parsedWithout.checksumInfo.valid).toBe(true);
    expect(parsedWithout.extraBlocks.length).toBe(0);
  });
});

describe('SOR Editor operations', () => {
  it('edits metadata, timestamp, length, events, and trace curve then round-trips validly', () => {
    let doc = createSampleSorDocument('metro-18km');

    // Edit metadata & timestamp
    doc.genParams.cableId = 'CUSTOM-CABLE-99';
    doc.genParams.operator = 'Budi';
    doc.fxdParams.timestamp = 1764200000;

    // Rescale length from 22km to 30km
    doc = changeFiberLength(doc, 30000, 'rescale-spacing');
    expect(getTotalTraceLengthMeters(doc)).toBeCloseTo(30000, -1);

    // Truncate/extend to 25km
    doc = changeFiberLength(doc, 25000, 'truncate-extend', { moveEndEventToNewLength: true });
    expect(getTotalTraceLengthMeters(doc)).toBeCloseTo(25000, -2);

    // Add a reflective event at 12,000 m with 0.8 dB loss
    const beforeCount = doc.keyEvents.events.length;
    doc = addEventWithTraceEffect(doc, {
      distanceMeters: 12000,
      kind: 'reflective',
      eventLossDb: 0.8,
      eventReflectanceDb: -40.0,
      attenuationCoeffDbKm: 0.22,
      comment: 'New Connector Added',
      modifyTrace: true,
    });
    expect(doc.keyEvents.events.length).toBe(beforeCount + 1);
    const addedEv = doc.keyEvents.events.find((e) => e.comment === 'New Connector Added');
    expect(addedEv).toBeDefined();
    expect(propTimeToMeters(addedEv!.propagationTime, doc.fxdParams.groupIndex)).toBeCloseTo(12000, -1);

    // Delete an event and heal trace
    const targetIdx = doc.keyEvents.events.findIndex((e) => e.comment === 'New Connector Added');
    doc = deleteEventWithTraceEffect(doc, targetIdx, true);
    expect(doc.keyEvents.events.length).toBe(beforeCount);

    // Shift vertical dB & adjust slope
    const beforeFirstDb = rawPointToDb(doc.dataPts.rawPoints[10], doc.dataPts.scalingFactor);
    doc = shiftTraceVerticalDb(doc, 2.0);
    const afterFirstDb = rawPointToDb(doc.dataPts.rawPoints[10], doc.dataPts.scalingFactor);
    expect(afterFirstDb - beforeFirstDb).toBeCloseTo(2.0, 2);

    doc = adjustSegmentSlope(doc, 2000, 8000, 0.35);

    // Serialize & re-parse
    const outBytes = serializeSorDocument(doc);
    const reparsed = parseSorBuffer(outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength));
    expect(reparsed.checksumInfo.valid).toBe(true);
    expect(reparsed.genParams.cableId).toBe('CUSTOM-CABLE-99');
    expect(reparsed.genParams.operator).toBe('Budi');
    expect(reparsed.fxdParams.timestamp).toBe(1764200000);
  });

  it('shifts end-of-fiber spike and noise floor when last event (even 1F9999) distance is changed', () => {
    let doc = createSampleSorDocument('ftth-4km');
    const lastIdx = doc.keyEvents.events.length - 1;
    // Simulate real OTDR marking last drop-to-noise event with 1F9999
    doc.keyEvents.events[lastIdx].eventCode = '1F9999';

    const dx = getSampleSpacingMeters(doc);
    const scale = doc.dataPts.scalingFactor;

    // 1) Shorten last event from 4260 m to 3000 m
    doc = updateEventAtIndex(doc, lastIdx, { distanceMeters: 3000 }, false, true);
    const evShort = doc.keyEvents.events[lastIdx];
    expect(propTimeToMeters(evShort.propagationTime, doc.fxdParams.groupIndex)).toBeCloseTo(3000, -1);

    const idxAt3400 = Math.round(3400 / dx);
    const idxAt2600 = Math.round(2600 / dx);
    const dbAt3400 = rawPointToDb(doc.dataPts.rawPoints[idxAt3400], scale);
    const dbAt2600 = rawPointToDb(doc.dataPts.rawPoints[idxAt2600], scale);
    // 3400 m should now be down in the noise floor (~ -41 dB), far below 2600 m (~ -10 dB)
    expect(dbAt2600 - dbAt3400).toBeGreaterThan(20);

    // 2) Extend last event from 3000 m to 4800 m
    doc = updateEventAtIndex(doc, lastIdx, { distanceMeters: 4800 }, false, true);
    const idxAt4200 = Math.round(4200 / dx);
    const dbAt4200 = rawPointToDb(doc.dataPts.rawPoints[idxAt4200], scale);
    // 4200 m should now be restored back to fiber level (close to 2600 m level, NOT noise floor!)
    expect(Math.abs(dbAt2600 - dbAt4200)).toBeLessThan(3);

    const idxAt5100 = Math.round(5100 / dx);
    const dbAt5100 = rawPointToDb(doc.dataPts.rawPoints[idxAt5100], scale);
    expect(dbAt4200 - dbAt5100).toBeGreaterThan(20);
  });

  it('keeps upstream markers, updates cross-referenced markers & ORL end, and skips launch deadzone in E2E loss', () => {
    let doc = createSampleSorDocument('ftth-4km');
    const lastIdx = doc.keyEvents.events.length - 1;
    const oldLastProp = doc.keyEvents.events[lastIdx].propagationTime;

    // Simulate Yokogawa-style cross-referenced markers and launch deadzone peak
    doc.keyEvents.events[0].markerLocations = [0, 0, 1075, oldLastProp, 325];
    doc.keyEvents.events[lastIdx].markerLocations = [1075, oldLastProp, oldLastProp + 350, oldLastProp + 350, oldLastProp + 75];
    doc.keyEvents.events[lastIdx].eventCode = '1F9999';

    // Shorten last event to 3000 m
    doc = updateEventAtIndex(doc, lastIdx, { distanceMeters: 3000 }, false, true);
    const newLastProp = doc.keyEvents.events[lastIdx].propagationTime;

    // E2E loss should reflect realistic fiber + splice losses (~1.6 - 2.2 dB), NOT inflated by launch peak
    expect(doc.keyEvents.endToEndLossDb).toBeLessThan(3.5);
    expect(doc.keyEvents.endToEndLossDb).toBeGreaterThan(0.5);

    // Cross-referenced markers & ORL End should track the moved event
    expect(doc.keyEvents.events[0].markerLocations[3]).toBe(newLastProp);
    expect(doc.keyEvents.events[lastIdx].markerLocations[0]).toBe(1075);
    expect(doc.keyEvents.events[lastIdx].markerLocations[1]).toBe(newLastProp);
    expect(doc.keyEvents.orlMarkerEnd).toBe(newLastProp);
    expect(doc.keyEvents.endToEndMarkerEnd).toBe(newLastProp);
  });

  it('generates a valid PDF report document', () => {
    const sample = createSampleSorDocument('metro-18km');
    const pdf = buildOtdrPdfReport(sample);
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
