// Firebase config of the TEST environment (test.azcarpool.nl). Shipped instead of ../../firebase-config.js by
// `npm run build:deploy:test`. Same rules as the live file: these values are public (they identify the project,
// the Firestore rules protect the data), so this file may stay in the repo.
//
// FILL IN: Firebase console -> the TEST project (not "az-carpool") -> gear icon -> Project settings -> Your apps -> web app -> firebaseConfig.
// The build refuses to run while a value still says VUL-IN, and refuses the live project "az-carpool".

export const firebaseConfig = {
  apiKey: "VUL-IN",
  authDomain: "VUL-IN",
  projectId: "VUL-IN",
  storageBucket: "VUL-IN",
  messagingSenderId: "VUL-IN",
  appId: "VUL-IN",
};

// Same Google Calendar key as live: add https://test.azcarpool.nl/* to its allowed referrers in Google Cloud console.
export const googleCalendarApiKey = "AIzaSyBxLbG-osWKvzzmPS_njfHvtFjxS-i5urg";
