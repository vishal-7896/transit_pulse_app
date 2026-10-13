// register.js
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("register-form");
    var nameInput = document.getElementById("name-input");
    var phoneInput = document.getElementById("phone-input");
    var otpInput = document.getElementById("otp-input");
    var otpGroup = document.getElementById("otp-group");
    var registerButton = document.getElementById("register-btn");
    var messageBox = document.getElementById("register-message");

    if (!form || !phoneInput || !registerButton || !messageBox) return;

    var confirmationResult = null; // Stores Firebase OTP confirmation
    var step = "phone"; // "phone" or "otp"

    // Set up invisible reCAPTCHA
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
      size: "invisible"
    });

    phoneInput.addEventListener("input", function () {
      phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    });

    if (otpInput) {
      otpInput.addEventListener("input", function () {
        otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      TransitPulseUI.clearMessage(messageBox);

      var name = nameInput.value.trim() || "Commuter";
      var phone = phoneInput.value.trim();

      // STEP 1: SEND OTP
      if (step === "phone") {
        if (!/^\d{10}$/.test(phone)) {
          TransitPulseUI.showMessage(messageBox, "Phone number must contain exactly 10 digits.", "error");
          phoneInput.focus();
          return;
        }

        setSubmitting(true, "Sending OTP...");

        try {
          var fullPhoneNumber = "+91" + phone;
          confirmationResult = await firebase.auth().signInWithPhoneNumber(
            fullPhoneNumber,
            window.recaptchaVerifier
          );

          // Switch UI to OTP step
          step = "otp";
          otpGroup.classList.remove("is-hidden");
          phoneInput.disabled = true;
          nameInput.disabled = true;
          setSubmitting(false, "Verify & Continue");
          TransitPulseUI.showMessage(messageBox, "OTP sent to +91 " + phone + ". Enter it below.", "success");
          otpInput.focus();
        } catch (error) {
          console.error("Firebase sendOtp error:", error);
          TransitPulseUI.showMessage(messageBox, error.message || "Failed to send OTP.", "error");
          setSubmitting(false, "Send OTP");
        }
        return;
      }

      // STEP 2: VERIFY OTP & SYNC WITH FLASK
      if (step === "otp") {
        var otp = otpInput.value.trim();
        if (!/^\d{6}$/.test(otp)) {
          TransitPulseUI.showMessage(messageBox, "Please enter the 6-digit OTP.", "error");
          otpInput.focus();
          return;
        }

        setSubmitting(true, "Verifying OTP...");

        try {
          // Confirm OTP with Firebase
          var userCredential = await confirmationResult.confirm(otp);

          // Call Flask backend (api.js automatically adds Bearer token!)
          var response = await TransitPulseAPI.register({ name: name });

          if (!response || response.user_id === undefined) {
            throw new Error("Registration succeeded with Firebase, but Flask failed to link profile.");
          }

          // Save to local storage
          TransitPulseStorage.saveUser(response.user_id, name);
          TransitPulseUI.showMessage(messageBox, "Verified! Opening your routes...", "success");

          window.setTimeout(function () {
            window.location.href = "routes.html";
          }, 600);
        } catch (error) {
          console.error("Verification error:", error);
          TransitPulseUI.showMessage(messageBox, error.message || "Invalid OTP code. Please try again.", "error");
          setSubmitting(false, "Verify & Continue");
        }
      }
    });

    function setSubmitting(isSubmitting, labelText) {
      registerButton.disabled = isSubmitting;
      registerButton.classList.toggle("is-busy", isSubmitting);
      var label = registerButton.querySelector(".button-label");
      if (label && labelText) label.textContent = labelText;
    }
  });
})();