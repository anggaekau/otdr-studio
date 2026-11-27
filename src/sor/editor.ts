import {
  classifyEventCode,
  dataSpacingToMeters,
  dbToRawPoint,
  getSampleSpacingMeters,
  metersToDataSpacing,
  metersToPropTime,
  propTimeToMeters,
  rawPointToDb,
} from './constants';
import { EventKind, KeyEvent, SorDocument } from './types';

export function cloneSorDocument(doc: SorDocument): SorDocument {
  return {
    ...doc,
    genParams: { ...doc.genParams },
    supParams: { ...doc.supParams },
    fxdParams: {
      ...doc.fxdParams,
      pulseEntries: doc.fxdParams.pulseEntries.map((e) => ({ ...e })),
      windowCoordinates: [...doc.fxdParams.windowCoordinates] as [number, number, number, number],
    },
    keyEvents: {
      ...doc.keyEvents,
      events: doc.keyEvents.events.map((ev) => ({
        ...ev,
        markerLocations: [...ev.markerLocations] as [number, number, number, number, number],
      })),
    },
    dataPts: {
      ...doc.dataPts,
      rawPoints: [...doc.dataPts.rawPoints],
    },
    extraBlocks: doc.extraBlocks.map((eb) => ({
      ...eb,
      payload: new Uint8Array(eb.payload),
    })),
    checksumInfo: { ...doc.checksumInfo },
    blockOrder: [...doc.blockOrder],
  };
}

function clampRaw(v: number): number {
  return Math.max(0, Math.min(65535, Math.round(v)));
}

function dbDeltaToRawDelta(deltaDb: number, scalingFactor: number): number {
  const scale = scalingFactor > 0 ? scalingFactor : 1000;
  // Positive lossDb means lower optical power -> larger raw value
  return (deltaDb * 1_000_000) / scale;
}

export function sortAndRenumberEvents(events: KeyEvent[]): KeyEvent[] {
  const sorted = [...events].sort((a, b) => a.propagationTime - b.propagationTime);
  return sorted.map((ev, i) => ({
    ...ev,
    eventNumber: i + 1,
  }));
}

function computeUpdatedAcqRangeDistance(
  oldRange: number,
  oldDist: number,
  newRange: number,
  units: string,
  newTotalMeters: number
): number {
  if (oldRange > 0 && oldDist > 0) {
    return Math.max(1, Math.round(oldDist * (newRange / oldRange)));
  }
  return Math.round(units === 'km' ? newTotalMeters / 1000 : newTotalMeters);
}

export function recomputeKeyEventsSummary(doc: SorDocument): SorDocument {
  const next = cloneSorDocument(doc);
  const events = sortAndRenumberEvents(next.keyEvents.events);
  next.keyEvents.events = events;

  const scale = next.dataPts.scalingFactor || 1000;
  const pts = next.dataPts.rawPoints;
  const dx = getSampleSpacingMeters(next);
  const ior = next.fxdParams.groupIndex || 1.468;

  if (events.length >= 2) {
    const firstEv = events[0];
    const lastEv = events[events.length - 1];
    next.keyEvents.endToEndMarkerStart = firstEv.propagationTime;
    next.keyEvents.endToEndMarkerEnd = lastEv.propagationTime;
    next.keyEvents.orlMarkerStart = firstEv.propagationTime;
    next.keyEvents.orlMarkerEnd = lastEv.propagationTime;

    const i1 = Math.min(pts.length - 1, Math.max(0, Math.round(propTimeToMeters(firstEv.propagationTime, ior) / dx)));
    const i2 = Math.min(pts.length - 1, Math.max(0, Math.round(propTimeToMeters(lastEv.propagationTime, ior) / dx)));
    if (pts.length > 0 && i2 > i1 + 4) {
      // Skip launch deadzone / reflection peak if i1 sits inside a high-power launch artifact
      let iStartClean = i1;
      const plateauRefIdx = Math.min(i2 - 8, i1 + 80);
      const plateauRefRaw = medianOfSlice(pts, plateauRefIdx, Math.min(i2 - 4, plateauRefIdx + 20));
      const deadzoneThresholdRaw = dbDeltaToRawDelta(0.5, scale);

      if (i2 - i1 > 40 && pts[i1] < plateauRefRaw - deadzoneThresholdRaw) {
        const scanLimit = Math.min(i2 - 16, i1 + 220);
        const stepTolRaw = dbDeltaToRawDelta(0.06, scale);
        for (let k = i1 + 8; k <= scanLimit; k++) {
          const localMed = medianOfSlice(pts, k, k + 8);
          const nextMed = medianOfSlice(pts, k + 12, k + 20);
          if (Math.abs(nextMed - localMed) <= stepTolRaw && localMed >= plateauRefRaw - dbDeltaToRawDelta(0.4, scale)) {
            iStartClean = k;
            break;
          }
        }
        if (iStartClean === i1) {
          iStartClean = Math.min(i2 - 12, i1 + 60);
        }
      }

      const dbStartClean = rawPointToDb(medianOfSlice(pts, iStartClean, Math.min(i2 - 6, iStartClean + 10)), scale);
      const endWinRight = Math.max(iStartClean + 1, i2 - 4);
      const endWinLeft = Math.max(iStartClean + 1, i2 - 12);
      const dbEndClean = rawPointToDb(medianOfSlice(pts, endWinLeft, endWinRight), scale);

      // Extrapolate small fiber attenuation over the skipped deadzone & pre-spike margin
      const slopeGuess =
        lastEv.attenuationCoeffDbKm > 0 && lastEv.attenuationCoeffDbKm < 3
          ? lastEv.attenuationCoeffDbKm
          : 0.25;
      const skippedMeters = Math.max(0, (iStartClean - i1) + (i2 - (endWinLeft + endWinRight) / 2)) * dx;
      const extrapDb = (skippedMeters / 1000) * slopeGuess;
      const launchLossDb = iStartClean > i1 ? Math.max(0, firstEv.eventLossDb) : 0;

      next.keyEvents.endToEndLossDb = Number(
        Math.max(0, dbStartClean - dbEndClean + extrapDb + launchLossDb).toFixed(3)
      );
    }
  } else if (events.length === 1) {
    next.keyEvents.endToEndLossDb = Number(Math.max(0, events[0].eventLossDb).toFixed(3));
  } else {
    next.keyEvents.endToEndLossDb = 0;
  }

  return next;
}

