/**
 * Shared in-browser OCR plumbing (tesseract.js). Documents are read on the
 * device and never sent to an OCR service. PDFs are rendered page by page with
 * pdf.js first, because tesseract only reads images.
 *
 * Speed design (the reading engine is the slow part):
 *  - a small POOL of engines is created once and kept alive between scans, so the
 *    second scan pays no start-up cost (they are released after a few idle minutes);
 *  - `warmUp()` starts the engines the moment a scan dialog opens, so they are ready
 *    by the time a file has been chosen;
 *  - reading modes and pages run in parallel on different engines;
 *  - every page is prepared (resized, grayscale, contrast) only once.
 *
 * Both heavy libraries are imported on demand so they stay out of the main bundle.
 */

import type { Worker } from 'tesseract.js';

export interface ScanProgress {
  status: string;
  /** 0..1 */
  progress: number;
}

export const isPdf = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/* -------------------------------------------------------------------------- */
/* Image preparation                                                           */
/* -------------------------------------------------------------------------- */

const prepared = new WeakMap<Blob, Promise<Blob>>();

/**
 * Grayscale + contrast stretch, sized for reading. Huge phone photos are scaled down
 * (more pixels do not read better, they only read slower); small images are scaled up
 * so thin card text stays legible. Cached per image.
 */
export function preprocess(image: Blob): Promise<Blob> {
  let p = prepared.get(image);
  if (!p) {
    p = doPreprocess(image);
    prepared.set(image, p);
  }
  return p;
}

async function doPreprocess(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > 2400 ? 2400 / long : long < 1400 ? Math.min(2, 1800 / long) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return image;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i]! - lo) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? image), 'image/png'));
}

/* -------------------------------------------------------------------------- */
/* PDF -> images                                                               */
/* -------------------------------------------------------------------------- */

/** Most scanned documents need no more than this; guards against huge PDFs. */
const MAX_PDF_PAGES = 4;

/** Render each PDF page to a PNG at roughly 200 dpi. */
async function pdfToImages(file: File): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: Blob[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 200 / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (blob) pages.push(blob);
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** A PDF becomes one image per page; an image file is used as-is. */
export async function documentToImages(file: File): Promise<Blob[]> {
  return isPdf(file) ? pdfToImages(file) : [file];
}

/* -------------------------------------------------------------------------- */
/* Engine pool                                                                 */
/* -------------------------------------------------------------------------- */

/** How many engines to run at once: more on a strong device, one on a weak phone. */
function poolSize(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const memory = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 4;
  const byMemory = memory >= 4 ? 4 : memory >= 2 ? 2 : 1;
  return Math.max(1, Math.min(byMemory, Math.floor(cores / 2)));
}

interface Slot {
  worker: Promise<Worker>;
  /** Jobs run one after another on an engine. */
  chain: Promise<unknown>;
  pending: number;
  onFraction?: (f: number) => void;
}

const pool: Slot[] = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Free the engines (~100 MB each) after this much idle time. */
const IDLE_MS = 4 * 60 * 1000;

const OCR_BASE = `${import.meta.env.BASE_URL}ocr`.replace(/\/{2,}/g, '/');
const SELF_HOSTED = {
  workerPath: `${OCR_BASE}/worker.min.js`,
  corePath: `${OCR_BASE}/core`,
  langPath: OCR_BASE,
};

function createSlot(): Slot {
  const slot: Slot = { chain: Promise.resolve(), pending: 0 } as Slot;
  slot.worker = (async () => {
    const { createWorker } = await import('tesseract.js');
    const logger = (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') slot.onFraction?.(m.progress);
    };
    try {
      // Our own copies (see public/ocr/README.md): faster, work offline once cached, and do
      // not depend on a third-party host being reachable at scan time.
      return await createWorker('eng', 1, { logger, ...SELF_HOSTED });
    } catch {
      // If our copy cannot be loaded for any reason, fall back to the public CDN defaults.
      return createWorker('eng', 1, { logger });
    }
  })();
  slot.worker.catch(() => dropSlot(slot));
  pool.push(slot);
  return slot;
}

function dropSlot(slot: Slot) {
  const i = pool.indexOf(slot);
  if (i >= 0) pool.splice(i, 1);
  slot.worker.then((w) => w.terminate()).catch(() => undefined);
}

function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    for (const slot of [...pool]) if (slot.pending === 0) dropSlot(slot);
  }, IDLE_MS);
}

