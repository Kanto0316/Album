function resolveOcrEngine(engine) {
  const resolvedEngine = engine || globalThis.Tesseract;
  if (!resolvedEngine || typeof resolvedEngine.recognize !== 'function') {
    throw new Error('Le moteur OCR est indisponible. Vérifiez la connexion puis réessayez.');
  }
  return resolvedEngine;
}

export async function recognizeImage(image, options = {}) {
  if (!image) {
    throw new Error('Aucune image à analyser.');
  }

  const engine = resolveOcrEngine(options.engine);
  const startedAt = globalThis.performance?.now?.() ?? Date.now();

  try {
    const result = await engine.recognize(image, options.languages || 'fra+eng', {
      logger: typeof options.onProgress === 'function' ? options.onProgress : undefined,
    });
    const finishedAt = globalThis.performance?.now?.() ?? Date.now();
    return {
      text: String(result?.data?.text || '').trim(),
      confidence: Number.isFinite(result?.data?.confidence) ? result.data.confidence : null,
      durationMs: Math.max(0, Math.round(finishedAt - startedAt)),
    };
  } catch (error) {
    throw new Error(`Analyse OCR impossible : ${error?.message || 'erreur inconnue'}`);
  }
}

export const OcrService = Object.freeze({ recognizeImage });