export type LengthEditMode = 'truncate-extend' | 'rescale-spacing';

export function changeFiberLength(
  doc: SorDocument,
  newLengthMeters: number,
  mode: LengthEditMode,
  options: {
    extendSlopeDbKm?: number;
    moveEndEventToNewLength?: boolean;
  } = {}
): SorDocument {
  const next = cloneSorDocument(doc);
  const safeMeters = Math.max(10, newLengthMeters);
  const pts = next.dataPts.rawPoints;
  const scale = next.dataPts.scalingFactor || 1000;
  const ior = next.fxdParams.groupIndex || 1.468;

  if (pts.length < 2) return next;

  const oldDx = getSampleSpacingMeters(next);
  const oldTotalMeters = (pts.length - 1) * oldDx;

  if (mode === 'rescale-spacing') {
    const newDx = safeMeters / (pts.length - 1);
    const newDataSpacing = metersToDataSpacing(newDx, ior);
    if (next.fxdParams.pulseEntries.length > 0) {
      next.fxdParams.pulseEntries[0].dataSpacing = newDataSpacing;
      next.fxdParams.pulseEntries[0].numDataPoints = pts.length;
    }
    const actualNewDx = dataSpacingToMeters(newDataSpacing, ior);
    const actualTotalMeters = (pts.length - 1) * actualNewDx;
    const ratio = oldTotalMeters > 0 ? actualTotalMeters / oldTotalMeters : 1;

    const oldAcqRng = next.fxdParams.acquisitionRange;
    const oldAcqRngD = next.fxdParams.acquisitionRangeDistance;
    const newAcqRng = metersToPropTime(actualTotalMeters, ior);
    next.fxdParams.acquisitionRange = newAcqRng;
    next.fxdParams.acquisitionRangeDistance = computeUpdatedAcqRangeDistance(
      oldAcqRng,
      oldAcqRngD,
      newAcqRng,
      next.fxdParams.units,
      actualTotalMeters
    );

    next.keyEvents.events = next.keyEvents.events.map((ev) => ({
      ...ev,
      propagationTime: Math.round(ev.propagationTime * ratio),
      markerLocations: ev.markerLocations.map((m) => Math.round(m * ratio)) as [
        number,
        number,
        number,
        number,
        number,
      ],
    }));

    return recomputeKeyEventsSummary(next);
  }

  // mode === 'truncate-extend'
  const targetCount = Math.max(20, Math.round(safeMeters / oldDx) + 1);
  const oldCount = pts.length;

  if (targetCount < oldCount) {
    next.dataPts.rawPoints = pts.slice(0, targetCount);
    const maxPropTime = metersToPropTime((targetCount - 1) * oldDx, ior);

    const endEvents = next.keyEvents.events.filter((e) => classifyEventCode(e.eventCode) === 'end-of-fiber');
    let filtered = next.keyEvents.events.filter((e) => e.propagationTime <= maxPropTime);

    if (options.moveEndEventToNewLength && endEvents.length > 0 && filtered.every((e) => classifyEventCode(e.eventCode) !== 'end-of-fiber')) {
      const lastEnd = { ...endEvents[endEvents.length - 1] };
      lastEnd.propagationTime = Math.round(maxPropTime * 0.92);
      filtered.push(lastEnd);
    }
    next.keyEvents.events = sortAndRenumberEvents(filtered);
  } else if (targetCount > oldCount) {
    const slopeDbKm = options.extendSlopeDbKm ?? 0.35;
    const endIdx = next.keyEvents.events.findIndex((e) => classifyEventCode(e.eventCode) === 'end-of-fiber');
    const lastSample = pts[oldCount - 1];
    const noiseRaw = dbToRawPoint(next.fxdParams.noiseFloorLevelDb || -45, scale);
    const hasNoiseTail = Math.abs(lastSample - noiseRaw) < 2500 && endIdx >= 0;

    // If extending a trace that ended at noise floor and user wants to move EOF, interpolate before EOF
    if (options.moveEndEventToNewLength && endIdx >= 0) {
      const eofEv = next.keyEvents.events[endIdx];
      const eofIdx = Math.min(
        oldCount - 2,
        Math.max(1, Math.round(propTimeToMeters(eofEv.propagationTime, ior) / oldDx))
      );
      const baseRaw = pts[Math.max(0, eofIdx - 5)];
      const addedCount = targetCount - oldCount;
      const newEofIdx = eofIdx + addedCount;

      const extended: number[] = [];
      for (let i = 0; i < eofIdx; i++) extended.push(pts[i]);
      const rawPerPoint = dbDeltaToRawDelta((slopeDbKm * oldDx) / 1000, scale);
      for (let i = 0; i < addedCount; i++) {
        const jitter = Math.sin(i * 1.7) * 28 + Math.cos(i * 0.53) * 18;
        extended.push(clampRaw(baseRaw + i * rawPerPoint + jitter));
      }
      // Re-append the original EOF spike & tail
      for (let i = eofIdx; i < oldCount; i++) {
        const deltaFromBase = pts[i] - baseRaw;
        extended.push(clampRaw(baseRaw + addedCount * rawPerPoint + deltaFromBase));
      }

      next.dataPts.rawPoints = extended.slice(0, targetCount);
      next.keyEvents.events[endIdx] = {
        ...eofEv,
        propagationTime: metersToPropTime(newEofIdx * oldDx, ior),
      };
    } else {
      const extended = [...pts];
      const rawPerPoint = hasNoiseTail ? 0 : dbDeltaToRawDelta((slopeDbKm * oldDx) / 1000, scale);
      for (let i = oldCount; i < targetCount; i++) {
        const step = i - oldCount + 1;
        const jitter = Math.sin(i * 1.9) * 35 + Math.cos(i * 0.7) * 22;
        extended.push(clampRaw(lastSample + step * rawPerPoint + jitter));
      }
      next.dataPts.rawPoints = extended;
    }
  }

  if (next.fxdParams.pulseEntries.length > 0) {
    next.fxdParams.pulseEntries[0].numDataPoints = next.dataPts.rawPoints.length;
  }
  const finalLengthMeters = (next.dataPts.rawPoints.length - 1) * oldDx;
  const oldAcqRng = next.fxdParams.acquisitionRange;
  const oldAcqRngD = next.fxdParams.acquisitionRangeDistance;
  const newAcqRng = metersToPropTime(finalLengthMeters, ior);
  next.fxdParams.acquisitionRange = newAcqRng;
  next.fxdParams.acquisitionRangeDistance = computeUpdatedAcqRangeDistance(
    oldAcqRng,
    oldAcqRngD,
    newAcqRng,
    next.fxdParams.units,
    finalLengthMeters
  );

  return recomputeKeyEventsSummary(next);
}

