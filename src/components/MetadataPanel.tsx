import React from 'react';
import { FIBER_TYPES } from '../sor/constants';
import { GenParams, SorDocument, SupParams } from '../sor/types';

interface MetadataPanelProps {
  doc: SorDocument;
  onUpdateFileName: (name: string) => void;
  onUpdateGenParams: (patch: Partial<GenParams>) => void;
  onUpdateSupParams: (patch: Partial<SupParams>) => void;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({
  doc,
  onUpdateFileName,
  onUpdateGenParams,
  onUpdateSupParams,
}) => {
  const { genParams, supParams } = doc;

  return (
    <div>
      <div className="section-card">
        <h3 className="section-title">Informasi Umum & Jalur Kabel (GenParams)</h3>
        <div className="form-grid">
          <div className="field full">
            <label>Nama File Output (.sor / .pdf)</label>
            <input
              type="text"
              className="mono"
              value={doc.fileName}
              onChange={(e) => onUpdateFileName(e.target.value)}
              placeholder="Contoh: OTDR 1477M 1550nm.SOR"
            />
          </div>
          <div className="field">
            <label>Cable ID</label>
            <input
              type="text"
              value={genParams.cableId}
              onChange={(e) => onUpdateGenParams({ cableId: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Fiber ID / Core</label>
            <input
              type="text"
              value={genParams.fiberId}
              onChange={(e) => onUpdateGenParams({ fiberId: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Lokasi Asal (Location A)</label>
            <input
              type="text"
              value={genParams.originatingLocation}
              onChange={(e) => onUpdateGenParams({ originatingLocation: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Lokasi Tujuan (Location B)</label>
            <input
              type="text"
              value={genParams.terminatingLocation}
              onChange={(e) => onUpdateGenParams({ terminatingLocation: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Tipe Fiber (ITU-T)</label>
            <select
              value={genParams.fiberType}
              onChange={(e) => onUpdateGenParams({ fiberType: Number(e.target.value) })}
            >
              {FIBER_TYPES.map((ft) => (
                <option key={ft.code} value={ft.code}>
                  {ft.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nominal Wavelength (nm)</label>
            <input
              type="number"
              value={genParams.nominalWavelength}
              onChange={(e) => onUpdateGenParams({ nominalWavelength: Number(e.target.value) || 1550 })}
            />
          </div>

          <div className="field">
            <label>Cable Code</label>
            <input
              type="text"
              value={genParams.cableCode}
              onChange={(e) => onUpdateGenParams({ cableCode: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Operator / Teknisi</label>
            <input
              type="text"
              value={genParams.operator}
              onChange={(e) => onUpdateGenParams({ operator: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Status Data (Flag)</label>
            <select
              value={genParams.currentDataFlag}
              onChange={(e) => onUpdateGenParams({ currentDataFlag: e.target.value })}
            >
              <option value="BC">BC (As-Built Cable)</option>
              <option value="CC">CC (Current Condition)</option>
              <option value="RC">RC (Reference Cable)</option>
              <option value="OT">OT (Other)</option>
            </select>
          </div>
          <div className="field">
            <label>Kode Bahasa (2 huruf)</label>
            <input
              type="text"
              maxLength={2}
              value={genParams.languageCode}
              onChange={(e) => onUpdateGenParams({ languageCode: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="field full">
            <label>Catatan / Comments</label>
            <textarea
              rows={3}
              value={genParams.comments}
              onChange={(e) => onUpdateGenParams({ comments: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Perangkat & Vendor OTDR (SupParams)</h3>
        <div className="form-grid">
          <div className="field">
            <label>Supplier / Vendor</label>
            <input
              type="text"
              value={supParams.supplierName}
              onChange={(e) => onUpdateSupParams({ supplierName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Model Mainframe OTDR</label>
            <input
              type="text"
              value={supParams.otdrMainframeId}
              onChange={(e) => onUpdateSupParams({ otdrMainframeId: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Serial Mainframe</label>
            <input
              type="text"
              value={supParams.otdrMainframeSerial}
              onChange={(e) => onUpdateSupParams({ otdrMainframeSerial: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Model Modul Optik</label>
            <input
              type="text"
              value={supParams.opticalModuleId}
              onChange={(e) => onUpdateSupParams({ opticalModuleId: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Serial Modul</label>
            <input
              type="text"
              value={supParams.opticalModuleSerial}
              onChange={(e) => onUpdateSupParams({ opticalModuleSerial: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Versi Software</label>
            <input
              type="text"
              value={supParams.softwareVersion}
              onChange={(e) => onUpdateSupParams({ softwareVersion: e.target.value })}
            />
          </div>
          <div className="field full">
            <label>Info Tambahan (Other)</label>
            <input
              type="text"
              value={supParams.other}
              onChange={(e) => onUpdateSupParams({ other: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
