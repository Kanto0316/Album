const OCR_ARTICLES_PATH = '/v1/ocr/articles';

export const ARTICLE_EXTRACTION_FIELDS = Object.freeze({
  active: Object.freeze(['code', 'designation']),
  planned: Object.freeze(['quantity', 'unit', 'status']),
});

function normalizeArticle(article) {
  return {
    code: String(article?.code || '').trim(),
    designation: String(article?.designation || article?.description || '').trim(),
  };
}

function readArticles(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : payload?.articles || payload?.data?.articles || payload?.result?.articles;
  if (!Array.isArray(candidates)) return [];
  return candidates.map(normalizeArticle).filter(({ code, designation }) => code && designation);
}

function makeOcrError(response, payload) {
  const backendMessage = String(payload?.message || payload?.error || '').trim();
  const messagesByStatus = {
    401: 'Session expirée. Reconnectez-vous pour utiliser l’OCR.',
    403: 'Utilisateur non autorisé à utiliser l’OCR.',
    413: 'Image trop volumineuse. Sélectionnez une image plus petite.',
    415: 'Format d’image non supporté. Utilisez une image JPG, PNG ou WEBP.',
    422: 'Image inexploitable. Essayez une image plus nette.',
    429: 'Trop de requêtes OCR. Patientez quelques instants puis réessayez.',
  };
  if (messagesByStatus[response.status]) return new Error(messagesByStatus[response.status]);
  if (response.status >= 500) {
    return new Error('Serveur OCR indisponible. Réessayez plus tard.');
  }
  return new Error(backendMessage || 'OCR indisponible. Impossible d’analyser cette image.');
}

/** Envoie une image au backend OCR. Cette fonction ne réalise aucun stockage. */
export async function recognizeArticles(image, options = {}) {
  const apiUrl = String(options.apiUrl || '').trim().replace(/\/+$/, '');
  const token = String(options.token || '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const FormDataImpl = options.FormDataImpl || globalThis.FormData;

  if (!image) throw new Error('Image invalide. Sélectionnez une image JPG, PNG ou WEBP.');
  if (!apiUrl) throw new Error('OCR indisponible : OCR_API_URL n’est pas configurée.');
  if (!token) throw new Error('Utilisateur non autorisé à utiliser l’OCR.');
  if (typeof fetchImpl !== 'function' || typeof FormDataImpl !== 'function') {
    throw new Error('OCR indisponible sur cet appareil.');
  }

  const formData = new FormDataImpl();
  formData.append('image', image);

  let response;
  try {
    response = await fetchImpl(`${apiUrl}${OCR_ARTICLES_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  } catch (_error) {
    throw new Error(
      'Serveur OCR inaccessible. Vérifiez votre connexion. Si le navigateur bloque la requête CORS, '
      + `le backend Render doit autoriser l’origine ${globalThis.location?.origin || 'https://kanto0316.github.io'}.`,
    );
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (_error) {
    // La gestion par statut ci-dessous fournit un message stable même si Render
    // renvoie une page d'erreur non JSON.
  }
  if (!response.ok) throw makeOcrError(response, payload);

  return { articles: readArticles(payload) };
}

export const OcrService = Object.freeze({ recognizeArticles });
