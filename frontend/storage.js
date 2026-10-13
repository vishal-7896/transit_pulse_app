(function () {
  "use strict";

  var USER_ID_KEY = "user_id";
  var USER_NAME_KEY = "user_name";

  window.TransitPulseStorage = {
    saveUser: function (userId, userName) {
      if (userId === undefined || userId === null || String(userId).trim() === "") {
        throw new Error("A valid user_id is required.");
      }

      window.localStorage.setItem(USER_ID_KEY, String(userId));

      if (userName && String(userName).trim() !== "") {
        window.localStorage.setItem(USER_NAME_KEY, String(userName).trim());
      } else {
        window.localStorage.removeItem(USER_NAME_KEY);
      }
    },

    getUserId: function () {
      return window.localStorage.getItem(USER_ID_KEY);
    },

    getUserName: function () {
      return window.localStorage.getItem(USER_NAME_KEY);
    },

    clearUser: function () {
      window.localStorage.removeItem(USER_ID_KEY);
      window.localStorage.removeItem(USER_NAME_KEY);
    },

    hasUser: function () {
      var userId = window.localStorage.getItem(USER_ID_KEY);
      return Boolean(userId && String(userId).trim() !== "");
    }
  };
})();
