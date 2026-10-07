(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("register-form");
    var nameInput = document.getElementById("name-input");
    var phoneInput = document.getElementById("phone-input");
    var registerButton = document.getElementById("register-btn");
    var messageBox = document.getElementById("register-message");

    if (!form || !phoneInput || !registerButton || !messageBox) return;

    phoneInput.addEventListener("input", function () {
      phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      TransitPulseUI.clearMessage(messageBox);

      var name = nameInput.value.trim();
      var phone = phoneInput.value.trim();

      if (!/^\d{10}$/.test(phone)) {
        TransitPulseUI.showMessage(messageBox, "Phone number must contain exactly 10 digits.", "error");
        phoneInput.focus();
        return;
      }

      setSubmitting(true);

      try {
        var response = await TransitPulseAPI.register({
          name: name,
          phone: phone
        });

        if (!response || response.user_id === undefined || response.user_id === null) {
          throw new Error("Registration succeeded without a user ID.");
        }

        TransitPulseStorage.saveUser(response.user_id, name || "Anonymous");
        TransitPulseUI.showMessage(messageBox, "You're registered. Opening your routes...", "success");

        window.setTimeout(function () {
          window.location.href = "routes.html";
        }, 500);
      } catch (error) {
        console.error("Register error:", error);
        TransitPulseUI.showMessage(messageBox, getRegistrationError(error), "error");
        setSubmitting(false);
      }
    });

    function setSubmitting(isSubmitting) {
      registerButton.disabled = isSubmitting;
      registerButton.classList.toggle("is-busy", isSubmitting);
      var label = registerButton.querySelector(".button-label");
      if (label) label.textContent = isSubmitting ? "Creating profile..." : "Continue";
    }

    function getRegistrationError(error) {
      if (error && error.isNetworkError) {
        return "Could not reach the TransitPulse server. Make sure Flask is running.";
      }
      if (error && error.message) return error.message;
      return "Registration could not be completed. Please try again.";
    }
  });
})();
