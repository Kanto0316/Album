const APP_CONFIG = {
  siteInactivity: {
    thresholdDays: 30,
  },
  // URL publique du service Render, sans chemin `/v1/ocr/articles`.
  // Une valeur injectée dans `window.OCR_API_URL` avant le chargement de l'app
  // permet de configurer chaque environnement sans modifier le code applicatif.
  OCR_API_URL: String(globalThis.OCR_API_URL || 'https://back-end-serveur-1.onrender.com')
    .trim()
    .replace(/\/+$/, ''),
};

const OCR_API_URL = APP_CONFIG.OCR_API_URL;

export { APP_CONFIG, OCR_API_URL };
