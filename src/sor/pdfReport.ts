import { jsPDF } from 'jspdf';
import {
  classifyEventCode,
  getSampleSpacingMeters,
  getTotalTraceLengthMeters,
  propTimeToMeters,
  rawPointToDb,
} from './constants';
import { KeyEvent, SorDocument } from './types';

function formatReportDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}  ${d.getHours()}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function getFiberTypeShort(code: number): string {
  if (code === 651) return 'Multimode';
  if (code === 0) return 'Unspecified';
  return 'Singlemode';
}

function formatEventShortType(ev: KeyEvent): string {
  const kind = classifyEventCode(ev.eventCode);
  if (kind === 'reflective' || kind === 'end-of-fiber') return 'Reflect';
  if (kind === 'saturated') return 'Saturated';
  return 'Down';
}

function computeLsaSlopeDbKm(
  dbValues: number[],
  dx: number,
  startM: number,
  endM: number
): number {
  const iA = Math.max(0, Math.min(dbValues.length - 1, Math.round(Math.min(startM, endM) / dx)));
  const iB = Math.max(0, Math.min(dbValues.length - 1, Math.round(Math.max(startM, endM) / dx)));
  // Skip immediate spike edges (3% inward on each side) for clean LSA slope
  const pad = Math.min(30, Math.floor((iB - iA) * 0.04));
  const s = iA + pad;
  const e = iB - pad;
  if (e <= s + 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = e - s + 1;
  for (let i = s; i <= e; i++) {
    const xKm = (i * dx) / 1000;
    const y = dbValues[i];
    sumX += xKm;
    sumY += y;
    sumXX += xKm * xKm;
    sumXY += xKm * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return Math.max(0, -slope);
}

function niceDivSize(span: number, divs: number): number {
  const raw = span / divs;
  if (raw <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / exp;
  let step = 1;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * exp;
}

export interface TraceChartResult {
  dataUrl: string | undefined;
  xDivLabel: string;
  yDivLabel: string;
}

export function renderReferenceTraceChart(
  doc: SorDocument,
  markerAMeters: number,
  markerBMeters: number
): TraceChartResult {
  const totalMeters = Math.max(100, getTotalTraceLengthMeters(doc));
  const dx = getSampleSpacingMeters(doc);
  const scale = doc.dataPts.scalingFactor || 1000;
  const rawDb = doc.dataPts.rawPoints.map((r) => rawPointToDb(r, scale));

  // Use baseline = max(|noiseFloor|, 65.535) so relative dBm matches classic OTDR power scale (0..65.5 dB)
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of rawDb) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  if (!Number.isFinite(minVal)) {
    minVal = -65.535;
    maxVal = 0;
  }
  const powerOffset = Math.max(65.535, Math.ceil(-minVal));
  const powerDb = rawDb.map((v) => v + powerOffset);

  const xDivs = 10;
  const yDivs = 6;
  const xDivMeters = niceDivSize(totalMeters, xDivs);
  const xMaxMeters = Math.max(totalMeters, xDivMeters * xDivs);

  const pMin = Math.min(...powerDb);
  const pMax = Math.max(...powerDb);
  const yDivDb = Math.max(1, niceDivSize(Math.max(10, pMax - pMin), yDivs));
  const yMinDb = Math.max(0, Math.floor(pMin / yDivDb) * yDivDb);
  const yMaxDb = yMinDb + yDivDb * yDivs;

  const xDivLabel = xDivMeters >= 1000 ? `${(xDivMeters / 1000).toFixed(1)}km` : `${Math.round(xDivMeters)}m`;
  const yDivLabel = `${yDivDb.toFixed(1)}dB`;

  if (typeof document === 'undefined') {
    return { dataUrl: undefined, xDivLabel, yDivLabel };
  }

  const canvas = document.createElement('canvas');
  const width = 1600;
  const height = 560;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: undefined, xDivLabel, yDivLabel };

  const distToX = (d: number) => (d / xMaxMeters) * width;
  const dbToY = (db: number) => height - ((db - yMinDb) / Math.max(1e-6, yMaxDb - yMinDb)) * height;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Gridlines (10 cols x 6 rows)
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  for (let c = 1; c < xDivs; c++) {
    const x = (c / xDivs) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let r = 1; r < yDivs; r++) {
    const y = (r / yDivs) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Trace curve (solid black crisp line like reference)
  if (powerDb.length > 0) {
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    const step = powerDb.length > width * 2 ? Math.floor(powerDb.length / (width * 2)) : 1;
    for (let i = 0; i < powerDb.length; i += step) {
      const x = distToX(i * dx);
      const y = dbToY(powerDb[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Event triangles & numbers
  const ior = doc.fxdParams.groupIndex || 1.468;
  for (const ev of doc.keyEvents.events) {
    const distM = propTimeToMeters(ev.propagationTime, ior);
    const idx = Math.max(0, Math.min(powerDb.length - 1, Math.round(distM / dx)));
    const x = distToX(distM);
    const yCurve = dbToY(powerDb[idx] ?? yMinDb);

    // Small upward triangle marker
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(x, yCurve + 2);
    ctx.lineTo(x - 7, yCurve + 15);
    ctx.lineTo(x + 7, yCurve + 15);
    ctx.closePath();
    ctx.fill();

    ctx.font = '20px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(ev.eventNumber), x, Math.min(height - 6, yCurve + 36));
  }

  // Marker A & B vertical lines + X crosshairs + text labels
  const drawCursor = (meters: number, label: string, alignRightOfLine: boolean) => {
    const clampedM = Math.max(0, Math.min(totalMeters, meters));
    const idx = Math.max(0, Math.min(powerDb.length - 1, Math.round(clampedM / dx)));
    const x = distToX(clampedM);
    const y = dbToY(powerDb[idx] ?? yMinDb);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    // X crosshair on curve
    const s = 8;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();

    // Label near top
    ctx.fillStyle = '#0f172a';
    ctx.font = '22px Georgia, "Times New Roman", serif';
    const text = `${label}:${(clampedM / 1000).toFixed(5)} km`;
    if (alignRightOfLine || x < width * 0.25) {
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 8, 38);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(text, x - 8, 66);
    }
  };

  drawCursor(markerAMeters, 'A', true);
  drawCursor(markerBMeters, 'B', false);

  // Outer frame
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    xDivLabel,
    yDivLabel,
  };
}

export interface PdfReportOptions {
  relativeDbView?: boolean;
  markerAMeters?: number;
  markerBMeters?: number;
  chartDataUrl?: string;
  displayFileName?: string;
  outputFileName?: string;
}

export function buildOtdrPdfReport(doc: SorDocument, options: PdfReportOptions = {}): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentW = pageW - margin * 2;

  const dx = getSampleSpacingMeters(doc);
  const totalMeters = getTotalTraceLengthMeters(doc);
  const ior = doc.fxdParams.groupIndex || 1.468;
  const pulse = doc.fxdParams.pulseEntries[0];
  const scale = doc.dataPts.scalingFactor || 1000;

  const rawDb = doc.dataPts.rawPoints.map((r) => rawPointToDb(r, scale));
  let minRawDb = Infinity;
  for (const v of rawDb) if (v < minRawDb) minRawDb = v;
  const powerOffset = Math.max(65.535, Number.isFinite(minRawDb) ? Math.ceil(-minRawDb) : 65.535);
  const powerDb = rawDb.map((v) => v + powerOffset);

  const events = doc.keyEvents.events;
  const lastEventDistM =
    events.length > 0 ? propTimeToMeters(events[events.length - 1].propagationTime, ior) : totalMeters;

  const markerAM = options.markerAMeters ?? 0;
  const markerBM = options.markerBMeters ?? lastEventDistM;

  const idxA = Math.max(0, Math.min(powerDb.length - 1, Math.round(markerAM / dx)));
  const idxB = Math.max(0, Math.min(powerDb.length - 1, Math.round(markerBM / dx)));
  const lsaLossAB = computeLsaSlopeDbKm(rawDb, dx, markerAM, markerBM);

  // If idxA sits inside a launch spike near 0 km, extrapolate fiber backscatter level cleanly
  let aPower = powerDb[idxA] ?? 0;
  let bPower = powerDb[idxB] ?? 0;
  if (idxA < 20 && idxB > 80) {
    const cleanIdx = Math.min(idxB - 10, idxA + 60);
    const cleanPower = powerDb[cleanIdx] ?? aPower;
    if (aPower > cleanPower + 1.5) {
      const extrapKm = ((cleanIdx - idxA) * dx) / 1000;
      aPower = cleanPower + extrapKm * lsaLossAB;
    }
  }
  // If idxB sits right at the end-of-fiber spike peak, use pre-spike backscatter level
  if (idxB > 10 && powerDb[idxB] > (powerDb[idxB - 8] ?? 0) + 1.5) {
    bPower = powerDb[Math.max(0, idxB - 6)] ?? bPower;
  }

  const distABKm = Math.abs(markerBM - markerAM) / 1000;
  const lossAB = Math.max(0, aPower - bPower);
  const avgLossAB = distABKm > 0.001 ? lossAB / distABKm : 0;

  const acqRangeKm = totalMeters / 1000;
  const displayFile = options.displayFileName ?? doc.fileName;

  // Title
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('times', 'normal');
  pdf.setFontSize(15);
  pdf.text('OTDR Test Report', pageW / 2, 16, { align: 'center' });

  let y = 21;
  pdf.setDrawColor(70, 70, 70);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageW - margin, y);
  y += 5;

  // 3-column metadata header matching reference
  const c1 = margin;
  const c2 = margin + 68;
  const c3 = margin + 132;

  const metaRows: [string, string, string][] = [
    [
      `File : ${displayFile}`,
      `File Date : ${formatReportDateTime(doc.fxdParams.timestamp)}`,
      `Task : ${doc.genParams.cableCode || ''}`,
    ],
    [
      `Cable : ${doc.genParams.cableId || ''}`,
      `Start Position : ${doc.genParams.originatingLocation || ''}`,
      `User : ${doc.genParams.operator || ''}`,
    ],
    [
      `Fiber : ${doc.genParams.fiberId || ''}`,
      `End Position : ${doc.genParams.terminatingLocation || ''}`,
      `Device Name : ${doc.supParams.otdrMainframeId || ''}`,
    ],
    [
      `Operator : ${doc.genParams.operator || ''}`,
      `Fiber Type : ${getFiberTypeShort(doc.genParams.fiberType)}`,
      doc.supParams.supplierName ? `Supplier : ${doc.supParams.supplierName}` : '',
    ],
    [
      `Wave : ${Math.round(doc.fxdParams.actualWavelengthNm)} nm`,
      `Range : ${acqRangeKm.toFixed(1)} km`,
      `Pulse : ${pulse?.pulseWidthNs ?? '-'} ns`,
    ],
    [
      `Test Mode : Average-Test`,
      `Average Times : ${doc.fxdParams.numAverages}`,
      `Ior : ${ior.toFixed(5)}`,
    ],
    [
      `End Threshold : ${doc.fxdParams.endOfFiberThresholdDb.toFixed(2)}`,
      `Non-Reflection Threshold : ${doc.fxdParams.lossThresholdDb.toFixed(2)}`,
      `Reflection Threshold : ${Math.abs(doc.fxdParams.reflectanceThresholdDb).toFixed(2)}`,
    ],
  ];

  pdf.setFont('times', 'normal');
  pdf.setFontSize(8.8);
  const clip = (s: string, maxLen = 36) => (s.length > maxLen ? `${s.slice(0, maxLen - 2)}..` : s);
  for (const [colA, colB, colC] of metaRows) {
    pdf.text(clip(colA, 40), c1, y);
    pdf.text(clip(colB, 36), c2, y);
    if (colC) pdf.text(clip(colC, 34), c3, y);
    y += 5.1;
  }

  y -= 1.2;
  pdf.line(margin, y, pageW - margin, y);
  y += 5.2;

  // Trace Header
  const chartRes = renderReferenceTraceChart(doc, markerAM, markerBM);
  pdf.setFont('times', 'normal');
  pdf.setFontSize(9);
  pdf.text('Test Trace', margin, y);
  pdf.text(`X:${chartRes.xDivLabel}/Div, Y:${chartRes.yDivLabel}/Div`, pageW - margin, y, {
    align: 'right',
  });
  y += 2;

  // Trace Graph Box
  const traceH = 74;
  const chartUrl = options.chartDataUrl ?? chartRes.dataUrl;
  if (chartUrl) {
    pdf.addImage(chartUrl, 'PNG', margin, y, contentW, traceH);
  } else {
    pdf.rect(margin, y, contentW, traceH);
  }
  y += traceH + 6;

  // A-B Segment Information & A/B Points Information (side by side)
  const boxW = 72;
  const leftBoxX = margin + 12;
  const rightBoxX = pageW - margin - 12 - boxW;

  const drawInfoMiniTable = (
    x: number,
    title: string,
    rows: [string, string][],
    hasFooterDashed = false
  ) => {
    let ty = y;
    pdf.setFont('times', 'normal');
    pdf.setFontSize(9);
    pdf.text(title, x + boxW / 2, ty, { align: 'center' });
    ty += 2;
    pdf.line(x, ty, x + boxW, ty);
    ty += 4.5;

    pdf.setFontSize(8.5);
    for (const [label, val] of rows) {
      pdf.text(label, x + 2, ty);
      pdf.text(val, x + boxW - 2, ty, { align: 'right' });
      ty += 5.2;
    }

    if (hasFooterDashed) {
      pdf.text('----', x + 8, ty);
      pdf.text('----', x + boxW - 8, ty, { align: 'right' });
      ty += 5.2;
    }

    ty -= 2.5;
    pdf.line(x, ty, x + boxW, ty);
    return ty;
  };

  const endLeftY = drawInfoMiniTable(leftBoxX, 'A-B Segment Information', [
    ['Distance(A-B):', `${distABKm.toFixed(5)} km`],
    ['Loss(A-B):', `${lossAB.toFixed(3)} dB`],
    ['A-B Average Loss:', `${avgLossAB.toFixed(3)} dB/km`],
    ['LSA Average Loss:', `${lsaLossAB.toFixed(3)} dB/km`],
    ['A-B Return Loss:', `${doc.keyEvents.opticalReturnLossDb > 0 ? doc.keyEvents.opticalReturnLossDb.toFixed(3) : '0.000'} dB`],
  ]);

  const endRightY = drawInfoMiniTable(
    rightBoxX,
    'A/B Points Information',
    [
      ['A Position:', `${(markerAM / 1000).toFixed(5)} km`],
      ['B Position:', `${(markerBM / 1000).toFixed(5)} km`],
      ['A Power:', `${aPower.toFixed(3)} dBm`],
      ['B Power:', `${bPower.toFixed(3)} dBm`],
    ],
    true
  );

  y = Math.max(endLeftY, endRightY) + 4.5;
  pdf.line(margin, y, pageW - margin, y);
  y += 5;

  // Fiber Link Information
  const linkLengthKm = lastEventDistM / 1000;
  const totalLossDb = doc.keyEvents.endToEndLossDb;
  const linkAvgLoss = linkLengthKm > 0.001 ? totalLossDb / linkLengthKm : 0;

  pdf.setFont('times', 'normal');
  pdf.setFontSize(9.5);
  pdf.text('Fiber Link Information', pageW / 2, y, { align: 'center' });
  y += 6;

  pdf.setFontSize(8.8);
  const linkCols = [margin, margin + 35, margin + 92, pageW - margin];
  pdf.text(`Number: ${events.length}`, linkCols[0], y);
  pdf.text(`Link Length: ${linkLengthKm.toFixed(4)} km`, linkCols[1], y);
  pdf.text(`Total Loss: ${totalLossDb.toFixed(3)} dB`, linkCols[2], y);
  pdf.text(`Average Loss: ${linkAvgLoss.toFixed(3)} dB/km`, linkCols[3], y, { align: 'right' });

  y += 3;
  pdf.line(margin, y, pageW - margin, y);
  y += 5.5;

  // Event Table
  pdf.setFontSize(9.5);
  pdf.text('Event Table', pageW / 2, y, { align: 'center' });
  y += 5.5;

  const evCols = [
    { label: 'No', x: margin + 4 },
    { label: 'Type', x: margin + 22 },
    { label: 'Dis(km)', x: margin + 48 },
    { label: 'Aver.-L(dB/km)', x: margin + 80 },
    { label: 'Event-L(dB)', x: margin + 114 },
    { label: 'Return-L(dB)', x: margin + 148 },
    { label: 'Link-L(dB)', x: pageW - margin - 6 },
  ];

  const drawEvHeader = (topY: number) => {
    pdf.setFont('times', 'normal');
    pdf.setFontSize(8.6);
    for (const col of evCols) {
      pdf.text(col.label, col.x, topY, { align: 'center' });
    }
    return topY + 5.5;
  };

  y = drawEvHeader(y);

  // Compute cumulative Link-L(dB) per event cleanly
  let cumLoss = 0;
  let prevDistKm = 0;

  if (events.length === 0) {
    pdf.setFontSize(8.5);
    pdf.text('No events recorded.', pageW / 2, y, { align: 'center' });
    y += 5;
  } else {
    events.forEach((ev, idx) => {
      if (y > pageH - 16) {
        pdf.addPage();
        y = 16;
        y = drawEvHeader(y);
      }

      const distKm = propTimeToMeters(ev.propagationTime, ior) / 1000;
      const segKm = Math.max(0, distKm - prevDistKm);
      const segSlope =
        ev.attenuationCoeffDbKm >= -50 && ev.attenuationCoeffDbKm < 10
          ? ev.attenuationCoeffDbKm
          : 0.25;
      if (idx === 0) {
        cumLoss = segKm * segSlope + ev.eventLossDb;
      } else {
        cumLoss += segKm * Math.max(0, segSlope) + ev.eventLossDb;
      }
      prevDistKm = distKm;

      const isLastEof =
        idx === events.length - 1 &&
        (classifyEventCode(ev.eventCode) === 'end-of-fiber' || ev.eventLossDb === 0);

      const vals = [
        String(ev.eventNumber),
        formatEventShortType(ev),
        distKm.toFixed(4),
        ev.attenuationCoeffDbKm.toFixed(3),
        isLastEof ? '----' : ev.eventLossDb.toFixed(3),
        ev.eventReflectanceDb === 0 ? '0.000' : ev.eventReflectanceDb.toFixed(3),
        (idx === events.length - 1 ? totalLossDb : cumLoss).toFixed(3),
      ];

      pdf.setFont('times', 'normal');
      pdf.setFontSize(8.6);
      vals.forEach((v, ci) => {
        pdf.text(v, evCols[ci].x, y, { align: 'center' });
      });
      y += 5.2;
    });
  }

  y -= 1.5;
  pdf.line(margin, y, pageW - margin, y);

  return pdf;
}

export function downloadOtdrPdfReport(doc: SorDocument, options: PdfReportOptions = {}): string {
  const pdf = buildOtdrPdfReport(doc, options);
  const baseName = doc.fileName.replace(/\.sor$/i, '');
  const outName = options.outputFileName ?? `${baseName}.pdf`;
  pdf.save(outName);
  return outName;
}
