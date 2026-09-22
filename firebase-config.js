// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDTqPEj3EXTlAvHW6H2-O1u78dSIEHHggo",
  authDomain: "receipts-eccf0.firebaseapp.com",
  projectId: "receipts-eccf0",
  storageBucket: "receipts-eccf0.firebasestorage.app",
  messagingSenderId: "1012779995675",
  appId: "1:1012779995675:web:6dc991f5123f322d7b9ebe",
  measurementId: "G-E5LZ9XYVJH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
