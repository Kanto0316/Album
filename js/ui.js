(function () {
  const TOAST_VISIBLE_CLASS = "toast--visible";
  const DEFAULT_TOAST_DURATION = 3000;
  const DEFAULT_SNACKBAR_DURATION = 5000;
  let hideTimerId = null;

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
    window.location.href = url;
  }

  window.UiService = {
    formatDate,
    getQueryParams,
    showToast,
    showUndoSnackbar,
    renderEmptyState,
    bindDialogCloser,
    navigate,
  };
})();
