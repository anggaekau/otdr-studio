import React, { useEffect, useRef, useState } from 'react';
import { getSampleSpacingMeters, getTotalTraceLengthMeters } from '../sor/constants';
import { LengthEditMode } from '../sor/editor';
import { DistanceUnit, FxdParams, SorDocument } from '../sor/types';

interface AcquisitionPanelProps {
  doc: SorDocument;
  onUpdateFxdParams: (patch: Partial<FxdParams>) => void;
  onChangeFiberLength: (
    newLengthMeters: number,
    mode: LengthEditMode,
    options: { extendSlopeDbKm: number; moveEndEventToNewLength: boolean }
  ) => void;
}

function toDatetimeLocalValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

export const AcquisitionPanel: React.FC<AcquisitionPanelProps> = ({
  doc,
  onUpdateFxdParams,
  onChangeFiberLength,
}) => {
  const { fxdParams } = doc;
  const totalMeters = getTotalTraceLengthMeters(doc);
  const dx = getSampleSpacingMeters(doc);
  const pulse = fxdParams.pulseEntries[0] ?? { pulseWidthNs: 100, dataSpacing: 489672, numDataPoints: doc.dataPts.rawPoints.length };

  const [targetLengthM, setTargetLengthM] = useState<string>(String(Math.round(totalMeters)));
  const [lengthMode, setLengthMode] = useState<LengthEditMode>('truncate-extend');
  const [extendSlopeDbKm, setExtendSlopeDbKm] = useState<string>('0.35');
  const [moveEndEvent, setMoveEndEvent] = useState<boolean>(true);

  useEffect(() => {
    setTargetLengthM(String(Math.round(totalMeters)));
  }, [totalMeters]);

  const isTimestampOverflow = fxdParams.timestamp > 2147483647;
  const [dateInput, setDateInput] = useState<string>(() => toDatetimeLocalValue(fxdParams.timestamp));
  const isEditingDateRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isEditingDateRef.current) {
      setDateInput(toDatetimeLocalValue(fxdParams.timestamp));
    }
  }, [fxdParams.timestamp]);

  const handleDateChange = (val: string) => {
    setDateInput(val);
    if (!val) return;
    const ms = new Date(val).getTime();
    if (!Number.isNaN(ms)) {
      const sec = Math.floor(ms / 1000);
      if (sec >= 0 && sec <= 2147483647) {
        onUpdateFxdParams({ timestamp: sec });
      }
    }
  };

  const handleDateBlur = () => {
    isEditingDateRef.current = false;
    setDateInput(toDatetimeLocalValue(fxdParams.timestamp));
  };

  const applyLengthChange = () => {
    const parsed = Number(targetLengthM);
    if (!Number.isFinite(parsed) || parsed < 10) return;
    onChangeFiberLength(parsed, lengthMode, {
      extendSlopeDbKm: Number(extendSlopeDbKm) || 0.35,
      moveEndEventToNewLength: moveEndEvent,
    });
  };

  return (
    <div>
      <div className="section-card">
        <div className="section-title">
          <span>Waktu &amp; Tanggal Pengukuran (FxdParams)</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const nowSec = Math.min(2147483647, Math.floor(Date.now() / 1000));
              isEditingDateRef.current = false;
              onUpdateFxdParams({ timestamp: nowSec });
              setDateInput(toDatetimeLocalValue(nowSec));
            }}
          >
            Waktu Sekarang
          </button>
        </div>
        <div className="form-grid">
          <div className="field full">
            <label>Tanggal &amp; Waktu Lokal (Disimpan sebagai Unix Timestamp UTC)</label>
            <input
              type="datetime-local"
              step={1}
              min="1970-01-01T00:00:00"
              max="2038-01-19T03:14:07"
              value={dateInput}
              onFocus={() => {
                isEditingDateRef.current = true;
              }}
              onChange={(e) => handleDateChange(e.target.value)}
              onBlur={handleDateBlur}
            />
          </div>
          <div className="field full">
            <label>Unix Epoch Timestamp (detik, maks 2147483647 / tahun 2038)</label>
            <input
              type="number"
              className="mono"
              min={0}
              max={2147483647}
              value={fxdParams.timestamp}
              onChange={(e) =>
                onUpdateFxdParams({
                  timestamp: Math.max(0, Math.min(2147483647, Number(e.target.value) || 0)),
                })
              }
            />
            {isTimestampOverflow && (
              <div
                style={{
                  marginTop: 6,
                  padding: '6px 8px',
                  borderRadius: 5,
                  background: 'rgba(239, 68, 68, 0.16)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#fca5a5',
                  fontSize: 11,
                }}
              >
                Peringatan: Timestamp melewati batas 32-bit (19 Jan 2038). Aplikasi 32-bit seperti EXFO Toolbox bisa crash! Ubah ke tahun 1970–2037.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Ubah Panjang / Jarak Hasil OTDR</h3>
        <div className="form-grid">
          <div className="field">
            <label>Panjang Saat Ini</label>
            <input
              type="text"
              readOnly
              className="mono"
              value={`${(totalMeters / 1000).toFixed(3)} km (${Math.round(totalMeters)} m)`}
            />
          </div>
          <div className="field">
            <label>Resolusi / Jumlah Titik</label>
            <input
              type="text"
              readOnly
              className="mono"
              value={`${dx.toFixed(2)} m/pt · ${doc.dataPts.rawPoints.length} pts`}
            />
          </div>

          <div className="field">
            <label>Target Panjang Baru (meter)</label>
            <input
              type="number"
              min={10}
              step={10}
              className="mono"
              value={targetLengthM}
              onChange={(e) => setTargetLengthM(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Metode Perubahan Panjang</label>
            <select value={lengthMode} onChange={(e) => setLengthMode(e.target.value as LengthEditMode)}>
              <option value="truncate-extend">Potong / Perpanjang (Spasi Tetap)</option>
              <option value="rescale-spacing">Skala Ulang Spasi (Stretch/Compress)</option>
            </select>
          </div>

          {lengthMode === 'truncate-extend' && (
            <>
              <div className="field">
                <label>Slope Perpanjangan (dB/km)</label>
                <input
                  type="number"
                  step={0.01}
                  value={extendSlopeDbKm}
                  onChange={(e) => setExtendSlopeDbKm(e.target.value)}
                />
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label className="checkbox-row" style={{ marginTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={moveEndEvent}
                    onChange={(e) => setMoveEndEvent(e.target.checked)}
                  />
                  <span>Geser End-of-Fiber otomatis</span>
                </label>
              </div>
            </>
          )}

          <div className="field full">
            <button className="btn btn-primary" onClick={applyLengthChange}>
              Terapkan Panjang OTDR Baru
            </button>
            <p className="hint-text" style={{ margin: '6px 0 0' }}>
              Mode <b>Potong/Perpanjang</b> menambah atau memotong titik kurva dengan resolusi tetap. Mode{' '}
              <b>Skala Ulang Spasi</b> mengubah <i>data spacing</i> sehingga seluruh kurva dan posisi event ikut memanjang/memendek proporsional.
            </p>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Parameter Akuisisi Optik</h3>
        <div className="form-grid">
          <div className="field">
            <label>Wavelength Aktual (nm)</label>
            <input
              type="number"
              step={0.1}
              value={fxdParams.actualWavelengthNm}
              onChange={(e) =>
                onUpdateFxdParams({ actualWavelengthNm: Math.max(100, Number(e.target.value) || 1550) })
              }
            />
          </div>
          <div className="field">
            <label>Pulse Width (ns)</label>
            <input
              type="number"
              min={1}
              value={pulse.pulseWidthNs}
              onChange={(e) => {
                const pw = Math.max(1, Number(e.target.value) || 100);
                const updated = fxdParams.pulseEntries.map((entry, idx) =>
                  idx === 0 ? { ...entry, pulseWidthNs: pw } : entry
                );
                onUpdateFxdParams({ pulseEntries: updated });
              }}
            />
          </div>

          <div className="field">
            <label>Index of Refraction (IOR)</label>
            <input
              type="number"
              step={0.0001}
              min={1.0}
              max={2.0}
              value={fxdParams.groupIndex}
              onChange={(e) =>
                onUpdateFxdParams({ groupIndex: Math.max(1.0, Math.min(2.0, Number(e.target.value) || 1.468)) })
              }
            />
          </div>
          <div className="field">
            <label>Backscatter Coeff (dB)</label>
            <input
              type="number"
              step={0.1}
              value={fxdParams.backscatterCoeffDb}
              onChange={(e) => onUpdateFxdParams({ backscatterCoeffDb: Number(e.target.value) || -79.4 })}
            />
          </div>

          <div className="field">
            <label>Jumlah Averages</label>
            <input
              type="number"
              min={1}
              value={fxdParams.numAverages}
              onChange={(e) => onUpdateFxdParams({ numAverages: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label>Waktu Averaging (detik)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              value={fxdParams.averagingTimeSec}
              onChange={(e) => onUpdateFxdParams({ averagingTimeSec: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>

          <div className="field">
            <label>Satuan Jarak</label>
            <select
              value={fxdParams.units}
              onChange={(e) => onUpdateFxdParams({ units: e.target.value as DistanceUnit })}
            >
              <option value="km">km (Kilometer)</option>
              <option value="mt">mt (Meter)</option>
              <option value="ft">ft (Feet)</option>
              <option value="kf">kf (Kilofeet)</option>
              <option value="mi">mi (Miles)</option>
            </select>
          </div>
          <div className="field">
            <label>Tipe Trace</label>
            <select
              value={fxdParams.traceType}
              onChange={(e) => onUpdateFxdParams({ traceType: e.target.value })}
            >
              <option value="ST">ST (Standard Trace)</option>
              <option value="RT">RT (Reverse Trace)</option>
              <option value="DT">DT (Difference Trace)</option>
              <option value="RF">RF (Reference Trace)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
