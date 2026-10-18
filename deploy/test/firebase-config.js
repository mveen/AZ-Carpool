// Firebase config of the TEST environment (test.azcarpool.nl). Shipped instead of ../../firebase-config.js by
// `npm run build:deploy:test`. Same rules as the live file: these values are public (they identify the project,
// the Firestore rules protect the data), so this file may stay in the repo.
//
// Source: Firebase console -> project az-carpool-test -> Project settings -> Your apps.
// The build refuses a config that is not filled in, and refuses the live project "az-carpool".

export const firebaseConfig = {
  apiKey: "AIzaSyA8NyilYBF9sad6xYL5fGuf-4oQEcVpMCk",
  authDomain: "az-carpool-test.firebaseapp.com",
  projectId: "az-carpool-test",
  storageBucket: "az-carpool-test.firebasestorage.app",
  messagingSenderId: "305510801557",
  appId: "1:305510801557:web:1b65070db0e1008c7c3b9c",
};

// Same Google Calendar key as live: add https://test.azcarpool.nl/* to its allowed referrers in Google Cloud console.
export const googleCalendarApiKey = "AIzaSyBxLbG-osWKvzzmPS_njfHvtFjxS-i5urg";
