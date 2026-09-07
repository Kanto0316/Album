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

export const ARTICLE_EXTRACTION_FIELDS = Object.freeze({
  active: Object.freeze(['code', 'designation']),
  planned: Object.freeze(['quantity', 'unit', 'status']),
});

const IGNORED_LINE_PATTERN = /^(?:bon\b|bordereau\b|livraison\b|commande\b|inventaire\b|soci[eé]t[eé]\b|chauffeur\b|client\b|adresse\b|date\b|page\b|code(?:\s+article)?\b|r[eé]f(?:[eé]rence)?\b|d[eé]signation\b|quantit[eé]\b|unit[eé]\b)/i;
const ARTICLE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._\/-]{4,}[A-Z0-9]$/i;

function cleanOcrLine(value) {
  return String(value || '')
    .replace(/[|¦]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isArticleCode(value) {
  const candidate = String(value || '').replace(/^[^A-Z0-9]+|[^A-Z0-9._\/-]+$/gi, '');
  return ARTICLE_CODE_PATTERN.test(candidate)
    && /[A-Z]/i.test(candidate)
    && /\d/.test(candidate);
}

function isUsefulDesignation(value) {
  const normalized = cleanOcrLine(value);
  return normalized.length >= 2
    && /[A-ZÀ-ÖØ-öø-ÿ]/i.test(normalized)
    && !IGNORED_LINE_PATTERN.test(normalized)
    && !isArticleCode(normalized);
}

/**
 * Extrait les articles du texte OCR sans effectuer aucun stockage.
 * Seuls code/designation sont exposés aujourd'hui; le contrat de champs ci-dessus
 * réserve quantity/unit/status pour une évolution sans modifier ce parseur public.
 */
export function extractArticles(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanOcrLine).filter(Boolean);
  const articles = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (IGNORED_LINE_PATTERN.test(line)) continue;

    const tokens = line.split(' ');
    const codeIndex = tokens.findIndex(isArticleCode);
    if (codeIndex < 0) continue;

    const code = tokens[codeIndex].replace(/^[^A-Z0-9]+|[^A-Z0-9._\/-]+$/gi, '').toUpperCase();
    let designation = cleanOcrLine(tokens.slice(codeIndex + 1).join(' '));

    if (!isUsefulDesignation(designation)) {
      const nextLine = lines[index + 1];
      if (isUsefulDesignation(nextLine)) {
        designation = nextLine;
        index += 1;
      }
    }

    if (isUsefulDesignation(designation)
      && !articles.some((article) => article.code === code && article.designation === designation)) {
      articles.push({ code, designation });
    }
  }

  return articles;
}

export const OcrService = Object.freeze({ extractArticles, recognizeImage });
