/**
 * Shared in-browser OCR plumbing (tesseract.js). Documents are read on the
 * device and never sent to an OCR service. PDFs are rendered page by page with
 * pdf.js first, because tesseract only reads images.
 *
 * Both heavy libraries are imported on demand so they stay out of the main bundle.
 */

export interface ScanProgress {
  status: string;
  /** 0..1 */
  progress: number;
}

export const isPdf = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Grayscale + contrast stretch, upscaled so small card text is legible. */
export async function preprocess(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const targetLong = 2200;
  const scale = Math.min(2, Math.max(1, targetLong / Math.max(bitmap.width, bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
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

export interface OcrPass {
  /** Tesseract page-segmentation mode, e.g. '4' (columns) or '11' (sparse text). */
  psm: string;
  text: string;
  confidence: number;
}

/**
 * OCR every image with each segmentation mode. Different modes recover
 * different lines on card layouts, so callers parse all passes and merge.
 */
export async function recognizeImages(
  images: Blob[],
  modes: string[],
  onProgress?: (p: ScanProgress) => void,
): Promise<OcrPass[][]> {
  const { createWorker } = await import('tesseract.js');
  const total = images.length * modes.length;
  let done = 0;
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.({ status: `Reading page`, progress: (done + m.progress) / total });
      } else {
        onProgress?.({ status: m.status, progress: done / total });
      }
    },
  });
  try {
    const results: OcrPass[][] = [];
    for (const image of images) {
      const prepared = await preprocess(image);
      const passes: OcrPass[] = [];
      for (const psm of modes) {
        await worker.setParameters({ tessedit_pageseg_mode: psm as never });
        const { data } = await worker.recognize(prepared, { rotateAuto: true });
        passes.push({ psm, text: data.text, confidence: data.confidence });
        done += 1;
      }
      results.push(passes);
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
