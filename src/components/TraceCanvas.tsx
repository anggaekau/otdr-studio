import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Hand, PenTool, PlusCircle, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import {
  classifyEventCode,
  getSampleSpacingMeters,
  getTotalTraceLengthMeters,
  propTimeToMeters,
  rawPointToDb,
} from '../sor/constants';
import { SorDocument } from '../sor/types';

export type CanvasMode = 'pan' | 'markerA' | 'markerB' | 'addEvent' | 'drawCurve';

interface TraceCanvasProps {
  doc: SorDocument;
  selectedEventIndex: number | null;
  onSelectEvent: (index: number) => void;
  markerAMeters: number;
  markerBMeters: number;
  onChangeMarkers: (aMeters: number, bMeters: number) => void;
  onRequestAddEventAt: (distanceMeters: number) => void;
  onCommitCurveDraw: (updates: { index: number; db: number }[]) => void;
  mode: CanvasMode;
  onChangeMode: (m: CanvasMode) => void;
  relativeDbView: boolean;
  onToggleRelativeDbView: () => void;
}

interface Viewport {
  minDistM: number;
  maxDistM: number;
  minDb: number;
  maxDb: number;
}

const PAD = { left: 60, right: 24, top: 22, bottom: 38 };

export const TraceCanvas: React.FC<TraceCanvasProps> = ({
  doc,
  selectedEventIndex,
  onSelectEvent,
  markerAMeters,
  markerBMeters,
  onChangeMarkers,
  onRequestAddEventAt,
  onCommitCurveDraw,
  mode,
  onChangeMode,
  relativeDbView,
  onToggleRelativeDbView,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const dx = useMemo(() => getSampleSpacingMeters(doc), [doc]);
  const totalMeters = useMemo(() => getTotalTraceLengthMeters(doc), [doc]);
  const scale = doc.dataPts.scalingFactor || 1000;

  const dbArray = useMemo(() => {
    return doc.dataPts.rawPoints.map((raw) => rawPointToDb(raw, scale));
  }, [doc.dataPts.rawPoints, scale]);

  const dbBaselineShift = useMemo(() => {
    if (!relativeDbView || dbArray.length === 0) return 0;
    let minVal = Infinity;
    for (let i = 0; i < dbArray.length; i++) {
      if (dbArray[i] < minVal) minVal = dbArray[i];
    }
    return Math.ceil(-minVal);
  }, [dbArray, relativeDbView]);

  const computeFullViewport = useCallback((): Viewport => {
    let minD = Infinity;
    let maxD = -Infinity;
    for (let i = 0; i < dbArray.length; i++) {
      const v = dbArray[i] + dbBaselineShift;
      if (v < minD) minD = v;
      if (v > maxD) maxD = v;
    }
    if (!Number.isFinite(minD)) {
      minD = -50;
      maxD = 0;
    }
    const span = Math.max(4, maxD - minD);
    return {
      minDistM: 0,
      maxDistM: Math.max(100, totalMeters),
      minDb: minD - span * 0.08,
      maxDb: maxD + span * 0.1,
    };
  }, [dbArray, dbBaselineShift, totalMeters]);

  const [viewport, setViewport] = useState<Viewport>(computeFullViewport);
  const [hoverInfo, setHoverInfo] = useState<{ distM: number; db: number } | null>(null);
  const [drawDraft, setDrawDraft] = useState<{ index: number; db: number }[]>([]);

  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startViewport: Viewport;
    draggingMarker: 'A' | 'B' | null;
    drawing: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startViewport: viewport,
    draggingMarker: null,
    drawing: false,
  });

  // Reset viewport when a brand new file is loaded or baseline mode toggles
  useEffect(() => {
    setViewport(computeFullViewport());
  }, [doc.fileName, relativeDbView, computeFullViewport]);

  const distToX = useCallback(
    (d: number, width: number, vp: Viewport) => {
      const plotW = Math.max(1, width - PAD.left - PAD.right);
      return PAD.left + ((d - vp.minDistM) / Math.max(1e-6, vp.maxDistM - vp.minDistM)) * plotW;
    },
    []
  );

  const xToDist = useCallback(
    (x: number, width: number, vp: Viewport) => {
      const plotW = Math.max(1, width - PAD.left - PAD.right);
      return vp.minDistM + ((x - PAD.left) / plotW) * (vp.maxDistM - vp.minDistM);
    },
    []
  );

  const dbToY = useCallback(
    (db: number, height: number, vp: Viewport) => {
      const plotH = Math.max(1, height - PAD.top - PAD.bottom);
      return PAD.top + ((vp.maxDb - db) / Math.max(1e-6, vp.maxDb - vp.minDb)) * plotH;
    },
    []
  );

  const yToDb = useCallback(
    (y: number, height: number, vp: Viewport) => {
      const plotH = Math.max(1, height - PAD.top - PAD.bottom);
      return vp.maxDb - ((y - PAD.top) / plotH) * (vp.maxDb - vp.minDb);
    },
    []
  );

  const sampleDbAtMeters = useCallback(
    (meters: number) => {
      if (dbArray.length === 0) return 0;
      const idx = Math.max(0, Math.min(dbArray.length - 1, Math.round(meters / dx)));
      return dbArray[idx] + dbBaselineShift;
    },
    [dbArray, dx, dbBaselineShift]
  );

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const render = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(200, Math.floor(rect.height));

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, width, height);

      const plotW = width - PAD.left - PAD.right;
      const plotH = height - PAD.top - PAD.bottom;

      // Grid
      ctx.strokeStyle = '#162033';
      ctx.lineWidth = 1;
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#6f82a3';

      const xTicks = 8;
      for (let i = 0; i <= xTicks; i++) {
        const frac = i / xTicks;
        const distM = viewport.minDistM + frac * (viewport.maxDistM - viewport.minDistM);
        const x = PAD.left + frac * plotW;
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + plotH);
        ctx.stroke();

        const label =
          viewport.maxDistM - viewport.minDistM >= 2000
            ? `${(distM / 1000).toFixed(2)} km`
            : `${Math.round(distM)} m`;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, height - 12);
      }

      const yTicks = 6;
      for (let i = 0; i <= yTicks; i++) {
        const frac = i / yTicks;
        const dbVal = viewport.maxDb - frac * (viewport.maxDb - viewport.minDb);
        const y = PAD.top + frac * plotH;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(PAD.left + plotW, y);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.fillText(`${dbVal.toFixed(1)} dB`, PAD.left - 8, y + 4);
      }

      // Clip to plot area
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.left, PAD.top, plotW, plotH);
      ctx.clip();

      // Event vertical markers
      const ior = doc.fxdParams.groupIndex || 1.468;
      doc.keyEvents.events.forEach((ev, idx) => {
        const distM = propTimeToMeters(ev.propagationTime, ior);
        const x = distToX(distM, width, viewport);
        if (x < PAD.left - 20 || x > PAD.left + plotW + 20) return;

        const kind = classifyEventCode(ev.eventCode);
        const isSelected = idx === selectedEventIndex;
        const color =
          kind === 'end-of-fiber'
            ? '#ef4444'
            : kind === 'reflective'
            ? '#a78bfa'
            : '#10b981';

        ctx.save();
        ctx.strokeStyle = isSelected ? '#ffffff' : color;
        ctx.lineWidth = isSelected ? 1.8 : 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + plotH);
        ctx.stroke();
        ctx.restore();

        // Badge at top
        ctx.fillStyle = isSelected ? '#38bdf8' : color;
        ctx.beginPath();
        ctx.roundRect(x - 11, PAD.top + 4, 22, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#070b14';
        ctx.font = 'bold 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.eventNumber}`, x, PAD.top + 15);
      });

      // Draw trace curve
      if (dbArray.length > 0) {
        const draftMap = new Map<number, number>();
        for (const p of drawDraft) {
          draftMap.set(p.index, p.db + dbBaselineShift);
        }

        const startIdx = Math.max(0, Math.floor(viewport.minDistM / dx) - 1);
        const endIdx = Math.min(dbArray.length - 1, Math.ceil(viewport.maxDistM / dx) + 1);

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.6;
        ctx.beginPath();

        // Downsample smartly if zoomed out on huge traces (> 4000 pts visible)
        const visibleCount = endIdx - startIdx + 1;
        const step = visibleCount > plotW * 2 ? Math.floor(visibleCount / (plotW * 2)) : 1;

        let started = false;
        for (let i = startIdx; i <= endIdx; i += step) {
          const distM = i * dx;
          const dbVal = draftMap.has(i) ? draftMap.get(i)! : dbArray[i] + dbBaselineShift;
          const x = distToX(distM, width, viewport);
          const y = dbToY(dbVal, height, viewport);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Marker A & B
      const drawMarker = (meters: number, label: string, color: string) => {
        const x = distToX(meters, width, viewport);
        if (x < PAD.left || x > PAD.left + plotW) return;
        const y = dbToY(sampleDbAtMeters(meters), height, viewport);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + plotH);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x - 9, PAD.top + plotH - 22, 18, 17, 3);
        ctx.fill();
        ctx.fillStyle = '#070b14';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, PAD.top + plotH - 10);
      };

      drawMarker(markerAMeters, 'A', '#22d3ee');
      drawMarker(markerBMeters, 'B', '#f59e0b');

      ctx.restore(); // unclip

      // Plot border
      ctx.strokeStyle = '#243047';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [
    dbArray,
    dbBaselineShift,
    dbToY,
    distToX,
    doc.fxdParams.groupIndex,
    doc.keyEvents.events,
    drawDraft,
    dx,
    markerAMeters,
    markerBMeters,
    sampleDbAtMeters,
    selectedEventIndex,
    viewport,
  ]);

  const getLocalCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y, width, height } = getLocalCoords(e);
    const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
    const anchorDist = xToDist(x, width, viewport);
    const anchorDb = yToDb(y, height, viewport);

    const newSpanDist = Math.max(20, (viewport.maxDistM - viewport.minDistM) * zoomFactor);
    const newSpanDb = Math.max(1.5, (viewport.maxDb - viewport.minDb) * zoomFactor);

    const fracX = (anchorDist - viewport.minDistM) / Math.max(1e-6, viewport.maxDistM - viewport.minDistM);
    const fracY = (viewport.maxDb - anchorDb) / Math.max(1e-6, viewport.maxDb - viewport.minDb);

    setViewport({
      minDistM: anchorDist - fracX * newSpanDist,
      maxDistM: anchorDist + (1 - fracX) * newSpanDist,
      maxDb: anchorDb + fracY * newSpanDb,
      minDb: anchorDb - (1 - fracY) * newSpanDb,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, width, height } = getLocalCoords(e);
    const distM = Math.max(0, Math.min(totalMeters, xToDist(x, width, viewport)));
    const dbRaw = yToDb(y, height, viewport) - dbBaselineShift;

    // Check if clicking an event badge near top
    const ior = doc.fxdParams.groupIndex || 1.468;
    if (y >= PAD.top && y <= PAD.top + 26 && mode === 'pan') {
      for (let i = 0; i < doc.keyEvents.events.length; i++) {
        const evX = distToX(propTimeToMeters(doc.keyEvents.events[i].propagationTime, ior), width, viewport);
        if (Math.abs(evX - x) <= 13) {
          onSelectEvent(i);
          return;
        }
      }
    }

    if (mode === 'markerA') {
      onChangeMarkers(distM, markerBMeters);
      return;
    }
    if (mode === 'markerB') {
      onChangeMarkers(markerAMeters, distM);
      return;
    }
    if (mode === 'addEvent') {
      onRequestAddEventAt(Math.round(distM));
      return;
    }
    if (mode === 'drawCurve') {
      const idx = Math.max(0, Math.min(dbArray.length - 1, Math.round(distM / dx)));
      dragStateRef.current = {
        active: true,
        startX: x,
        startY: y,
        startViewport: viewport,
        draggingMarker: null,
        drawing: true,
      };
      setDrawDraft([{ index: idx, db: dbRaw }]);
      return;
    }

    // In pan mode: check if grabbing Marker A or B line directly
    const ax = distToX(markerAMeters, width, viewport);
    const bx = distToX(markerBMeters, width, viewport);
    if (Math.abs(x - ax) < 7) {
      dragStateRef.current = {
        active: true,
        startX: x,
        startY: y,
        startViewport: viewport,
        draggingMarker: 'A',
        drawing: false,
      };
      return;
    }
    if (Math.abs(x - bx) < 7) {
      dragStateRef.current = {
        active: true,
        startX: x,
        startY: y,
        startViewport: viewport,
        draggingMarker: 'B',
        drawing: false,
      };
      return;
    }

    dragStateRef.current = {
      active: true,
      startX: x,
      startY: y,
      startViewport: viewport,
      draggingMarker: null,
      drawing: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, width, height } = getLocalCoords(e);
    const distM = xToDist(x, width, viewport);
    const dbVal = yToDb(y, height, viewport);
    setHoverInfo({ distM, db: dbVal });

    const st = dragStateRef.current;
    if (!st.active) return;

    if (st.drawing) {
      const clampedDist = Math.max(0, Math.min(totalMeters, distM));
      const idx = Math.max(0, Math.min(dbArray.length - 1, Math.round(clampedDist / dx)));
      const dbRaw = dbVal - dbBaselineShift;
      setDrawDraft((prev) => [...prev, { index: idx, db: dbRaw }]);
      return;
    }

    if (st.draggingMarker === 'A') {
      onChangeMarkers(Math.max(0, Math.min(totalMeters, distM)), markerBMeters);
      return;
    }
    if (st.draggingMarker === 'B') {
      onChangeMarkers(markerAMeters, Math.max(0, Math.min(totalMeters, distM)));
      return;
    }

    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = Math.max(1, height - PAD.top - PAD.bottom);
    const deltaDist = ((x - st.startX) / plotW) * (st.startViewport.maxDistM - st.startViewport.minDistM);
    const deltaDb = ((y - st.startY) / plotH) * (st.startViewport.maxDb - st.startViewport.minDb);

    setViewport({
      minDistM: st.startViewport.minDistM - deltaDist,
      maxDistM: st.startViewport.maxDistM - deltaDist,
      minDb: st.startViewport.minDb + deltaDb,
      maxDb: st.startViewport.maxDb + deltaDb,
    });
  };

  const finishDrag = () => {
    if (dragStateRef.current.drawing && drawDraft.length > 0) {
      onCommitCurveDraw(drawDraft);
      setDrawDraft([]);
    }
    dragStateRef.current.active = false;
    dragStateRef.current.draggingMarker = null;
    dragStateRef.current.drawing = false;
  };

  const zoomCenter = (factor: number) => {
    const centerDist = (viewport.minDistM + viewport.maxDistM) / 2;
    const centerDb = (viewport.minDb + viewport.maxDb) / 2;
    const halfD = Math.max(10, ((viewport.maxDistM - viewport.minDistM) * factor) / 2);
    const halfY = Math.max(0.8, ((viewport.maxDb - viewport.minDb) * factor) / 2);
    setViewport({
      minDistM: centerDist - halfD,
      maxDistM: centerDist + halfD,
      minDb: centerDb - halfY,
      maxDb: centerDb + halfY,
    });
  };

  const aDb = sampleDbAtMeters(markerAMeters);
  const bDb = sampleDbAtMeters(markerBMeters);
  const deltaDistM = Math.abs(markerBMeters - markerAMeters);
  const deltaLossDb = Math.abs(aDb - bDb);
  const slopeDbKm = deltaDistM > 1 ? (deltaLossDb / deltaDistM) * 1000 : 0;

  return (
    <div className="left-pane">
      <div className="canvas-toolbar">
        <div className="toolbar-group">
          <button
            className={`btn btn-sm ${mode === 'pan' ? 'btn-active' : ''}`}
            onClick={() => onChangeMode('pan')}
            title="Geser grafik & tarik garis Marker A/B"
          >
            <Hand size={14} /> Pan / Geser
          </button>
          <button
            className={`btn btn-sm ${mode === 'markerA' ? 'btn-active' : ''}`}
            onClick={() => onChangeMode('markerA')}
          >
            <Crosshair size={14} /> Set Marker A
          </button>
          <button
            className={`btn btn-sm ${mode === 'markerB' ? 'btn-active' : ''}`}
            onClick={() => onChangeMode('markerB')}
          >
            <Crosshair size={14} /> Set Marker B
          </button>
          <button
            className={`btn btn-sm ${mode === 'addEvent' ? 'btn-active' : ''}`}
            onClick={() => onChangeMode('addEvent')}
            title="Klik di grafik untuk menambah Event baru di jarak tersebut"
          >
            <PlusCircle size={14} /> Klik Tambah Event
          </button>
          <button
            className={`btn btn-sm ${mode === 'drawCurve' ? 'btn-active' : ''}`}
            onClick={() => onChangeMode('drawCurve')}
            title="Gambar/ubah kurva trace langsung dengan mouse"
          >
            <PenTool size={14} /> Gambar Kurva
          </button>
        </div>

        <div className="toolbar-group">
          <button className="btn btn-sm" onClick={onToggleRelativeDbView}>
            {relativeDbView ? 'Skala: OTDR (dB+)' : 'Skala: Raw (dB-)'}
          </button>
          <button className="btn btn-sm" onClick={() => zoomCenter(0.75)} title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => zoomCenter(1.33)} title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setViewport(computeFullViewport())}
            title="Reset tampilan penuh"
          >
            <RotateCcw size={14} /> Fit
          </button>
        </div>
      </div>

      <div ref={wrapperRef} className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          style={{
            cursor:
              mode === 'drawCurve'
                ? 'crosshair'
                : mode === 'addEvent' || mode === 'markerA' || mode === 'markerB'
                ? 'cell'
                : 'grab',
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={finishDrag}
          onMouseLeave={() => {
            setHoverInfo(null);
            finishDrag();
          }}
        />
      </div>

      <div className="metrics-strip">
        <div className="metric-item">
          <span style={{ color: '#22d3ee', fontWeight: 700 }}>A:</span>
          <span className="metric-val">
            {(markerAMeters / 1000).toFixed(3)} km ({aDb.toFixed(2)} dB)
          </span>
        </div>
        <div className="metric-item">
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>B:</span>
          <span className="metric-val">
            {(markerBMeters / 1000).toFixed(3)} km ({bDb.toFixed(2)} dB)
          </span>
        </div>
        <div className="metric-item">
          <span>ΔJarak:</span>
          <span className="metric-val">{(deltaDistM / 1000).toFixed(3)} km</span>
        </div>
        <div className="metric-item">
          <span>ΔLoss:</span>
          <span className="metric-val">{deltaLossDb.toFixed(3)} dB</span>
        </div>
        <div className="metric-item">
          <span>Slope:</span>
          <span className="metric-val">{slopeDbKm.toFixed(3)} dB/km</span>
        </div>
        {hoverInfo && (
          <div className="metric-item">
            <span>Kursor:</span>
            <span className="metric-val">
              {(Math.max(0, hoverInfo.distM) / 1000).toFixed(3)} km / {hoverInfo.db.toFixed(2)} dB
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
