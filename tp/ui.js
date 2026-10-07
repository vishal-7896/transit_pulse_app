(function () {
  "use strict";

  window.TransitPulseUI = {
    showMessage: function (element, message, type) {
      if (!element) return;
      var messageType = type || "info";
      element.textContent = message || "";
      element.className = "message-box message-" + messageType;
      element.setAttribute("role", type === "error" ? "alert" : "status");
      element.setAttribute("aria-live", "polite");
    },

    clearMessage: function (element) {
      if (!element) return;
      element.textContent = "";
      element.className = "message-box is-hidden";
    },

    showElement: function (element) {
      if (!element) return;
      element.classList.remove("is-hidden");
    },

    hideElement: function (element) {
      if (!element) return;
      element.classList.add("is-hidden");
    },

    setLoading: function (element, isLoading) {
      if (!element) return;
      element.classList.toggle("is-loading", Boolean(isLoading));
      element.setAttribute("aria-busy", String(Boolean(isLoading)));
    },

    setButtonDisabled: function (button, isDisabled) {
      if (!button) return;
      button.disabled = Boolean(isDisabled);
    }
  };
})();