export interface NewEventParams {
  distanceMeters: number;
  kind: EventKind;
  eventLossDb: number;
  eventReflectanceDb: number;
  attenuationCoeffDbKm: number;
  comment: string;
  modifyTrace: boolean;
}

export function addEventWithTraceEffect(doc: SorDocument, params: NewEventParams): SorDocument {
  const next = cloneSorDocument(doc);
  const ior = next.fxdParams.groupIndex || 1.468;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;
  const propTime = metersToPropTime(params.distanceMeters, ior);

  let eventCode = '0A9999';
  if (params.kind === 'reflective') eventCode = '1A9999';
  else if (params.kind === 'end-of-fiber') eventCode = '1E9999';
  else if (params.kind === 'saturated') eventCode = '2A9999';

  const newEvent: KeyEvent = {
    eventNumber: next.keyEvents.events.length + 1,
    propagationTime: propTime,
    attenuationCoeffDbKm: params.attenuationCoeffDbKm,
    eventLossDb: params.eventLossDb,
    eventReflectanceDb: params.kind === 'non-reflective' ? 0 : params.eventReflectanceDb,
    eventCode,
    lossMeasurementTechnique: '2P',
    markerLocations: [propTime - 500, propTime - 200, propTime, propTime + 300, propTime + 600],
    comment: params.comment,
  };

  next.keyEvents.events = sortAndRenumberEvents([...next.keyEvents.events, newEvent]);

  if (params.modifyTrace && next.dataPts.rawPoints.length > 0) {
    const pts = next.dataPts.rawPoints;
    const idx = Math.min(pts.length - 1, Math.max(0, Math.round(params.distanceMeters / dx)));
    const pulseMeters = Math.max(dx * 2, ((next.fxdParams.pulseEntries[0]?.pulseWidthNs ?? 100) * 0.1));
    const halfWidthPts = Math.max(2, Math.min(18, Math.round(pulseMeters / dx)));

    if (params.kind === 'end-of-fiber') {
      const spikeDb = Math.max(3, 14 + (params.eventReflectanceDb + 45) * 0.25);
      const spikeRawDelta = dbDeltaToRawDelta(spikeDb, scale);
      const baseRaw = pts[Math.max(0, idx - 2)];
      for (let i = Math.max(0, idx - 2); i <= Math.min(pts.length - 1, idx + halfWidthPts); i++) {
        const dist = (i - idx) / Math.max(1, halfWidthPts * 0.5);
        const gauss = Math.exp(-dist * dist * 1.4);
        pts[i] = clampRaw(baseRaw - gauss * spikeRawDelta);
      }
      const noiseRaw = dbToRawPoint(next.fxdParams.noiseFloorLevelDb || -45, scale);
      for (let i = idx + halfWidthPts + 1; i < pts.length; i++) {
        const jitter = Math.sin(i * 2.1) * 45 + Math.cos(i * 0.87) * 30;
        pts[i] = clampRaw(noiseRaw + jitter);
      }
    } else {
      const stepDeltaRaw = dbDeltaToRawDelta(params.eventLossDb, scale);
      // Apply step loss after event center
      for (let i = idx + 1; i < pts.length; i++) {
        const ramp = i < idx + halfWidthPts ? (i - idx) / halfWidthPts : 1;
        pts[i] = clampRaw(pts[i] + stepDeltaRaw * ramp);
      }
      // Inject Fresnel reflection spike if reflective
      if (params.kind === 'reflective' || params.kind === 'saturated') {
        const peakDb = params.kind === 'saturated' ? 16 : Math.max(2.5, 11 + (params.eventReflectanceDb + 45) * 0.25);
        const peakRawDelta = dbDeltaToRawDelta(peakDb, scale);
        const baseRaw = pts[Math.max(0, idx - 1)];
        for (let i = Math.max(0, idx - 1); i <= Math.min(pts.length - 1, idx + halfWidthPts); i++) {
          const t = (i - idx) / Math.max(1, halfWidthPts * 0.45);
          const spike = Math.exp(-t * t * 1.3) * peakRawDelta;
          if (spike > 80) {
            pts[i] = clampRaw(Math.min(pts[i], baseRaw - spike));
          }
        }
      }
    }
  }

  return recomputeKeyEventsSummary(next);
}

