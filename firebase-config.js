
// Firebase project config for AZ Carpool.
// Firebase console → gear icon → Project settings → scroll to "Your apps" →
// the </> (web) icon → copy the firebaseConfig object's values in below.
//
// These values are NOT secret — Google's own docs say so (they identify your
// project, they don't authenticate access; that's what your Firestore rules
// do). GitHub's secret-scanning bot can't tell the difference and flags this
// file anyway — that alert is a well-known false positive you can dismiss.
//
// This file lives separately from index.html on purpose: once you fill it in
// here, you never need to touch it again — future app updates only ever
// replace index.html, and this file is left alone.

export const firebaseConfig = {
  apiKey: "AIzaSyD06qcffnbm2VFl-3JYEf16BrkTGsqQr70",
  authDomain: "az-carpool.firebaseapp.com",
  projectId: "az-carpool",
  storageBucket: "az-carpool.firebasestorage.app",
  messagingSenderId: "366961042772",
  appId: "1:366961042772:web:7bcbf144fa4316146814c1",
  measurementId: "G-B1VT4T621M"
};

// Google Calendar API key, used to fetch the AZ match schedules (Mijn week + Afwijking's
// weekend carpool section). Google Cloud console → APIs & Services → Credentials → Create
// credentials → API key. Then: Enable the "Google Calendar API" for that project, and — for
// security — restrict this key's "Application restrictions" to HTTP referrers matching your
// own site (e.g. https://mveen.github.io/*), same idea as the Firebase key restriction.
// This key is NOT secret either (same reasoning as firebaseConfig above) — it only grants
// read access to whichever calendars are public, nothing account-wide.
export const googleCalendarApiKey = "AIzaSyBxLbG-osWKvzzmPS_njfHvtFjxS-i5urg";

// OpenRouteService API key (free), used to calculate the projected car distance of away matches.
// openrouteservice.org -> sign up -> Dashboard -> Request a token (type "Standard"). The free tier
// (about 2000 route requests a day) is plenty for max. 20 users: each match is calculated once and stored.
// Like the keys above this key is not secret in the sense of account access, but do not share it elsewhere.
// Leave the placeholder as it is to switch the distance feature off.
export const openRouteServiceApiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImRhOTFmODY3Y2I3ODQ1MjNiMjg5MDU3NTBiZTExOTMzIiwiaCI6Im11cm11cjY0In0=";
