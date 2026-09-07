const DEFAULT_ALLOWED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_ALLOWED_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp']);
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export function validateImageFile(file, options = {}) {
  const allowedTypes = options.allowedTypes || DEFAULT_ALLOWED_TYPES;
  const maxSizeBytes = options.maxSizeBytes || DEFAULT_MAX_SIZE_BYTES;

  if (!file) {
    throw new Error('Aucune image sélectionnée.');
  }
  const normalizedType = String(file.type || '').toLowerCase();
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  const hasAllowedType = !normalizedType || allowedTypes.includes(normalizedType);
  if (!hasAllowedType || !DEFAULT_ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error('Format non pris en charge. Utilisez une image JPG, JPEG, PNG ou WEBP.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('L’image sélectionnée est vide ou illisible.');
  }
  if (file.size > maxSizeBytes) {
    throw new Error('L’image dépasse la taille maximale autorisée de 10 Mo.');
  }
  return file;
}

export function prepareImage(file, options = {}) {
  const validatedFile = validateImageFile(file, options);
  return {
    file: validatedFile,
    name: validatedFile.name || 'image-importée',
    type: validatedFile.type,
    size: validatedFile.size,
    previewUrl: URL.createObjectURL(validatedFile),
  };
}

export function selectImage(options = {}) {
  const documentRef = options.documentRef || document;
  return new Promise((resolve, reject) => {
    const input = documentRef.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.hidden = true;

    const cleanup = () => input.remove();
    input.addEventListener('cancel', () => {
      cleanup();
      reject(new Error('Sélection d’image annulée.'));
    }, { once: true });
    input.addEventListener('change', () => {
      try {
        const file = input.files?.[0];
        cleanup();
        resolve(prepareImage(file, options));
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, { once: true });

    documentRef.body.append(input);
    input.click();
  });
}

export const ImageImportService = Object.freeze({
  prepareImage,
  selectImage,
  validateImageFile,
});
