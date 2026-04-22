(function () {
  const TOAST_VISIBLE_CLASS = "toast--visible";
  const DEFAULT_TOAST_DURATION = 3000;
  const DEFAULT_SNACKBAR_DURATION = 5000;
  const GLOBAL_LOADER_ID = "globalPageLoader";
  const GLOBAL_LOADER_HIDDEN_CLASS = "global-loader-overlay--hidden";
  const APP_LOADED_STORAGE_KEY = "albumAppHasLoadedOnce";
  const CONTENT_PENDING_CLASS = "app-content-pending";
  const CONTENT_LOADING_CLASS = "app-content-loading";
  const CONTENT_READY_CLASS = "app-content-ready";
  const INLINE_LOADER_ID = "pageInlineLoader";
  const CONTENT_LOADING_DELAY_MS = 120;
  let hideTimerId = null;
  let globalLoader = null;
  let hasWindowLoaded = document.readyState === "complete";
  let isAppReady = false;
  let shouldUseGlobalLoader = false;
  let inlineLoaderTimerId = null;

  function ensureGlobalLoader() {
    if (globalLoader) {
      return globalLoader;
    }

    globalLoader = document.getElementById(GLOBAL_LOADER_ID);
    if (globalLoader) {
      return globalLoader;
    }

    const overlay = document.createElement("div");
    overlay.id = GLOBAL_LOADER_ID;
    overlay.className = "global-loader-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-label", "Chargement en cours");

    const loaderContent = document.createElement("div");
    loaderContent.className = "global-loader-content";

    const spinner = document.createElement("div");
    spinner.className = "global-loader-spinner";
    spinner.setAttribute("aria-hidden", "true");
    loaderContent.appendChild(spinner);

    overlay.appendChild(loaderContent);

    document.body.appendChild(overlay);
    globalLoader = overlay;
    return globalLoader;
  }

  function showGlobalLoader() {
    ensureGlobalLoader().classList.remove(GLOBAL_LOADER_HIDDEN_CLASS);
  }

  function hideGlobalLoader() {
    if (!globalLoader) {
      return;
    }
    globalLoader.classList.add(GLOBAL_LOADER_HIDDEN_CLASS);
  }

  function ensureInlineLoader() {
    const pageContent = document.querySelector(".page-content");
    if (!pageContent) {
      return null;
    }

    let inlineLoader = document.getElementById(INLINE_LOADER_ID);
    if (inlineLoader) {
      return inlineLoader;
    }

    inlineLoader = document.createElement("div");
    inlineLoader.id = INLINE_LOADER_ID;
    inlineLoader.className = "page-inline-loader";
    inlineLoader.setAttribute("aria-hidden", "true");
    inlineLoader.innerHTML = `
      <div class="page-inline-loader__block page-inline-loader__block--title"></div>
      <div class="page-inline-loader__block"></div>
      <div class="page-inline-loader__block"></div>
      <div class="page-inline-loader__block page-inline-loader__block--short"></div>
    `;
    pageContent.prepend(inlineLoader);
    return inlineLoader;
  }

  function startContentLoadingState() {
    document.body.classList.add(CONTENT_PENDING_CLASS);
    document.body.classList.remove(CONTENT_LOADING_CLASS, CONTENT_READY_CLASS);

    inlineLoaderTimerId = window.setTimeout(() => {
      if (isAppReady) {
        return;
      }
      ensureInlineLoader();
      document.body.classList.add(CONTENT_LOADING_CLASS);
    }, CONTENT_LOADING_DELAY_MS);
  }

  function stopContentLoadingState() {
    if (inlineLoaderTimerId) {
      window.clearTimeout(inlineLoaderTimerId);
      inlineLoaderTimerId = null;
    }
    document.body.classList.remove(CONTENT_PENDING_CLASS, CONTENT_LOADING_CLASS);
    document.body.classList.add(CONTENT_READY_CLASS);
  }

  function waitForImagesReady() {
    const pendingImages = Array.from(document.images).filter((image) => !image.complete);
    if (pendingImages.length === 0) {
      return Promise.resolve();
    }

    return Promise.all(
      pendingImages.map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
      ),
    ).then(() => undefined);
  }

  function maybeHideGlobalLoader() {
    if (!hasWindowLoaded || !isAppReady) {
      return;
    }

    waitForImagesReady().then(hideGlobalLoader);
  }

  function markAppReady() {
    isAppReady = true;
    stopContentLoadingState();
    try {
      sessionStorage.setItem(APP_LOADED_STORAGE_KEY, "1");
    } catch (_error) {
      // Ignore storage restrictions.
    }
    maybeHideGlobalLoader();
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return "--";
    }
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(dateValue));
  }

  function getQueryParams() {
    return new URLSearchParams(window.location.search);
  }

  function getToastElement() {
    return document.getElementById("toast");
  }

  function hideToast() {
    const toast = getToastElement();
    if (!toast) {
      return;
    }
    toast.classList.remove(TOAST_VISIBLE_CLASS);
    window.setTimeout(() => {
      if (!toast.classList.contains(TOAST_VISIBLE_CLASS)) {
        toast.textContent = "";
      }
    }, 250);
  }

  function scheduleHide(delay = DEFAULT_TOAST_DURATION) {
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
    }
    hideTimerId = window.setTimeout(() => {
      hideTimerId = null;
      hideToast();
    }, delay);
  }

  function showToast(message) {
    const toast = getToastElement();
    if (!toast) {
      return;
    }
    toast.textContent = String(message ?? "");
    toast.classList.add(TOAST_VISIBLE_CLASS);
    scheduleHide(DEFAULT_TOAST_DURATION);
  }

  function showUndoSnackbar(message, onUndo, actionLabel = "Annuler") {
    const toast = getToastElement();
    if (!toast) {
      return;
    }

    toast.textContent = "";
    const messageNode = document.createElement("span");
    messageNode.textContent = String(message ?? "");
    toast.appendChild(messageNode);

    if (typeof onUndo === "function") {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "toast__action";
      actionButton.textContent = actionLabel;
      actionButton.addEventListener(
        "click",
        () => {
          onUndo();
          hideToast();
        },
        { once: true },
      );
      toast.appendChild(actionButton);
    }

    toast.classList.add(TOAST_VISIBLE_CLASS);
    scheduleHide(DEFAULT_SNACKBAR_DURATION);
  }

  function renderEmptyState(container, message) {
    container.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  function bindDialogCloser() {
    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest("dialog")?.close();
      });
    });
  }

  function navigate(url) {
    window.requestAnimationFrame(() => {
      window.location.href = url;
    });
  }

  try {
    shouldUseGlobalLoader = sessionStorage.getItem(APP_LOADED_STORAGE_KEY) !== "1";
  } catch (_error) {
    shouldUseGlobalLoader = true;
  }

  if (shouldUseGlobalLoader) {
    ensureGlobalLoader();
    showGlobalLoader();
  }
  startContentLoadingState();

  window.addEventListener("beforeunload", () => {
    if (shouldUseGlobalLoader) {
      showGlobalLoader();
    }
  });
  window.addEventListener("load", () => {
    hasWindowLoaded = true;
    maybeHideGlobalLoader();
  });

  window.UiService = {
    formatDate,
    getQueryParams,
    showToast,
    showUndoSnackbar,
    renderEmptyState,
    bindDialogCloser,
    navigate,
    showGlobalLoader,
    hideGlobalLoader,
    markAppReady,
  };
})();