export function deleteEventWithTraceEffect(
  doc: SorDocument,
  eventIndex: number,
  healTrace: boolean
): SorDocument {
  const next = cloneSorDocument(doc);
  const target = next.keyEvents.events[eventIndex];
  if (!target) return next;

  const ior = next.fxdParams.groupIndex || 1.468;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;
  const pts = next.dataPts.rawPoints;

  if (healTrace && pts.length > 4) {
    const idx = Math.min(pts.length - 1, Math.max(0, Math.round(propTimeToMeters(target.propagationTime, ior) / dx)));
    const pulseMeters = Math.max(dx * 2, ((next.fxdParams.pulseEntries[0]?.pulseWidthNs ?? 100) * 0.1));
    const halfWidthPts = Math.max(3, Math.min(20, Math.round(pulseMeters / dx)));

    // Compensate downstream step loss
    const stepDeltaRaw = dbDeltaToRawDelta(target.eventLossDb, scale);
    for (let i = idx + 1; i < pts.length; i++) {
      pts[i] = clampRaw(pts[i] - stepDeltaRaw);
    }

    // Smooth across the spike window [idx - 2 .. idx + halfWidthPts + 2]
    const wStart = Math.max(0, idx - 2);
    const wEnd = Math.min(pts.length - 1, idx + halfWidthPts + 2);
    if (wEnd > wStart) {
      const leftVal = pts[wStart];
      const rightVal = pts[wEnd];
      for (let i = wStart; i <= wEnd; i++) {
        const frac = (i - wStart) / (wEnd - wStart);
        const jitter = Math.sin(i * 1.7) * 18;
        pts[i] = clampRaw(leftVal + (rightVal - leftVal) * frac + jitter);
      }
    }
  }

  next.keyEvents.events.splice(eventIndex, 1);
  next.keyEvents.events = sortAndRenumberEvents(next.keyEvents.events);
  return recomputeKeyEventsSummary(next);
}

