import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { classifyEventCode, formatEventTypeLabel, propTimeToMeters } from '../sor/constants';
import { NewEventParams } from '../sor/editor';
import { EventKind, KeyEvent, SorDocument } from '../sor/types';

interface EventsPanelProps {
  doc: SorDocument;
  selectedEventIndex: number | null;
  onSelectEvent: (idx: number | null) => void;
  pendingAddDistanceM: number | null;
  onClearPendingAddDistance: () => void;
  onAddEvent: (params: NewEventParams) => void;
  onDeleteEvent: (idx: number, healTrace: boolean) => void;
  onUpdateEvent: (
    idx: number,
    patch: Partial<KeyEvent> & { distanceMeters?: number },
    syncLoss: boolean,
    syncDistance?: boolean
  ) => void;
  onUpdateSummary: (endToEndLossDb: number, opticalReturnLossDb: number) => void;
  onRecalculateSummary: () => void;
}

export const EventsPanel: React.FC<EventsPanelProps> = ({
  doc,
  selectedEventIndex,
  onSelectEvent,
  pendingAddDistanceM,
  onClearPendingAddDistance,
  onAddEvent,
  onDeleteEvent,
  onUpdateEvent,
  onUpdateSummary,
  onRecalculateSummary,
}) => {
  const ior = doc.fxdParams.groupIndex || 1.468;
  const events = doc.keyEvents.events;
  const selectedEv = selectedEventIndex !== null ? events[selectedEventIndex] ?? null : null;

  const [healOnDelete, setHealOnDelete] = useState(true);
  const [syncLossOnEdit, setSyncLossOnEdit] = useState(true);
  const [syncDistanceOnEdit, setSyncDistanceOnEdit] = useState(true);
  const currentSelectedDistM = selectedEv
    ? Math.round(propTimeToMeters(selectedEv.propagationTime, ior))
    : 0;
  const [distInput, setDistInput] = useState<string>(String(currentSelectedDistM));

  useEffect(() => {
    setDistInput(String(currentSelectedDistM));
  }, [selectedEventIndex, currentSelectedDistM]);

  const commitDistanceChange = () => {
    if (selectedEventIndex === null || !selectedEv) return;
    const parsed = Math.max(0, Math.round(Number(distInput)));
    if (!Number.isFinite(parsed) || parsed === currentSelectedDistM) return;
    onUpdateEvent(selectedEventIndex, { distanceMeters: parsed }, false, syncDistanceOnEdit);
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [newDistM, setNewDistM] = useState('5000');
  const [newKind, setNewKind] = useState<EventKind>('non-reflective');
  const [newLossDb, setNewLossDb] = useState('0.15');
  const [newReflDb, setNewReflDb] = useState('-42.0');
  const [newSlope, setNewSlope] = useState('0.25');
  const [newComment, setNewComment] = useState('Manual Event');
  const [modifyTraceOnAdd, setModifyTraceOnAdd] = useState(true);

  useEffect(() => {
    if (pendingAddDistanceM !== null) {
      setNewDistM(String(Math.round(pendingAddDistanceM)));
      setShowAddForm(true);
      onClearPendingAddDistance();
    }
  }, [pendingAddDistanceM, onClearPendingAddDistance]);

  const handleCreateEvent = () => {
    onAddEvent({
      distanceMeters: Math.max(0, Number(newDistM) || 0),
      kind: newKind,
      eventLossDb: Number(newLossDb) || 0,
      eventReflectanceDb: newKind === 'non-reflective' ? 0 : Number(newReflDb) || -45,
      attenuationCoeffDbKm: Number(newSlope) || 0.25,
      comment: newComment,
      modifyTrace: modifyTraceOnAdd,
    });
    setShowAddForm(false);
  };

  return (
    <div>
      <div className="section-card">
        <div className="section-title">
          <span>Daftar Event ({events.length})</span>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            <Plus size={13} /> Tambah Event
          </button>
        </div>

        {showAddForm && (
          <div
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--accent-strong)',
              borderRadius: 6,
              padding: 10,
              marginBottom: 12,
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label>Jarak (meter)</label>
                <input
                  type="number"
                  className="mono"
                  value={newDistM}
                  onChange={(e) => setNewDistM(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Tipe Event</label>
                <select value={newKind} onChange={(e) => setNewKind(e.target.value as EventKind)}>
                  <option value="non-reflective">Non-Reflective (Splice)</option>
                  <option value="reflective">Reflective (Connector)</option>
                  <option value="end-of-fiber">End of Fiber</option>
                </select>
              </div>
              <div className="field">
                <label>Event Loss (dB)</label>
                <input
                  type="number"
                  step={0.01}
                  value={newLossDb}
                  onChange={(e) => setNewLossDb(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Reflectance (dB)</label>
                <input
                  type="number"
                  step={0.5}
                  disabled={newKind === 'non-reflective'}
                  value={newKind === 'non-reflective' ? '0' : newReflDb}
                  onChange={(e) => setNewReflDb(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Slope Segmen (dB/km)</label>
                <input
                  type="number"
                  step={0.01}
                  value={newSlope}
                  onChange={(e) => setNewSlope(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Komentar</label>
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
              </div>
              <div className="field full">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={modifyTraceOnAdd}
                    onChange={(e) => setModifyTraceOnAdd(e.target.checked)}
                  />
                  <span>Terapkan efek fisik (drop loss / spike pantulan) langsung ke kurva grafik</span>
                </label>
              </div>
              <div className="field full" style={{ flexDirection: 'row', gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={handleCreateEvent}>
                  Simpan Event Baru
                </button>
                <button className="btn btn-sm" onClick={() => setShowAddForm(false)}>
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="events-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Jarak (km)</th>
                <th>Tipe</th>
                <th>Loss (dB)</th>
                <th>Refl (dB)</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => {
                const distM = propTimeToMeters(ev.propagationTime, ior);
                const kind = classifyEventCode(ev.eventCode);
                return (
                  <tr
                    key={`${ev.eventNumber}-${idx}`}
                    className={selectedEventIndex === idx ? 'selected' : ''}
                    onClick={() => onSelectEvent(idx)}
                  >
                    <td className="mono">{ev.eventNumber}</td>
                    <td className="mono">{(distM / 1000).toFixed(3)}</td>
                    <td>
                      <span
                        style={{
                          color:
                            kind === 'end-of-fiber'
                              ? '#f87171'
                              : kind === 'reflective'
                              ? '#c4b5fd'
                              : '#34d399',
                          fontWeight: 600,
                        }}
                      >
                        {kind === 'end-of-fiber'
                          ? 'EOF'
                          : kind === 'reflective'
                          ? 'Refl'
                          : 'Splice'}
                      </span>
                    </td>
                    <td className="mono">{ev.eventLossDb.toFixed(3)}</td>
                    <td className="mono">
                      {ev.eventReflectanceDb === 0 ? '—' : ev.eventReflectanceDb.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 14 }}>
                    Belum ada event di tabel KeyEvents.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEv && selectedEventIndex !== null && (
        <div className="section-card">
          <div className="section-title">
            <span>
              Edit Event #{selectedEv.eventNumber} ({formatEventTypeLabel(selectedEv)})
            </span>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                onDeleteEvent(selectedEventIndex, healOnDelete);
                onSelectEvent(null);
              }}
            >
              <Trash2 size={13} /> Hapus
            </button>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Jarak Event (meter)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  step={1}
                  className="mono"
                  value={distInput}
                  onChange={(e) => setDistInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                      commitDistanceChange();
                    }
                  }}
                  onBlur={commitDistanceChange}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={Math.round(Number(distInput)) === currentSelectedDistM}
                  onClick={commitDistanceChange}
                  title="Pindahkan posisi event (dan kurva jika sinkron aktif)"
                >
                  Pindah
                </button>
              </div>
            </div>
            <div className="field">
              <label>Kode Event (6 char)</label>
              <input
                type="text"
                maxLength={6}
                className="mono"
                value={selectedEv.eventCode}
                onChange={(e) =>
                  onUpdateEvent(selectedEventIndex, { eventCode: e.target.value }, false)
                }
              />
            </div>
            <div className="field">
              <label>Event Loss (dB)</label>
              <input
                type="number"
                step={0.01}
                className="mono"
                value={selectedEv.eventLossDb}
                onChange={(e) =>
                  onUpdateEvent(
                    selectedEventIndex,
                    { eventLossDb: Number(e.target.value) || 0 },
                    syncLossOnEdit
                  )
                }
              />
            </div>
            <div className="field">
              <label>Reflectance (dB)</label>
              <input
                type="number"
                step={0.1}
                className="mono"
                value={selectedEv.eventReflectanceDb}
                onChange={(e) =>
                  onUpdateEvent(
                    selectedEventIndex,
                    { eventReflectanceDb: Number(e.target.value) || 0 },
                    false
                  )
                }
              />
            </div>
            <div className="field">
              <label>Slope Segmen (dB/km)</label>
              <input
                type="number"
                step={0.005}
                className="mono"
                value={selectedEv.attenuationCoeffDbKm}
                onChange={(e) =>
                  onUpdateEvent(
                    selectedEventIndex,
                    { attenuationCoeffDbKm: Number(e.target.value) || 0 },
                    false
                  )
                }
              />
            </div>
            <div className="field">
              <label>Teknik Pengukuran</label>
              <select
                value={selectedEv.lossMeasurementTechnique}
                onChange={(e) =>
                  onUpdateEvent(
                    selectedEventIndex,
                    { lossMeasurementTechnique: e.target.value },
                    false
                  )
                }
              >
                <option value="2P">2P (2-Point)</option>
                <option value="LS">LS (Least Squares)</option>
              </select>
            </div>
            <div className="field full">
              <label>Komentar Event</label>
              <input
                type="text"
                value={selectedEv.comment}
                onChange={(e) =>
                  onUpdateEvent(selectedEventIndex, { comment: e.target.value }, false)
                }
              />
            </div>
            <div className="field full">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={syncDistanceOnEdit}
                  onChange={(e) => setSyncDistanceOnEdit(e.target.checked)}
                />
                <span>Saat jarak diubah, geser fitur fisik event (spike / end-of-fiber) di grafik</span>
              </label>
              <label className="checkbox-row" style={{ marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={syncLossOnEdit}
                  onChange={(e) => setSyncLossOnEdit(e.target.checked)}
                />
                <span>Sinkronkan perubahan Loss ke kurva grafik</span>
              </label>
              <label className="checkbox-row" style={{ marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={healOnDelete}
                  onChange={(e) => setHealOnDelete(e.target.checked)}
                />
                <span>Saat dihapus, haluskan efek event pada kurva grafik</span>
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="section-card">
        <div className="section-title">
          <span>Ringkasan Link (KeyEvents Summary)</span>
          <button className="btn btn-sm" onClick={onRecalculateSummary}>
            <RefreshCw size={12} /> Hitung Ulang
          </button>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>End-to-End Loss (dB)</label>
            <input
              type="number"
              step={0.01}
              className="mono"
              value={doc.keyEvents.endToEndLossDb}
              onChange={(e) =>
                onUpdateSummary(Number(e.target.value) || 0, doc.keyEvents.opticalReturnLossDb)
              }
            />
          </div>
          <div className="field">
            <label>Optical Return Loss / ORL (dB)</label>
            <input
              type="number"
              step={0.1}
              className="mono"
              value={doc.keyEvents.opticalReturnLossDb}
              onChange={(e) =>
                onUpdateSummary(doc.keyEvents.endToEndLossDb, Number(e.target.value) || 0)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};
