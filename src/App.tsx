import React, { useCallback, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  ListTree,
  Redo2,
  Sliders,
  Undo2,
  Upload,
} from 'lucide-react';
import { AcquisitionPanel } from './components/AcquisitionPanel';
import { CurveToolsPanel } from './components/CurveToolsPanel';
import { EventsPanel } from './components/EventsPanel';
import { MetadataPanel } from './components/MetadataPanel';
import { CanvasMode, TraceCanvas } from './components/TraceCanvas';
import {
  getSampleSpacingMeters,
  getTotalTraceLengthMeters,
  propTimeToMeters,
  rawPointToDb,
} from './sor/constants';
import {
  addEventWithTraceEffect,
  addTraceNoise,
  adjustSegmentSlope,
  applyBrushPoints,
  changeFiberLength,
  cloneSorDocument,
  deleteEventWithTraceEffect,
  LengthEditMode,
  NewEventParams,
  recomputeKeyEventsSummary,
  shiftTraceVerticalDb,
  smoothTraceSegment,
  updateEventAtIndex,
} from './sor/editor';
import { parseSorBuffer } from './sor/parser';
import { downloadOtdrPdfReport } from './sor/pdfReport';
import { createSampleSorDocument } from './sor/sampleGenerator';
import { FxdParams, GenParams, KeyEvent, SorDocument, SorVersion, SupParams } from './sor/types';
import { serializeSorDocument } from './sor/writer';