function medianOfSlice(arr: number[], start: number, end: number): number {
  const s = Math.max(0, start);
  const e = Math.min(arr.length - 1, end);
  if (e < s) return arr[Math.max(0, Math.min(arr.length - 1, s))] ?? 0;
  const sub = arr.slice(s, e + 1).sort((a, b) => a - b);
  return sub[Math.floor(sub.length / 2)];
}

function moveEventTraceFeature(
  next: SorDocument,
  eventIndex: number,
  oldPropTime: number,
  newPropTime: number
): void {
  const pts = next.dataPts.rawPoints;
  if (pts.length < 20) return;

  const ior = next.fxdParams.groupIndex || 1.468;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;
  const ev = next.keyEvents.events[eventIndex];
  if (!ev) return;

  const oldIdx = Math.max(1, Math.min(pts.length - 2, Math.round(propTimeToMeters(oldPropTime, ior) / dx)));
  let newIdx = Math.max(1, Math.round(propTimeToMeters(newPropTime, ior) / dx));
  if (oldIdx === newIdx) return;

  // Estimate pre-event fiber baseline
  const basePreRaw = medianOfSlice(pts, oldIdx - 20, oldIdx - 6);

  // Detect pre-event noise amplitude for natural fiber extension
  let preDiffSum = 0;
  let preDiffCount = 0;
  for (let i = Math.max(1, oldIdx - 30); i < Math.max(2, oldIdx - 6); i++) {
    preDiffSum += Math.abs(pts[i] - pts[i - 1]);
    preDiffCount++;
  }
  const fiberJitterRaw = preDiffCount > 0 ? Math.min(180, Math.max(12, preDiffSum / preDiffCount)) : 25;

  // Check if this event drops to the noise floor (End-of-Fiber behavior, even if eventCode is 1F9999)
  const isLastEvent = eventIndex === next.keyEvents.events.length - 1;
  const farTailStart = Math.min(pts.length - 1, oldIdx + 40);
  const farTailEnd = Math.min(pts.length - 1, oldIdx + 140);
  const tailRaw = medianOfSlice(pts, farTailStart, farTailEnd);
  const dropToTailRaw = tailRaw - basePreRaw; // positive means power dropped significantly
  const isDropToNoise =
    classifyEventCode(ev.eventCode) === 'end-of-fiber' ||
    (isLastEvent && dropToTailRaw > dbDeltaToRawDelta(2.0, scale));

  // Locate spike start just before oldIdx
  let spikeStart = oldIdx;
  const tolRaw = dbDeltaToRawDelta(0.45, scale);
  for (let i = oldIdx; i >= Math.max(0, oldIdx - 18); i--) {
    if (Math.abs(pts[i] - basePreRaw) <= tolRaw) {
      spikeStart = i;
      break;
    }
    spikeStart = i;
  }

  // Locate spike end after oldIdx
  const targetAfterRaw = isDropToTailTarget(isDropToTailRawOrLoss(isDropToNoise, tailRaw, basePreRaw, ev.eventLossDb, scale));
  function isDropToTailRawOrLoss(
    dropNoise: boolean,
    tRaw: number,
    bRaw: number,
    lossDb: number,
    sc: number
  ): number {
    return dropNoise ? tRaw : bRaw + dbDeltaToRawDelta(lossDb, sc);
  }
  function isDropToTailTarget(val: number): number {
    return val;
  }

  let spikeEnd = Math.min(pts.length - 1, oldIdx + 6);
  const settleTol = dbDeltaToRawDelta(isDropToNoise ? 1.8 : 0.45, scale);
  let settledCount = 0;
  for (let i = oldIdx + 1; i < Math.min(pts.length, oldIdx + 90); i++) {
    const nearTarget = isDropToNoise
      ? pts[i] >= targetAfterRaw - settleTol
      : Math.abs(pts[i] - targetAfterRaw) <= settleTol;
    if (nearTarget) {
      settledCount++;
      if (settledCount >= 3) {
        spikeEnd = i - 2;
        break;
      }
    } else {
      settledCount = 0;
    }
    spikeEnd = i;
  }
  spikeEnd = Math.max(oldIdx + 2, spikeEnd);

  const preOffset = oldIdx - spikeStart;
  const spikeLen = spikeEnd - spikeStart + 1;
  const spikeDelta = new Array<number>(spikeLen);
  for (let k = 0; k < spikeLen; k++) {
    spikeDelta[k] = pts[spikeStart + k] - basePreRaw;
  }

  if (isDropToNoise) {
    // Capture real noise tail from original trace
    const noiseStart = Math.min(pts.length - 1, spikeEnd + 1);
    const noisePool = pts.slice(noiseStart);
    const fallbackNoise = dbToRawPoint(next.fxdParams.noiseFloorLevelDb || -45, scale);

    // If extending beyond current trace length, grow rawPoints and FxdParams range
    const neededLen = newIdx + (spikeLen - preOffset) + 40;
    if (neededLen > pts.length) {
      const extraCount = neededLen - pts.length;
      for (let i = 0; i < extraCount; i++) {
        const sample =
          noisePool.length > 0
            ? noisePool[i % noisePool.length]
            : clampRaw(fallbackNoise + Math.sin(i * 1.9) * 40);
        pts.push(sample);
      }
      if (next.fxdParams.pulseEntries.length > 0) {
        next.fxdParams.pulseEntries[0].numDataPoints = pts.length;
      }
      const totalMeters = (pts.length - 1) * dx;
      const oldAcqRng = next.fxdParams.acquisitionRange;
      const oldAcqRngD = next.fxdParams.acquisitionRangeDistance;
      const newAcqRng = metersToPropTime(totalMeters, ior);
      next.fxdParams.acquisitionRange = newAcqRng;
      next.fxdParams.acquisitionRangeDistance = computeUpdatedAcqRangeDistance(
        oldAcqRng,
        oldAcqRngD,
        newAcqRng,
        next.fxdParams.units,
        totalMeters
      );
    } else {
      newIdx = Math.min(pts.length - 2, newIdx);
    }

    const newSpikeStart = Math.max(1, newIdx - preOffset);

    if (newIdx > oldIdx) {
      // Extend clean fiber backscatter between spikeStart and newSpikeStart
      const slopeDbKm = ev.attenuationCoeffDbKm > 0 ? ev.attenuationCoeffDbKm : 0.25;
      const rawPerPoint = dbDeltaToRawDelta((slopeDbKm * dx) / 1000, scale);
      for (let i = spikeStart; i < newSpikeStart; i++) {
        const step = i - spikeStart;
        const jitter = (Math.sin(i * 1.73) * 0.6 + Math.cos(i * 0.71) * 0.4) * fiberJitterRaw;
        pts[i] = clampRaw(basePreRaw + step * rawPerPoint + jitter);
      }
    }

    const newBaseRaw = medianOfSlice(pts, newSpikeStart - 12, newSpikeStart - 2);
    for (let k = 0; k < spikeLen; k++) {
      const targetPos = newSpikeStart + k;
      if (targetPos < pts.length) {
        pts[targetPos] = clampRaw(newBaseRaw + spikeDelta[k]);
      }
    }

    const newTailStart = newSpikeStart + spikeLen;
    for (let i = newTailStart; i < pts.length; i++) {
      if (noisePool.length > 0) {
        pts[i] = noisePool[(i - newTailStart) % noisePool.length];
      } else {
        pts[i] = clampRaw(fallbackNoise + Math.sin(i * 2.1) * 45);
      }
    }
    return;
  }

  // Case B: Middle event (splice/connector) - heal old location, then inject at newIdx
  newIdx = Math.min(pts.length - 3, Math.max(1, newIdx));
  const stepDeltaRaw = dbDeltaToRawDelta(ev.eventLossDb, scale);

  // Heal old event: remove step loss after oldIdx and interpolate across spike
  for (let i = oldIdx + 1; i < pts.length; i++) {
    pts[i] = clampRaw(pts[i] - stepDeltaRaw);
  }
  const healLeft = pts[Math.max(0, spikeStart - 1)];
  const healRight = pts[Math.min(pts.length - 1, spikeEnd + 1)];
  for (let i = spikeStart; i <= spikeEnd; i++) {
    const frac = (i - spikeStart) / Math.max(1, spikeEnd - spikeStart);
    pts[i] = clampRaw(healLeft + (healRight - healLeft) * frac);
  }

  // Re-inject at newIdx
  const newSpikeStart = Math.max(1, newIdx - preOffset);
  const newBaseRaw = medianOfSlice(pts, newSpikeStart - 10, newSpikeStart - 2);
  for (let i = newIdx + 1; i < pts.length; i++) {
    pts[i] = clampRaw(pts[i] + stepDeltaRaw);
  }
  for (let k = 0; k < spikeLen; k++) {
    const pos = newSpikeStart + k;
    if (pos < pts.length) {
      // For middle spike, keep spike relative to pre-level on the rising part
      const candidate = clampRaw(newBaseRaw + spikeDelta[k]);
      if (spikeDelta[k] < -50) {
        pts[pos] = candidate;
      }
    }
  }
}

