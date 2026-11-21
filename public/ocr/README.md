Self-hosted OCR assets (loaded by src/utils/ocrEngine.ts so scanning does not depend on a third-party CDN):

- worker.min.js            tesseract.js 5.1.1 worker (from node_modules/tesseract.js/dist)
- core/*.wasm.js           tesseract-core 5.1.1 LSTM builds, SIMD and non-SIMD (from node_modules/tesseract.js-core)
- eng.traineddata.gz       English model 4.0.0_best_int (Apache-2.0, @tesseract.js-data/eng), gzipped.
                           The smaller tessdata_fast model was tried and rejected: it misread engine
                           number, power, seating and owner serial on a real RC.

If tesseract.js is upgraded, copy the matching worker/core files again.
