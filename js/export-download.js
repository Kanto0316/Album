const ANDROID_DOWNLOAD_RESULT_EVENT = 'android-download-result';
const BASE64_CHUNK_SIZE = 0x8000;

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new TypeError('Le contenu à télécharger doit être un tableau d’octets.');
}

export function bytesToBase64(value, encodeBase64 = window.btoa.bind(window)) {
  const bytes = asBytes(value);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return encodeBase64(chunks.join(''));
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function downloadExportFile({
  fileName,
  mimeType,
  bytes,
  onAndroidResult = () => {},
  targetWindow = window,
  targetDocument = document,
}) {
  const fileBytes = asBytes(bytes);
  const saveFile = targetWindow.AndroidDownloads?.saveFile;

  if (typeof saveFile === 'function') {
    const requestId = createRequestId();
    const handleResult = (event) => {
      const detail = event?.detail;
      if (!detail || detail.requestId !== requestId) {
        return;
      }
      if (!['started', 'saved', 'error'].includes(detail.status)) {
        return;
      }
      onAndroidResult(detail);
      if (detail.status === 'saved' || detail.status === 'error') {
        targetWindow.removeEventListener(ANDROID_DOWNLOAD_RESULT_EVENT, handleResult);
      }
    };

    // Install first: the native implementation is allowed to answer synchronously.
    targetWindow.addEventListener(ANDROID_DOWNLOAD_RESULT_EVENT, handleResult);
    try {
      saveFile.call(
        targetWindow.AndroidDownloads,
        fileName,
        mimeType,
        bytesToBase64(fileBytes, targetWindow.btoa.bind(targetWindow)),
        requestId,
      );
    } catch (error) {
      targetWindow.removeEventListener(ANDROID_DOWNLOAD_RESULT_EVENT, handleResult);
      onAndroidResult({
        requestId,
        status: 'error',
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { mode: 'android', requestId };
  }

  const blob = new Blob([fileBytes], { type: mimeType });
  const link = targetDocument.createElement('a');
  link.href = targetWindow.URL.createObjectURL(blob);
  link.download = fileName;
  targetDocument.body.appendChild(link);
  link.click();
  targetDocument.body.removeChild(link);
  targetWindow.setTimeout(() => targetWindow.URL.revokeObjectURL(link.href), 0);
  return { mode: 'browser' };
}

export function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}
