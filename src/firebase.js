import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBfczrstepeJWwniLeTryr6oNLcRKSFk-I",
  authDomain: "life-mate-list-and-schedule.firebaseapp.com",
  projectId: "life-mate-list-and-schedule",
  storageBucket: "life-mate-list-and-schedule.firebasestorage.app",
  messagingSenderId: "202139325704",
  appId: "1:202139325704:web:3a7d9df55e2a6df2ef88bd"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
