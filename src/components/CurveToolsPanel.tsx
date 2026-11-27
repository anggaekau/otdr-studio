import React, { useState } from 'react';
import { PenTool, ShieldCheck } from 'lucide-react';
import { getTotalTraceLengthMeters } from '../sor/constants';
import { SorDocument, SorVersion } from '../sor/types';

interface CurveToolsPanelProps {
  doc: SorDocument;
  markerAMeters: number;
  markerBMeters: number;
  onShiftVertical: (deltaDb: number) => void;
  onAdjustSlope: (startM: number, endM: number, targetSlopeDbKm: number) => void;
  onSmoothSegment: (startM: number, endM: number, radius: number) => void;
  onAddNoise: (startM: number, endM: number, amplitudeDb: number) => void;
  onActivateDrawMode: () => void;
  targetVersion: SorVersion;
  onChangeTargetVersion: (v: SorVersion) => void;
  includeExtraBlocks: boolean;
  onToggleIncludeExtraBlocks: (val: boolean) => void;
}

export const CurveToolsPanel: React.FC<CurveToolsPanelProps> = ({
  doc,
  markerAMeters,
  markerBMeters,
  onShiftVertical,
  onAdjustSlope,
  onSmoothSegment,
  onAddNoise,
  onActivateDrawMode,
  targetVersion,
  onChangeTargetVersion,
  includeExtraBlocks,
  onToggleIncludeExtraBlocks,
}) => {
  const totalMeters = getTotalTraceLengthMeters(doc);
  const [shiftDb, setShiftDb] = useState('1.0');
  const [startM, setStartM] = useState('0');
  const [endM, setEndM] = useState(String(Math.round(totalMeters)));
  const [targetSlope, setTargetSlope] = useState('0.22');
  const [noiseAmp, setNoiseAmp] = useState('0.08');

  const fillFromMarkers = () => {
    const a = Math.min(markerAMeters, markerBMeters);
    const b = Math.max(markerAMeters, markerBMeters);
    setStartM(String(Math.round(a)));
    setEndM(String(Math.round(b)));
  };

  return (
    <div>
      <div className="section-card">
        <h3 className="section-title">Edit Gambar Kurva Grafik (DataPts)</h3>
        <div className="form-grid-1">
          <button className="btn btn-primary" onClick={onActivateDrawMode}>
            <PenTool size={14} /> Aktifkan Mode Gambar Kurva Bebas di Grafik
          </button>
          <p className="hint-text" style={{ margin: 0 }}>
            Klik &amp; seret langsung di atas kanvas grafik untuk membentuk ulang titik-titik kurva OTDR sesuai kebutuhan.
          </p>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Geser Level Vertikal (dB)</label>
            <input
              type="number"
              step={0.2}
              className="mono"
              value={shiftDb}
              onChange={(e) => setShiftDb(e.target.value)}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => onShiftVertical(Math.abs(Number(shiftDb) || 0))}
            >
              + Naik
            </button>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => onShiftVertical(-Math.abs(Number(shiftDb) || 0))}
            >
              - Turun
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title">
          <span>Edit Segmen Rentang Jarak</span>
          <button className="btn btn-sm" onClick={fillFromMarkers}>
            Pakai Marker A → B
          </button>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Dari Jarak (meter)</label>
            <input
              type="number"
              className="mono"
              value={startM}
              onChange={(e) => setStartM(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Sampai Jarak (meter)</label>
            <input
              type="number"
              className="mono"
              value={endM}
              onChange={(e) => setEndM(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Target Slope Segmen (dB/km)</label>
            <input
              type="number"
              step={0.01}
              className="mono"
              value={targetSlope}
              onChange={(e) => setTargetSlope(e.target.value)}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button
              className="btn btn-sm"
              style={{ marginTop: 14 }}
              onClick={() =>
                onAdjustSlope(Number(startM) || 0, Number(endM) || totalMeters, Number(targetSlope) || 0.22)
              }
            >
              Terapkan Slope
            </button>
          </div>

          <div className="field">
            <label>Amplitudo Noise (dB)</label>
            <input
              type="number"
              step={0.02}
              min={0.01}
              className="mono"
              value={noiseAmp}
              onChange={(e) => setNoiseAmp(e.target.value)}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => onSmoothSegment(Number(startM) || 0, Number(endM) || totalMeters, 4)}
            >
              Haluskan
            </button>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() =>
                onAddNoise(Number(startM) || 0, Number(endM) || totalMeters, Number(noiseAmp) || 0.08)
              }
            >
              + Noise
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>Struktur Biner &amp; Ekspor .SOR</span>
          <ShieldCheck size={14} />
        </h3>
        <div className="form-grid">
          <div className="field">
            <label>Versi Output .SOR</label>
            <select
              value={targetVersion}
              onChange={(e) => onChangeTargetVersion(Number(e.target.value) as SorVersion)}
            >
              <option value={2}>v2.00 (Telcordia SR-4731)</option>
              <option value={1}>v1.00 (Bellcore GR-196)</option>
            </select>
          </div>
          <div className="field">
            <label>Status CRC-16 Asli</label>
            <input
              type="text"
              readOnly
              className="mono"
              value={
                doc.checksumInfo.present
                  ? `${doc.checksumInfo.valid ? 'VALID' : 'MISMATCH'} (0x${doc.checksumInfo.stored
                      .toString(16)
                      .toUpperCase()
                      .padStart(4, '0')})`
                  : 'Tidak ada blok Cksum'
              }
            />
          </div>

          <div className="field full">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeExtraBlocks}
                onChange={(e) => onToggleIncludeExtraBlocks(e.target.checked)}
              />
              <span>
                Pertahankan blok proprietary vendor ({doc.extraBlocks.length} blok ditemukan)
              </span>
            </label>
          </div>

          <div className="field full">
            <label>Daftar Blok dalam File</label>
            <div
              className="mono"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 5,
                padding: 8,
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              {doc.blockOrder.join(' → ')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