/** Start the engines now (call when a scan dialog opens) so the first scan is not slowed by start-up. */
export function warmUp(): void {
  while (pool.length < poolSize()) createSlot();
  armIdleTimer();
}

/** Run a job on the least busy engine; creates engines up to the pool size on demand. */
function runJob<T>(job: (worker: Worker, slot: Slot) => Promise<T>): Promise<T> {
  if (pool.length < poolSize()) createSlot();
  const slot = pool.reduce((best, s) => (s.pending < best.pending ? s : best));
  slot.pending += 1;
  armIdleTimer();
  const run = slot.chain.then(async () => {
    const worker = await slot.worker;
    return job(worker, slot);
  });
  slot.chain = run
    .catch(() => undefined)
    .finally(() => {
      slot.pending -= 1;
    });
  return run;
}

/* -------------------------------------------------------------------------- */
/* Recognition                                                                 */
/* -------------------------------------------------------------------------- */

export interface OcrWord {
  text: string;
  /** 0..100 */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPass {
  /** Tesseract page-segmentation mode, e.g. '4' (columns) or '11' (sparse text). */
  psm: string;
  text: string;
  confidence: number;
  words: OcrWord[];
}

interface RawWord { text: string; confidence: number; bbox: OcrWord['bbox'] }

/**
 * OCR every image with each segmentation mode. Different modes recover different lines
 * on card layouts, so callers parse all passes and merge. Jobs spread over the pool, so
 * modes and pages are read in parallel. `rotate` detects sideways phone photos; skip it
 * for pages rendered from a PDF, which are already upright (it costs time on every read).
 * Returns passes[imageIndex][modeIndex].
 */
export async function recognizeImages(
  images: Blob[],
  modes: string[],
  onProgress?: (p: ScanProgress) => void,
  opts: { rotate?: boolean } = {},
): Promise<OcrPass[][]> {
  const rotate = opts.rotate ?? true;
  const total = images.length * modes.length;
  let done = 0;
  const live = new Map<number, number>();
  const report = (status: string) => {
    let partial = 0;
    live.forEach((f) => (partial += f));
    onProgress?.({ status, progress: Math.min(0.99, (done + partial) / total) });
  };

  report('preparing');
  const results: OcrPass[][] = images.map(() => []);
  await Promise.all(
    images.flatMap((image, imageIndex) =>
      modes.map(async (psm, modeIndex) => {
        const jobId = imageIndex * modes.length + modeIndex;
        const source = await preprocess(image);
        const pass = await runJob(async (worker, slot) => {
          slot.onFraction = (f) => {
            live.set(jobId, f);
            report('reading');
          };
          await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: '' });
          const { data } = await worker.recognize(source, rotate ? { rotateAuto: true } : {});
          slot.onFraction = undefined;
          const words = ((data as unknown as { words?: RawWord[] }).words ?? [])
            .filter((w) => w.text.trim())
            .map((w) => ({ text: w.text, confidence: w.confidence, bbox: { ...w.bbox } }));
          return { psm, text: data.text, confidence: data.confidence, words } as OcrPass;
        });
        live.delete(jobId);
        done += 1;
        report('reading');
        results[imageIndex]![modeIndex] = pass;
      }),
    ),
  );
  return results;
}

/**
 * Read a small cropped region (a digit in a circle, a single value) with its own
 * parameters. Runs on the same pool, so there is no extra engine start-up.
 */
export function ocrCrop(blob: Blob, psm: string, whitelist = ''): Promise<string> {
  return runJob(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: whitelist });
    return (await worker.recognize(blob)).data.text;
  });
}
