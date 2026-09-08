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

function readErrorCode(payload) {
  return String(payload?.code || payload?.errorCode || payload?.error?.code || payload?.error || '')
    .trim()
    .toUpperCase();
}

function makeOcrError(response, payload) {
  const backendMessage = String(payload?.message || payload?.error || '').trim();
  const code = readErrorCode(payload);
  if (response.status === 401 && code === 'TOKEN_EXPIRED') {
    return Object.assign(new Error('Le jeton Firebase a expiré.'), { code, status: response.status });
  }
  if (response.status === 401) {
    return Object.assign(
      new Error('Votre session n’est plus valide. Reconnectez-vous.'),
      { code: code || 'TOKEN_INVALID', status: response.status },
    );
  }
  const messagesByStatus = {
    403: 'Vous n’êtes pas autorisé à utiliser l’OCR.',
    413: 'Image trop volumineuse. Sélectionnez une image plus petite.',
    415: 'Format d’image non supporté. Utilisez une image JPG, PNG ou WEBP.',
    422: 'Image inexploitable. Essayez une image plus nette.',
    429: 'Trop de requêtes OCR. Patientez quelques instants puis réessayez.',
  };
  if (messagesByStatus[response.status]) {
    return Object.assign(new Error(messagesByStatus[response.status]), { code, status: response.status });
  }
  if (response.status === 500 || response.status === 503) {
    return Object.assign(
      new Error('Le service OCR est temporairement indisponible.'),
      { code, status: response.status },
    );
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

/**
 * Récupère un ID token Firebase juste avant l'envoi et ne force son
 * renouvellement qu'après un TOKEN_EXPIRED. Le second appel est l'unique retry.
 */
export async function recognizeArticlesWithAuth(image, options = {}) {
  const { user } = options;
  if (!user?.uid || typeof user.getIdToken !== 'function') {
    throw new Error('Votre session n’est plus valide. Reconnectez-vous.');
  }

  const requestOptions = { ...options };
  delete requestOptions.user;

  const token = await user.getIdToken();
  try {
    return await recognizeArticles(image, { ...requestOptions, token });
  } catch (error) {
    if (error?.status !== 401 || error?.code !== 'TOKEN_EXPIRED') throw error;
    const freshToken = await user.getIdToken(true);
    return recognizeArticles(image, { ...requestOptions, token: freshToken });
  }
}

export const OcrService = Object.freeze({ recognizeArticles, recognizeArticlesWithAuth });
