# OTDR .SOR Studio

Web application for viewing, analyzing, editing, and exporting Telcordia SR-4731 (`.sor` v1/v2) OTDR trace files directly in the browser.

## Features
- **Read & Inspect `.sor` Files**: Supports Bellcore GR-196 (v1) and Telcordia SR-4731 (v2) with dynamic `Map` block parsing, `Cksum` CRC-16/CCITT-FALSE verification, and vendor block preservation/stripping.
- **Interactive Trace Canvas**: Zoom, pan, dual cursors (Marker A/B) with ΔDistance/ΔLoss/Slope readouts, event pins, click-to-add-event, and freehand curve drawing.
- **Full `.sor` Editing**:
  - Edit `GenParams` & `SupParams` metadata and custom output filename.
  - Edit `FxdParams` date/time (with 32-bit Year-2038 guard), wavelength, pulse width, IOR, and fiber length (truncate/extend or rescale spacing).
  - Add, edit, move (with physical trace spike & end-of-fiber shifting), and delete `KeyEvents` with automatic `endToEndLossDb`, `markerLocations`, and `orlMarkerEnd` synchronization.
  - Curve tools: vertical dB shift, segment slope adjustment, smoothing, and noise injection.
- **Export**: Save valid `.sor` (recalculated `Map` & CRC-16), `.pdf` (OTDR Test Report), `.csv`, and `.json`.

## Development

```bash
npm install
npm run dev
```

## Testing & Build

```bash
npm test
npm run build
```