export function updateEventAtIndex(
  doc: SorDocument,
  eventIndex: number,
  patch: Partial<KeyEvent> & { distanceMeters?: number },
  syncLossToTrace: boolean,
  syncDistanceToTrace = false
): SorDocument {
  const next = cloneSorDocument(doc);
  const existing = next.keyEvents.events[eventIndex];
  if (!existing) return next;

  const ior = next.fxdParams.groupIndex || 1.468;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;

  const rawUpdatedPropTime =
    patch.distanceMeters !== undefined
      ? metersToPropTime(patch.distanceMeters, ior)
      : patch.propagationTime ?? existing.propagationTime;

  const dataSpacing = next.fxdParams.pulseEntries[0]?.dataSpacing ?? 0;
  const stepProp = dataSpacing >= 10000 ? Math.round(dataSpacing / 10000) : 1;
  const updatedPropTime =
    patch.distanceMeters !== undefined && stepProp > 1
      ? Math.round(rawUpdatedPropTime / stepProp) * stepProp
      : rawUpdatedPropTime;

  if (syncDistanceToTrace && updatedPropTime !== existing.propagationTime) {
    moveEventTraceFeature(next, eventIndex, existing.propagationTime, updatedPropTime);
  }

  if (syncLossToTrace && patch.eventLossDb !== undefined && patch.eventLossDb !== existing.eventLossDb) {
    const lossDeltaDb = patch.eventLossDb - existing.eventLossDb;
    const rawDelta = dbDeltaToRawDelta(lossDeltaDb, scale);
    const idx = Math.min(
      next.dataPts.rawPoints.length - 1,
      Math.max(0, Math.round(propTimeToMeters(updatedPropTime, ior) / dx))
    );
    for (let i = idx + 1; i < next.dataPts.rawPoints.length; i++) {
      next.dataPts.rawPoints[i] = clampRaw(next.dataPts.rawPoints[i] + rawDelta);
    }
  }

  const oldPropTime = existing.propagationTime;
  const propDelta = updatedPropTime - oldPropTime;
  const shiftedMarkers =
    propDelta !== 0
      ? (existing.markerLocations.map((m) => {
          // Only shift markers that belong to this event's local window, preserving upstream segment start markers
          if (Math.abs(m - oldPropTime) <= 10000) {
            return Math.max(0, m + propDelta);
          }
          return Math.min(m, updatedPropTime);
        }) as [number, number, number, number, number])
      : existing.markerLocations;

  const { distanceMeters: _ignored, ...rest } = patch;
  next.keyEvents.events[eventIndex] = {
    ...existing,
    ...rest,
    propagationTime: updatedPropTime,
    markerLocations: rest.markerLocations ?? shiftedMarkers,
  };

  // Update any other event's markerLocations that referenced this event's old propagationTime
  if (propDelta !== 0) {
    next.keyEvents.events = next.keyEvents.events.map((ev, idx) => {
      if (idx === eventIndex) return ev;
      const updatedOtherMarkers = ev.markerLocations.map((m) =>
        Math.abs(m - oldPropTime) <= 50 ? updatedPropTime : m
      ) as [number, number, number, number, number];
      return { ...ev, markerLocations: updatedOtherMarkers };
    });
  }

  next.keyEvents.events = sortAndRenumberEvents(next.keyEvents.events);
  return recomputeKeyEventsSummary(next);
}

