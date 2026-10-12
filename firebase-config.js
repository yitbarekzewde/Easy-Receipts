// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBtckPnfL_Df2ptF27kxN8iK95Th7CWDuw",
  authDomain: "easy-receipts-2.firebaseapp.com",
  projectId: "easy-receipts-2",
  storageBucket: "easy-receipts-2.firebasestorage.app",
  messagingSenderId: "290599167080",
  appId: "1:290599167080:web:1f421a2dc33d73e822c7dd",
  measurementId: "G-M5140ZE5F3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app, "easy-receipts-main");
