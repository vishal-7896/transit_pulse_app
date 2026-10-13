// firebase-config.js
var firebaseConfig = {
  apiKey: "AIzaSyCAEzMhX7pUJS9UNx0UAqLFQD5wkkErY1E",
  authDomain: "transit-pulse-d1a56.firebaseapp.com",
  projectId: "transit-pulse-d1a56",
  storageBucket: "transit-pulse-d1a56.firebasestorage.app",
  messagingSenderId: "726033434183",
  appId: "1:726033434183:web:d433031a53d43e73cd5362",
  measurementId: "G-7BK9JHM083"
};

// Initialize Firebase
if (window.firebase && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}