export function shiftTraceVerticalDb(doc: SorDocument, deltaDb: number): SorDocument {
  const next = cloneSorDocument(doc);
  const scale = next.dataPts.scalingFactor || 1000;
  // Positive deltaDb means moving curve UP -> smaller raw value
  const rawShift = -dbDeltaToRawDelta(deltaDb, scale);
  next.dataPts.rawPoints = next.dataPts.rawPoints.map((v) => clampRaw(v + rawShift));
  return next;
}

export function adjustSegmentSlope(
  doc: SorDocument,
  startMeters: number,
  endMeters: number,
  targetSlopeDbKm: number
): SorDocument {
  const next = cloneSorDocument(doc);
  const pts = next.dataPts.rawPoints;
  if (pts.length < 4) return next;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;

  const iStart = Math.max(0, Math.min(pts.length - 2, Math.round(startMeters / dx)));
  const iEnd = Math.max(iStart + 2, Math.min(pts.length - 1, Math.round(endMeters / dx)));

  const currentDbStart = rawPointToDb(pts[iStart], scale);
  const currentDbEnd = rawPointToDb(pts[iEnd], scale);
  const segKm = ((iEnd - iStart) * dx) / 1000;
  if (segKm <= 0) return next;

  const oldDropDb = currentDbStart - currentDbEnd;
  const newDropDb = targetSlopeDbKm * segKm;
  const totalDeltaDb = newDropDb - oldDropDb;

  for (let i = iStart + 1; i <= iEnd; i++) {
    const frac = (i - iStart) / (iEnd - iStart);
    pts[i] = clampRaw(pts[i] + dbDeltaToRawDelta(totalDeltaDb * frac, scale));
  }
  for (let i = iEnd + 1; i < pts.length; i++) {
    pts[i] = clampRaw(pts[i] + dbDeltaToRawDelta(totalDeltaDb, scale));
  }

  return recomputeKeyEventsSummary(next);
}

