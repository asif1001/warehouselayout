// firebase-config.js — the Firebase web config for cloud saving (sign in, save
// layouts to your account, open them on any device).
//
// This config is NOT a secret. It only identifies which Firebase project to talk
// to — it is visible in the browser on any Firebase site — and what actually
// protects each user's layouts are the Firestore security rules in
// firestore.rules. Committing this file (and serving it from GitHub Pages) is
// expected.
//
// Setup steps and troubleshooting: docs/firebase.md

export const firebaseConfig = {
  apiKey: 'AIzaSyDqi_NLPG6qQfPDNv4q2EagXk7kyhsFLbU',
  authDomain: 'expotracker-6e353.firebaseapp.com',
  projectId: 'expotracker-6e353',
  storageBucket: 'expotracker-6e353.firebasestorage.app',
  messagingSenderId: '980879059261',
  appId: '1:980879059261:web:b1086110b963ee190dfd54',
  // Carried over from the console, unused by the editor today: the Realtime
  // Database URL and the Analytics measurement id (we use Firestore, and the
  // editor loads no analytics).
  databaseURL: 'https://expotracker-6e353-default-rtdb.firebaseio.com',
  measurementId: 'G-LG7KRYCFHQ',
};

// A value still holding its placeholder, or a blank, means "not set up yet".
const PLACEHOLDER = /^(\s*|PASTE_[A-Z_]*|0{12})$/;

export function isFirebaseConfigured() {
  return ['apiKey', 'authDomain', 'projectId', 'appId'].every(
    (key) => !PLACEHOLDER.test(String(firebaseConfig[key] ?? '')),
  );
}
