(function () {
  const TOAST_VISIBLE_CLASS = "toast--visible";
  const DEFAULT_TOAST_DURATION = 3000;
  const DEFAULT_SNACKBAR_DURATION = 5000;
  const GLOBAL_LOADER_ID = "globalPageLoader";
  const GLOBAL_LOADER_HIDDEN_CLASS = "global-loader-overlay--hidden";
  let hideTimerId = null;
  let globalLoader = null;
  let hasWindowLoaded = document.readyState === "complete";
  let isAppReady = false;

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

    const spinner = document.createElement("div");
    spinner.className = "global-loader-spinner";
    spinner.setAttribute("aria-hidden", "true");
    overlay.appendChild(spinner);

    document.body.appendChild(overlay);
    globalLoader = overlay;
    return globalLoader;
  }

  function showGlobalLoader() {
    ensureGlobalLoader().classList.remove(GLOBAL_LOADER_HIDDEN_CLASS);
  }

  function hideGlobalLoader() {
    ensureGlobalLoader().classList.add(GLOBAL_LOADER_HIDDEN_CLASS);
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
    showGlobalLoader();
    window.requestAnimationFrame(() => {
      window.location.href = url;
    });
  }

  ensureGlobalLoader();
  showGlobalLoader();

  window.addEventListener("beforeunload", showGlobalLoader);
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