export function smoothTraceSegment(
  doc: SorDocument,
  startMeters: number,
  endMeters: number,
  radius = 4
): SorDocument {
  const next = cloneSorDocument(doc);
  const pts = next.dataPts.rawPoints;
  if (pts.length < 4) return next;
  const dx = getSampleSpacingMeters(next);
  const iStart = Math.max(0, Math.min(pts.length - 1, Math.round(startMeters / dx)));
  const iEnd = Math.max(iStart, Math.min(pts.length - 1, Math.round(endMeters / dx)));

  const copy = [...pts];
  for (let i = iStart; i <= iEnd; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) {
      sum += copy[k];
      count++;
    }
    pts[i] = clampRaw(sum / count);
  }
  return next;
}

export function addTraceNoise(
  doc: SorDocument,
  startMeters: number,
  endMeters: number,
  amplitudeDb = 0.08
): SorDocument {
  const next = cloneSorDocument(doc);
  const pts = next.dataPts.rawPoints;
  const dx = getSampleSpacingMeters(next);
  const scale = next.dataPts.scalingFactor || 1000;
  const ampRaw = dbDeltaToRawDelta(amplitudeDb, scale);
  const iStart = Math.max(0, Math.min(pts.length - 1, Math.round(startMeters / dx)));
  const iEnd = Math.max(iStart, Math.min(pts.length - 1, Math.round(endMeters / dx)));

  for (let i = iStart; i <= iEnd; i++) {
    const r = (Math.random() - 0.5) * 2 * ampRaw;
    pts[i] = clampRaw(pts[i] + r);
  }
  return next;
}

export function applyBrushPoints(
  doc: SorDocument,
  updates: { index: number; db: number }[]
): SorDocument {
  if (updates.length === 0) return doc;
  const next = cloneSorDocument(doc);
  const pts = next.dataPts.rawPoints;
  const scale = next.dataPts.scalingFactor || 1000;

  const sorted = [...updates].sort((a, b) => a.index - b.index);
  for (let u = 0; u < sorted.length; u++) {
    const cur = sorted[u];
    if (cur.index >= 0 && cur.index < pts.length) {
      pts[cur.index] = dbToRawPoint(cur.db, scale);
    }
    if (u + 1 < sorted.length) {
      const nxt = sorted[u + 1];
      const span = nxt.index - cur.index;
      if (span > 1 && span < 200) {
        for (let k = cur.index + 1; k < nxt.index; k++) {
          if (k >= 0 && k < pts.length) {
            const frac = (k - cur.index) / span;
            const interpDb = cur.db + (nxt.db - cur.db) * frac;
            pts[k] = dbToRawPoint(interpDb, scale);
          }
        }
      }
    }
  }
  return next;
}
