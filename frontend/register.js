(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("register-form");
    var tabSignup = document.getElementById("tab-signup");
    var tabLogin = document.getElementById("tab-login");
    var authTitle = document.getElementById("auth-title");
    var authSubtitle = document.getElementById("auth-subtitle");
    var nameGroup = document.getElementById("name-group");
    var nameInput = document.getElementById("name-input");
    var phoneInput = document.getElementById("phone-input");
    var otpInput = document.getElementById("otp-input");
    var otpGroup = document.getElementById("otp-group");
    var privacyConsent = document.getElementById("privacy-consent");
    var registerButton = document.getElementById("register-btn");
    var buttonLabel = document.getElementById("register-btn-label");
    var authSwitchText = document.getElementById("auth-switch-text");
    var authSwitchBtn = document.getElementById("auth-switch-btn");
    var messageBox = document.getElementById("register-message");

    if (!form || !phoneInput || !registerButton || !messageBox) return;

    var mode = "signup";
    var confirmationResult = null;
    var step = "phone";

    function setMode(newMode) {
      mode = newMode === "login" ? "login" : "signup";
      TransitPulseUI.clearMessage(messageBox);

      if (step === "otp") {
        step = "phone";
        if (otpGroup) otpGroup.classList.add("is-hidden");
        phoneInput.disabled = false;
        if (nameInput) nameInput.disabled = false;
        if (otpInput) otpInput.value = "";
      }

      if (mode === "signup") {
        document.title = "TransitPulse — Sign Up";
        if (tabSignup) {
          tabSignup.classList.add("is-active");
          tabSignup.setAttribute("aria-selected", "true");
        }
        if (tabLogin) {
          tabLogin.classList.remove("is-active");
          tabLogin.setAttribute("aria-selected", "false");
        }
        if (authTitle) authTitle.textContent = "Create your account";
        if (authSubtitle) authSubtitle.textContent = "Enter your name and mobile number to star frequent stops and get live ETAs.";
        if (nameGroup) nameGroup.classList.remove("is-hidden");
        if (nameInput) nameInput.required = true;
        if (privacyConsent) privacyConsent.classList.remove("is-hidden");
        if (authSwitchText) authSwitchText.textContent = "Already have an account?";
        if (authSwitchBtn) authSwitchBtn.textContent = "Log in";
        setSubmitting(false, step === "otp" ? "Verify & Create Account" : "Send OTP");
      } else {
        document.title = "TransitPulse — Log In";
        if (tabLogin) {
          tabLogin.classList.add("is-active");
          tabLogin.setAttribute("aria-selected", "true");
        }
        if (tabSignup) {
          tabSignup.classList.remove("is-active");
          tabSignup.setAttribute("aria-selected", "false");
        }
        if (authTitle) authTitle.textContent = "Welcome back";
        if (authSubtitle) authSubtitle.textContent = "Enter your mobile number to access your starred stops and profile.";
        if (nameGroup) nameGroup.classList.add("is-hidden");
        if (nameInput) nameInput.required = false;
        if (privacyConsent) privacyConsent.classList.add("is-hidden");
        if (authSwitchText) authSwitchText.textContent = "New to TransitPulse?";
        if (authSwitchBtn) authSwitchBtn.textContent = "Sign up free";
        setSubmitting(false, step === "otp" ? "Verify & Log In" : "Send OTP");
      }

      try {
        var url = new URL(window.location.href);
        url.searchParams.set("mode", mode);
        window.history.replaceState({}, "", url.toString());
      } catch (e) {}
    }

    var initialParams = new URLSearchParams(window.location.search);
    var initialMode = (initialParams.get("mode") || "").toLowerCase();
    setMode(initialMode === "login" ? "login" : "signup");

    if (tabSignup) {
      tabSignup.addEventListener("click", function () {
        if (mode !== "signup") setMode("signup");
      });
    }

    if (tabLogin) {
      tabLogin.addEventListener("click", function () {
        if (mode !== "login") setMode("login");
      });
    }

    if (authSwitchBtn) {
      authSwitchBtn.addEventListener("click", function () {
        setMode(mode === "signup" ? "login" : "signup");
      });
    }

    function ensureRecaptcha() {
      if (!window.recaptchaVerifier && window.firebase && window.firebase.auth) {
        try {
          window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
            size: "invisible"
          });
        } catch (e) {
          console.warn("Could not instantiate reCAPTCHA:", e);
        }
      }
      return window.recaptchaVerifier;
    }

    if (window.firebase && window.firebase.auth) {
      ensureRecaptcha();
    }

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

      var enteredName = nameInput ? nameInput.value.trim() : "";
      var phone = phoneInput.value.trim();

      if (step === "phone") {
        if (mode === "signup" && !enteredName) {
          TransitPulseUI.showMessage(messageBox, "Please enter your name.", "error");
          if (nameInput) nameInput.focus();
          return;
        }

        if (!/^[6-9]\d{9}$/.test(phone)) {
          TransitPulseUI.showMessage(messageBox, "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.", "error");
          phoneInput.focus();
          return;
        }

        var lastSent = Number(sessionStorage.getItem("tp_otp_cooldown_at") || 0);
        var nowMs = Date.now();
        if (nowMs - lastSent < 60000) {
          var waitSec = Math.ceil((60000 - (nowMs - lastSent)) / 1000);
          TransitPulseUI.showMessage(messageBox, "Please wait " + waitSec + "s before requesting another OTP.", "warning");
          return;
        }

        if (!window.firebase || !window.firebase.auth) {
          TransitPulseUI.showMessage(messageBox, "Network connection is slow. Waiting for authentication service...", "warning");
          setSubmitting(true, "Connecting...");
          var waited = 0;
          var waitInterval = setInterval(async function () {
            waited += 500;
            if (window.firebase && window.firebase.auth) {
              clearInterval(waitInterval);
              ensureRecaptcha();
              setSubmitting(false, "Send OTP");
              form.dispatchEvent(new Event("submit"));
            } else if (waited >= 8000) {
              clearInterval(waitInterval);
              setSubmitting(false, "Send OTP");
              TransitPulseUI.showMessage(messageBox, "Slow network detected. Please check your connection and tap Send OTP again.", "error");
            }
          }, 500);
          return;
        }

        var verifier = ensureRecaptcha();
        if (!verifier) {
          TransitPulseUI.showMessage(messageBox, "Authentication security check could not load. Please reload the page.", "error");
          return;
        }

        setSubmitting(true, "Sending OTP...");

        try {
          var fullPhoneNumber = "+91" + phone;
          confirmationResult = await firebase.auth().signInWithPhoneNumber(
            fullPhoneNumber,
            verifier
          );

          sessionStorage.setItem("tp_otp_cooldown_at", String(Date.now()));
          step = "otp";
          if (otpGroup) otpGroup.classList.remove("is-hidden");
          phoneInput.disabled = true;
          if (nameInput) nameInput.disabled = true;
          setSubmitting(false, mode === "signup" ? "Verify & Create Account" : "Verify & Log In");
          TransitPulseUI.showMessage(messageBox, "OTP sent to +91 " + phone + ". Enter it below.", "success");
          if (otpInput) otpInput.focus();
        } catch (error) {
          console.error("Firebase sendOtp error:", error);
          if (window.recaptchaVerifier && window.recaptchaVerifier.clear) {
            try { window.recaptchaVerifier.clear(); } catch (e) {}
            window.recaptchaVerifier = null;
          }
          TransitPulseUI.showMessage(messageBox, error.message || "Failed to send OTP.", "error");
          setSubmitting(false, "Send OTP");
        }
        return;
      }

      if (step === "otp") {
        var otp = otpInput ? otpInput.value.trim() : "";
        if (!/^\d{6}$/.test(otp)) {
          TransitPulseUI.showMessage(messageBox, "Please enter the 6-digit OTP.", "error");
          if (otpInput) otpInput.focus();
          return;
        }

        setSubmitting(true, "Verifying OTP...");

        try {
          var userCredential = await confirmationResult.confirm(otp);
          var regPayload = (mode === "signup" && enteredName) ? { name: enteredName } : {};
          var response = await TransitPulseAPI.register(regPayload);

          if (!response || response.user_id === undefined) {
            throw new Error("Registration succeeded with Firebase, but server failed to link profile.");
          }

          var savedName = (response.user && response.user.name) || (mode === "signup" ? enteredName : "") || "Commuter";
          TransitPulseStorage.saveUser(response.user_id, savedName);
          TransitPulseUI.showMessage(
            messageBox,
            mode === "signup" ? "Account created! Opening your routes..." : "Welcome back! Opening your routes...",
            "success"
          );

          var urlParams = new URLSearchParams(window.location.search);
          var returnUrl = urlParams.get("return");
          var targetUrl = (returnUrl && !returnUrl.includes("://")) ? returnUrl : "routes.html";
          window.setTimeout(function () {
            window.location.href = targetUrl;
          }, 600);
        } catch (error) {
          console.error("Verification error:", error);
          TransitPulseUI.showMessage(messageBox, error.message || "Invalid OTP code. Please try again.", "error");
          setSubmitting(false, mode === "signup" ? "Verify & Create Account" : "Verify & Log In");
        }
      }
    });

    function setSubmitting(isSubmitting, labelText) {
      registerButton.disabled = isSubmitting;
      registerButton.classList.toggle("is-busy", isSubmitting);
      var label = buttonLabel || registerButton.querySelector(".button-label");
      if (label && labelText) label.textContent = labelText;
    }
  });
})();