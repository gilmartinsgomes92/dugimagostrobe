# Dugimago Handpan Tuning Check

Production-ready web tuner (React + Vite + TypeScript) designed for **iPhone Safari/Chrome**.

## What it does

- **Linotune-style strobe** using **phase drift / phase-vocoder instantaneous frequency** (not FFT peak cents meter).
- **Auto note detection** (60–1200 Hz) with stability gating (~380ms).
- **Lock/Auto toggle** — lock keeps the target note fixed.
- **Three strobe lanes** for:
  - Octave (2×)
  - Fundamental (1×)
  - Compound fifth (3×)

## Dev

```bash
npm install
npm run dev
```

## Build (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`

```bash
npm run build
npm run preview
```

## Debug

Append `?debug` to the URL to show RMS, noise floor, target, locked state, confidence, and raw vs smoothed cents.
