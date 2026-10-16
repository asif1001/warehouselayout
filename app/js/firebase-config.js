// firebase-config.js — paste your Firebase web config here to turn on cloud
// saving (sign in, save layouts to your account, open them on any device).
//
// Where to get it:
//   Firebase console → Project settings → Your apps → SDK setup and config →
//   "Config" → copy the `firebaseConfig` object and replace the values below.
//
// This config is NOT a secret. It only identifies which Firebase project to talk
// to; what actually protects each user's layouts are the Firestore security
// rules in firestore.rules. Committing this file — and serving it from GitHub
// Pages — is expected.
//
// Leave the placeholders as they are and the editor runs exactly as before:
// cloud features stay hidden, and nothing is fetched from Firebase.
//
// Full walkthrough: docs/firebase.md

export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: '000000000000',
  appId: 'PASTE_APP_ID',
};

// A value still holding its placeholder, or a blank, means "not set up yet".
const PLACEHOLDER = /^(\s*|PASTE_[A-Z_]*|0{12})$/;

export function isFirebaseConfigured() {
  return ['apiKey', 'authDomain', 'projectId', 'appId'].every(
    (key) => !PLACEHOLDER.test(String(firebaseConfig[key] ?? '')),
  );
}