type EditorTab = 'events' | 'metadata' | 'acquisition' | 'curve';

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const App: React.FC = () => {
  const [doc, setDoc] = useState<SorDocument>(() => createSampleSorDocument('metro-18km'));
  const [undoStack, setUndoStack] = useState<SorDocument[]>([]);
  const [redoStack, setRedoStack] = useState<SorDocument[]>([]);
  const [activeTab, setActiveTab] = useState<EditorTab>('events');
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('pan');
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(0);
  const [markerAMeters, setMarkerAMeters] = useState<number>(0);
  const [markerBMeters, setMarkerBMeters] = useState<number>(18420);
  const [relativeDbView, setRelativeDbView] = useState<boolean>(true);
  const [pendingAddDistM, setPendingAddDistM] = useState<number | null>(null);
  const [targetVersion, setTargetVersion] = useState<SorVersion>(2);
  const [includeExtraBlocks, setIncludeExtraBlocks] = useState<boolean>(true);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<SorDocument>(doc);
  const markersRef = useRef<{ a: number; b: number }>({ a: markerAMeters, b: markerBMeters });
  const isEditedRef = useRef<boolean>(false);

  const updateMarkers = useCallback((a: number, b: number) => {
    markersRef.current = { a, b };
    setMarkerAMeters(a);
    setMarkerBMeters(b);
  }, []);

  const commitDoc = useCallback((nextDoc: SorDocument, label?: string) => {
    const prevDoc = docRef.current;
    docRef.current = nextDoc;
    isEditedRef.current = true;
    setUndoStack((u) => [...u.slice(-29), prevDoc]);
    setRedoStack([]);
    setDoc(nextDoc);

    // Keep Marker B synced with the end-of-fiber event if it was tracking the previous end or out of bounds
    const prevEvs = prevDoc.keyEvents.events;
    const nextEvs = nextDoc.keyEvents.events;
    const prevEndM =
      prevEvs.length > 0
        ? propTimeToMeters(prevEvs[prevEvs.length - 1].propagationTime, prevDoc.fxdParams.groupIndex || 1.468)
        : getTotalTraceLengthMeters(prevDoc);
    const nextEndM =
      nextEvs.length > 0
        ? propTimeToMeters(nextEvs[nextEvs.length - 1].propagationTime, nextDoc.fxdParams.groupIndex || 1.468)
        : getTotalTraceLengthMeters(nextDoc);
    const maxTraceM = getTotalTraceLengthMeters(nextDoc);

    if (Math.abs(markersRef.current.b - prevEndM) < 25 || markersRef.current.b > maxTraceM) {
      updateMarkers(Math.min(markersRef.current.a, maxTraceM), nextEndM);
    }

    setErrorMsg(null);
    if (label) setStatusMsg(label);
  }, [updateMarkers]);

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    docRef.current = previous;
    isEditedRef.current = undoStack.length > 1;
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, docRef.current === previous ? doc : docRef.current]);
    setDoc(previous);
    setStatusMsg('Undo berhasil');
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    docRef.current = next;
    isEditedRef.current = true;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, doc]);
    setDoc(next);
    setStatusMsg('Redo berhasil');
  };

  const getDefaultEndMeters = (d: SorDocument) => {
    const evs = d.keyEvents.events;
    if (evs.length > 0) {
      return propTimeToMeters(evs[evs.length - 1].propagationTime, d.fxdParams.groupIndex || 1.468);
    }
    return getTotalTraceLengthMeters(d);
  };

  const loadSorFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSorBuffer(buf, file.name);
      docRef.current = parsed;
      isEditedRef.current = false;
      setDoc(parsed);
      setUndoStack([]);
      setRedoStack([]);
      setTargetVersion(parsed.version);
      setSelectedEventIndex(parsed.keyEvents.events.length > 0 ? 0 : null);
      updateMarkers(0, getDefaultEndMeters(parsed));
      setErrorMsg(null);
      setStatusMsg(`File "${file.name}" dimuat (v${parsed.version}.00 · ${parsed.dataPts.rawPoints.length} titik)`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca file .sor');
    }
  };

  const handleLoadSample = (preset: 'metro-18km' | 'ftth-4km') => {
    const sample = createSampleSorDocument(preset);
    docRef.current = sample;
    isEditedRef.current = false;
    setDoc(sample);
    setUndoStack([]);
    setRedoStack([]);
    setTargetVersion(2);
    setSelectedEventIndex(0);
    updateMarkers(0, getDefaultEndMeters(sample));
    setErrorMsg(null);
    setStatusMsg(`Sample "${sample.fileName}" dimuat`);
  };

  const handleUpdateFileName = (name: string) => {
    const next = cloneSorDocument(docRef.current);
    next.fileName = name;
    commitDoc(next);
  };

  const handleUpdateGenParams = (patch: Partial<GenParams>) => {
    const next = cloneSorDocument(docRef.current);
    next.genParams = { ...next.genParams, ...patch };
    commitDoc(next);
  };

  const handleUpdateSupParams = (patch: Partial<SupParams>) => {
    const next = cloneSorDocument(docRef.current);
    next.supParams = { ...next.supParams, ...patch };
    commitDoc(next);
  };

  const handleUpdateFxdParams = (patch: Partial<FxdParams>) => {
    const next = cloneSorDocument(docRef.current);
    next.fxdParams = { ...next.fxdParams, ...patch };
    commitDoc(next);
  };

  const handleChangeFiberLength = (
    newLengthMeters: number,
    mode: LengthEditMode,
    options: { extendSlopeDbKm: number; moveEndEventToNewLength: boolean }
  ) => {
    const next = changeFiberLength(docRef.current, newLengthMeters, mode, options);
    commitDoc(next, `Panjang OTDR diubah ke ${(getTotalTraceLengthMeters(next) / 1000).toFixed(3)} km`);
  };

  const handleAddEvent = (params: NewEventParams) => {
    const next = addEventWithTraceEffect(docRef.current, params);
    commitDoc(next, `Event baru ditambahkan pada ${(params.distanceMeters / 1000).toFixed(3)} km`);
  };

  const handleDeleteEvent = (idx: number, healTrace: boolean) => {
    const next = deleteEventWithTraceEffect(docRef.current, idx, healTrace);
    commitDoc(next, 'Event dihapus');
  };

  const handleUpdateEvent = (
    idx: number,
    patch: Partial<KeyEvent> & { distanceMeters?: number },
    syncLoss: boolean,
    syncDistance = false
  ) => {
    const next = updateEventAtIndex(docRef.current, idx, patch, syncLoss, syncDistance);
    commitDoc(
      next,
      syncDistance && patch.distanceMeters !== undefined
        ? `Event #${idx + 1} & kurva dipindah ke ${(patch.distanceMeters / 1000).toFixed(3)} km`
        : undefined
    );
  };

  const flushActiveInput = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };

  const handleExportSor = () => {
    flushActiveInput();
    try {
      const current = docRef.current;
      const bytes = serializeSorDocument(current, {
        targetVersion,
        includeExtraBlocks,
      });
      const baseName = (current.fileName || 'trace').replace(/\.sor$/i, '').trim() || 'trace';
      const outName = `${baseName}.sor`;
      const bufferCopy = new Uint8Array(bytes).buffer;
      triggerDownload(new Blob([bufferCopy], { type: 'application/octet-stream' }), outName);
      setStatusMsg(`Diekspor ke ${outName} (${bytes.length.toLocaleString()} bytes, CRC-16 valid)`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengekspor .sor');
    }
  };

  const handleExportCsv = () => {
    flushActiveInput();
    const current = docRef.current;
    const dx = getSampleSpacingMeters(current);
    const scale = current.dataPts.scalingFactor || 1000;
    const lines = ['Index,Distance_m,Distance_km,Attenuation_dB,Raw_uint16'];
    current.dataPts.rawPoints.forEach((raw, idx) => {
      const m = idx * dx;
      const db = rawPointToDb(raw, scale);
      lines.push(`${idx},${m.toFixed(3)},${(m / 1000).toFixed(6)},${db.toFixed(4)},${raw}`);
    });
    const baseName = current.fileName.replace(/\.sor$/i, '');
    triggerDownload(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${baseName}_trace.csv`);
    setStatusMsg(`CSV diekspor (${current.dataPts.rawPoints.length} titik)`);
  };

  const handleExportJson = () => {
    flushActiveInput();
    const current = docRef.current;
    const serializable = {
      ...current,
      extraBlocks: current.extraBlocks.map((eb) => ({
        id: eb.id,
        revision: eb.revision,
        byteLength: eb.payload.length,
      })),
    };
    const baseName = current.fileName.replace(/\.sor$/i, '');
    triggerDownload(
      new Blob([JSON.stringify(serializable, null, 2)], { type: 'application/json' }),
      `${baseName}.json`
    );
    setStatusMsg('JSON diekspor');
  };

  const handleExportPdf = () => {
    flushActiveInput();
    try {
      const current = docRef.current;
      const baseName = (current.fileName || 'trace').replace(/\.sor$/i, '').trim() || 'trace';
      const extMatch = current.fileName.match(/\.sor$/i);
      const displaySorName = `${baseName}${extMatch ? extMatch[0] : '.sor'}`;
      const outName = `${baseName}.pdf`;
      downloadOtdrPdfReport(current, {
        relativeDbView,
        markerAMeters: markersRef.current.a,
        markerBMeters: markersRef.current.b,
        outputFileName: outName,
        displayFileName: displaySorName,
      });
      setStatusMsg(`Laporan PDF "${outName}" berhasil disimpan dari data terbaru`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuat laporan PDF');
    }
  };

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void loadSorFile(file);
      }}
    >
      {isDraggingFile && (
        <div className="drop-overlay">
          <Upload size={42} />
          <div>Lepaskan file .SOR untuk membuka &amp; mengedit</div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".sor,.SOR"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadSorFile(f);
          e.target.value = '';
        }}
      />

      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">SOR</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <span className="brand-title" style={{ whiteSpace: 'nowrap' }}>
                OTDR .SOR Studio
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.1 }}>
                  © 2026 OTDR Studio By aeutm
                </span>
                <input
                  type="text"
                  className="mono"
                  value={doc.fileName}
                  onChange={(e) => handleUpdateFileName(e.target.value)}
                  title="Klik untuk mengganti nama file simpan (.sor & .pdf)"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 5,
                    color: 'var(--text-main)',
                    fontSize: 11.5,
                    padding: '2px 7px',
                    width: 215,
                  }}
                />
              </div>
            </div>
            <div className="brand-sub" style={{ marginTop: 2 }}>
              Telcordia SR-4731 v{doc.version}.00 ·{' '}
              {(getTotalTraceLengthMeters(doc) / 1000).toFixed(2)} km · {doc.fxdParams.actualWavelengthNm} nm
            </div>
          </div>
          <span className={`pill ${doc.checksumInfo.valid ? 'pill-ok' : 'pill-warn'}`}>
            {doc.checksumInfo.valid ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {doc.checksumInfo.present ? (doc.checksumInfo.valid ? 'CRC OK' : 'CRC Mismatch') : 'No CRC'}
          </span>
        </div>

        <div className="topbar-actions">
          <button className="btn" onClick={() => fileInputRef.current?.click()}>
            <FolderOpen size={14} /> Buka .SOR
          </button>

          <select
            className="btn"
            value=""
            onChange={(e) => {
              if (e.target.value === 'metro-18km' || e.target.value === 'ftth-4km') {
                handleLoadSample(e.target.value);
              }
            }}
          >
            <option value="" disabled>
              Muat Contoh...
            </option>
            <option value="metro-18km">Sample Metro 18.4 km (1550 nm)</option>
            <option value="ftth-4km">Sample FTTH 4.2 km (1310 nm)</option>
          </select>

          <button className="btn" disabled={undoStack.length === 0} onClick={handleUndo} title="Undo">
            <Undo2 size={14} />
          </button>
          <button className="btn" disabled={redoStack.length === 0} onClick={handleRedo} title="Redo">
            <Redo2 size={14} />
          </button>

          <button className="btn" onClick={handleExportCsv} title="Ekspor kurva ke CSV">
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button className="btn" onClick={handleExportJson} title="Ekspor data ke JSON">
            <FileCode2 size={14} /> JSON
          </button>
          <button className="btn btn-primary" onClick={handleExportPdf} title="Simpan laporan OTDR terbaru ke PDF">
            <FileText size={14} /> Simpan .PDF
          </button>
          <button className="btn btn-primary" onClick={handleExportSor}>
            <Download size={14} /> Simpan .SOR
          </button>
        </div>
      </header>

      {(errorMsg || statusMsg) && (
        <div
          style={{
            padding: '6px 16px',
            fontSize: 12,
            background: errorMsg ? 'rgba(239, 68, 68, 0.16)' : 'rgba(56, 189, 248, 0.12)',
            color: errorMsg ? '#fca5a5' : '#bae6fd',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorMsg ?? statusMsg}</span>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
            }}
            onClick={() => {
              setErrorMsg(null);
              setStatusMsg(null);
            }}
          >
            Tutup
          </button>
        </div>
      )}

      <main className="workspace">
        <TraceCanvas
          doc={doc}
          selectedEventIndex={selectedEventIndex}
          onSelectEvent={(idx) => {
            setSelectedEventIndex(idx);
            setActiveTab('events');
          }}
          markerAMeters={markerAMeters}
          markerBMeters={markerBMeters}
          onChangeMarkers={(a, b) => {
            updateMarkers(a, b);
          }}
          onRequestAddEventAt={(distM) => {
            setPendingAddDistM(distM);
            setActiveTab('events');
            setCanvasMode('pan');
          }}
          onCommitCurveDraw={(updates) => {
            const next = applyBrushPoints(doc, updates);
            commitDoc(next, `Kurva dimodifikasi (${updates.length} titik digambar)`);
          }}
          mode={canvasMode}
          onChangeMode={setCanvasMode}
          relativeDbView={relativeDbView}
          onToggleRelativeDbView={() => setRelativeDbView((v) => !v)}
        />

        <aside className="right-pane">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => setActiveTab('events')}
            >
              <ListTree size={14} /> Events
            </button>
            <button
              className={`tab-btn ${activeTab === 'acquisition' ? 'active' : ''}`}
              onClick={() => setActiveTab('acquisition')}
            >
              <Clock size={14} /> Waktu &amp; Panjang
            </button>
            <button
              className={`tab-btn ${activeTab === 'metadata' ? 'active' : ''}`}
              onClick={() => setActiveTab('metadata')}
            >
              <Sliders size={14} /> Metadata
            </button>
            <button
              className={`tab-btn ${activeTab === 'curve' ? 'active' : ''}`}
              onClick={() => setActiveTab('curve')}
            >
              <Activity size={14} /> Kurva &amp; .SOR
            </button>
          </div>

          <div className="panel-scroll">
            {activeTab === 'events' && (
              <EventsPanel
                doc={doc}
                selectedEventIndex={selectedEventIndex}
                onSelectEvent={setSelectedEventIndex}
                pendingAddDistanceM={pendingAddDistM}
                onClearPendingAddDistance={() => setPendingAddDistM(null)}
                onAddEvent={handleAddEvent}
                onDeleteEvent={handleDeleteEvent}
                onUpdateEvent={handleUpdateEvent}
                onUpdateSummary={(e2e, orl) => {
                  const next = cloneSorDocument(docRef.current);
                  next.keyEvents.endToEndLossDb = e2e;
                  next.keyEvents.opticalReturnLossDb = orl;
                  commitDoc(next);
                }}
                onRecalculateSummary={() => {
                  commitDoc(recomputeKeyEventsSummary(docRef.current), 'Ringkasan KeyEvents dihitung ulang');
                }}
              />
            )}

            {activeTab === 'acquisition' && (
              <AcquisitionPanel
                doc={doc}
                onUpdateFxdParams={handleUpdateFxdParams}
                onChangeFiberLength={handleChangeFiberLength}
              />
            )}

            {activeTab === 'metadata' && (
              <MetadataPanel
                doc={doc}
                onUpdateFileName={handleUpdateFileName}
                onUpdateGenParams={handleUpdateGenParams}
                onUpdateSupParams={handleUpdateSupParams}
              />
            )}

            {activeTab === 'curve' && (
              <CurveToolsPanel
                doc={doc}
                markerAMeters={markerAMeters}
                markerBMeters={markerBMeters}
                onShiftVertical={(delta) =>
                  commitDoc(
                    shiftTraceVerticalDb(docRef.current, delta),
                    `Level trace digeser ${delta > 0 ? '+' : ''}${delta} dB`
                  )
                }
                onAdjustSlope={(s, e, slope) =>
                  commitDoc(
                    adjustSegmentSlope(docRef.current, s, e, slope),
                    `Slope segmen diubah ke ${slope} dB/km`
                  )
                }
                onSmoothSegment={(s, e, radius) =>
                  commitDoc(smoothTraceSegment(docRef.current, s, e, radius), 'Segmen kurva dihaluskan')
                }
                onAddNoise={(s, e, amp) =>
                  commitDoc(addTraceNoise(docRef.current, s, e, amp), `Noise ±${amp} dB ditambahkan`)
                }
                onActivateDrawMode={() => setCanvasMode('drawCurve')}
                targetVersion={targetVersion}
                onChangeTargetVersion={setTargetVersion}
                includeExtraBlocks={includeExtraBlocks}
                onToggleIncludeExtraBlocks={setIncludeExtraBlocks}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
