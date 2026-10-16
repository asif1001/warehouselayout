// cloud.js — Firebase Auth + Firestore: sign in, and save layouts to the account.
//
// The SDK is pulled from the gstatic CDN the first time it is actually needed,
// not at startup, so the editor stays quick and keeps working when the cloud is
// unconfigured or the network is down. Everything here throws on failure; the UI
// turns those into readable text with friendlyError() in cloudDocs.js.
//
// Storage layout (see firestore.rules for the matching rules):
//   users/{uid}/layouts/{id}     { name, schemaVersion, bytes, createdAt, updatedAt }
//   users/{uid}/layoutData/{id}  { data }
//
// Two documents sharing one id: the "My layouts" list only reads the metadata,
// so listing never downloads the plans themselves.

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import {
  cleanName,
  cloudDoc,
  docBytes,
  docSummary,
  fitsInDoc,
  formatBytes,
  MAX_DOC_BYTES,
} from './cloudDocs.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/12.5.0';
const LAYOUTS = 'layouts';
const DATA = 'layoutData';

let libPromise = null; // { app, auth, db, A, F }
let current = null; // the signed-in user, or null

export function cloudConfigured() {
  return isFirebaseConfigured();
}

export function signedInUser() {
  return current;
}

// Load the SDK once. A failure clears the cache so a later click can retry.
async function lib() {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    const [app, auth, store] = await Promise.all([
      import(`${SDK_BASE}/firebase-app.js`),
      import(`${SDK_BASE}/firebase-auth.js`),
      import(`${SDK_BASE}/firebase-firestore.js`),
    ]);
    const instance = app.initializeApp(firebaseConfig);
    return {
      app: instance,
      auth: auth.getAuth(instance),
      db: store.getFirestore(instance),
      A: auth,
      F: store,
    };
  })().catch((err) => {
    libPromise = null;
    throw err;
  });
  return libPromise;
}

// ---------------------------------------------------------------- auth

// Subscribe to sign-in state. `onUser` is called immediately with the current
// user (or null) and again on every change; `onError` reports observation
// failures (a bad API key, a blocked domain) so the UI can say so.
export async function watchAuth(onUser, onError) {
  const { auth, A } = await lib();
  A.onAuthStateChanged(
    auth,
    (user) => {
      current = user;
      onUser(user);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
  return current;
}

export async function signInWithGoogle() {
  const { auth, A } = await lib();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await A.signInWithPopup(auth, provider);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  const { auth, A } = await lib();
  const cred = await A.signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signUpWithEmail(email, password) {
  const { auth, A } = await lib();
  const cred = await A.createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function sendPasswordReset(email) {
  const { auth, A } = await lib();
  await A.sendPasswordResetEmail(auth, email);
}

export async function signOutNow() {
  const { auth, A } = await lib();
  await A.signOut(auth);
}

// ---------------------------------------------------------------- layouts

function uidOrThrow() {
  if (!current) throw new Error('Sign in first.');
  return current.uid;
}

// Newest first. Reads metadata only.
export async function listLayouts() {
  const { db, F } = await lib();
  const uid = uidOrThrow();
  const q = F.query(F.collection(db, 'users', uid, LAYOUTS), F.orderBy('updatedAt', 'desc'));
  const snap = await F.getDocs(q);
  return snap.docs.map((d) => docSummary(d.id, d.data()));
}

// Write the layout. Pass an id to update that saved layout, or nothing to create
// a new one. Returns the id written.
export async function saveLayout({ id, name, state }) {
  const { db, F } = await lib();
  const uid = uidOrThrow();
  const { meta, data } = cloudDoc(state, name);
  const bytes = docBytes(data);
  if (!fitsInDoc(data)) {
    throw new Error(
      `This layout is ${formatBytes(bytes)}, past the ${formatBytes(MAX_DOC_BYTES)} cloud limit.`,
    );
  }
  const now = F.serverTimestamp();
  const metas = F.collection(db, 'users', uid, LAYOUTS);
  const datas = F.collection(db, 'users', uid, DATA);
  const batch = F.writeBatch(db);
  let target = id;
  if (target) {
    // merge: true so createdAt is left alone on an update.
    batch.set(F.doc(metas, target), { ...meta, updatedAt: now }, { merge: true });
    batch.set(F.doc(datas, target), { data }, { merge: true });
  } else {
    target = F.doc(metas).id; // let Firestore mint the id
    batch.set(F.doc(metas, target), { ...meta, createdAt: now, updatedAt: now });
    batch.set(F.doc(datas, target), { data });
  }
  await batch.commit();
  return target;
}

// The stored db_connect payload, ready for adoptLayout().
export async function loadLayout(id) {
  const { db, F } = await lib();
  const uid = uidOrThrow();
  const snap = await F.getDoc(F.doc(db, 'users', uid, DATA, id));
  if (!snap.exists()) throw new Error('That saved layout has no stored data.');
  const data = snap.data().data;
  if (!data || typeof data !== 'object') throw new Error('That saved layout is empty.');
  return data;
}

export async function renameLayout(id, name) {
  const { db, F } = await lib();
  const uid = uidOrThrow();
  await F.updateDoc(F.doc(db, 'users', uid, LAYOUTS, id), {
    name: cleanName(name),
    updatedAt: F.serverTimestamp(),
  });
}

export async function deleteLayout(id) {
  const { db, F } = await lib();
  const uid = uidOrThrow();
  const batch = F.writeBatch(db);
  batch.delete(F.doc(db, 'users', uid, LAYOUTS, id));
  batch.delete(F.doc(db, 'users', uid, DATA, id));
  await batch.commit();
}
