import { EventKind, KeyEvent, SorDocument } from './types';

/** Speed of light in vacuum in m/us */
export const SPEED_OF_LIGHT_M_PER_US = 299.792458;

/**
 * Convert 1-way propagation time (in units of 100 ps = 1e-4 us) to physical distance in meters.
 */
export function propTimeToMeters(propTime100ps: number, groupIndex: number): number {
  if (groupIndex <= 0) return 0;
  return (propTime100ps * 1e-4 * SPEED_OF_LIGHT_M_PER_US) / groupIndex;
}

/**
 * Convert physical distance in meters to 1-way propagation time (in units of 100 ps).
 */
export function metersToPropTime(meters: number, groupIndex: number): number {
  if (groupIndex <= 0) return 0;
  return Math.round((meters * groupIndex) / (SPEED_OF_LIGHT_M_PER_US * 1e-4));
}

/**
 * Convert raw FxdParams dataSpacing (100 ps per 10,000 points) to distance per sample in meters.
 */
export function dataSpacingToMeters(dataSpacing: number, groupIndex: number): number {
  if (groupIndex <= 0) return 0;
  return (dataSpacing * 1e-8 * SPEED_OF_LIGHT_M_PER_US) / groupIndex;
}

/**
 * Convert distance per sample in meters to raw FxdParams dataSpacing (100 ps per 10,000 points).
 */
export function metersToDataSpacing(dxMeters: number, groupIndex: number): number {
  if (groupIndex <= 0) return 0;
  return Math.max(1, Math.round((dxMeters * groupIndex) / (SPEED_OF_LIGHT_M_PER_US * 1e-8)));
}

/**
 * Convert raw DataPts uint16 value to attenuation/power in dB (0 dB at top, negative downward).
 */
export function rawPointToDb(raw: number, scalingFactor: number): number {
  const scale = scalingFactor > 0 ? scalingFactor : 1000;
  return -(raw * scale) / 1_000_000;
}

/**
 * Convert power in dB (0 to -65.5 dB) to raw DataPts uint16 value.
 */
export function dbToRawPoint(db: number, scalingFactor: number): number {
  const scale = scalingFactor > 0 ? scalingFactor : 1000;
  const raw = Math.round((-db * 1_000_000) / scale);
  return Math.max(0, Math.min(65535, raw));
}

export function getSampleSpacingMeters(doc: SorDocument): number {
  const entry = doc.fxdParams.pulseEntries[0];
  if (!entry) return 1;
  return dataSpacingToMeters(entry.dataSpacing, doc.fxdParams.groupIndex);
}

export function getTotalTraceLengthMeters(doc: SorDocument): number {
  const dx = getSampleSpacingMeters(doc);
  const count = doc.dataPts.rawPoints.length;
  if (count <= 1) return 0;
  return (count - 1) * dx;
}

export function classifyEventCode(eventCode: string): EventKind {
  const code = (eventCode || '').padEnd(6, ' ');
  const first = code[0];
  const second = code[1];
  if (second === 'E' || code.includes('E')) return 'end-of-fiber';
  if (first === '1') return 'reflective';
  if (first === '2') return 'saturated';
  if (first === '0') return 'non-reflective';
  return 'other';
}

export function formatEventTypeLabel(ev: KeyEvent): string {
  const kind = classifyEventCode(ev.eventCode);
  switch (kind) {
    case 'end-of-fiber':
      return 'End of Fiber';
    case 'reflective':
      return 'Reflective (Connector)';
    case 'saturated':
      return 'Saturated Reflection';
    case 'non-reflective':
      return 'Non-Reflective (Splice)';
    default:
      return 'Event';
  }
}

export const FIBER_TYPES: { code: number; label: string }[] = [
  { code: 652, label: 'ITU-T G.652 (Standard SMF)' },
  { code: 653, label: 'ITU-T G.653 (DSF)' },
  { code: 654, label: 'ITU-T G.654 (Cut-off Shifted)' },
  { code: 655, label: 'ITU-T G.655 (NZDSF)' },
  { code: 657, label: 'ITU-T G.657 (Bend-Insensitive)' },
  { code: 651, label: 'ITU-T G.651 (Multimode 50/125)' },
  { code: 0, label: 'Unspecified' },
];
