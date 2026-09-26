
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
