(function () {
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

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) {
      return;
    }
    toast.innerHTML = "";
    toast.textContent = message;
    toast.classList.add("toast--visible");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
      toast.classList.remove("toast--visible");
    }, 2200);
  }

  function showUndoSnackbar(message, onUndo, actionLabel = "Annuler") {
    const toast = document.getElementById("toast");
    if (!toast) {
      return;
    }

    toast.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "toast__action";
    actionButton.textContent = actionLabel;
    actionButton.addEventListener("click", async () => {
      toast.classList.remove("toast--visible");
      window.clearTimeout(showToast.timeoutId);
      if (typeof onUndo === "function") {
        await onUndo();
      }
    });

    toast.append(text, actionButton);
    toast.classList.add("toast--visible");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
      toast.classList.remove("toast--visible");
    }, 5000);
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
