import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD6krHqIlaD7Jo-ERhNxEFuuenwjwHrho',
  authDomain: 'base-737bf.firebaseapp.com',
  projectId: 'base-737bf',
  storageBucket: 'base-737bf.firebasestorage.app',
  messagingSenderId: '560283994192',
  appId: '1:560283994192:web:ede7aa7a3714c439542955',
  measurementId: 'G-LMQC9RVF2E',
};

const firebaseApp = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const firebaseAuth = getAuth(firebaseApp);
const firebaseDb = getFirestore(firebaseApp);

export { firebaseApp, firebaseAuth, firebaseDb };
