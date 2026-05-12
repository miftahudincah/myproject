// KONFIGURASI FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBZg9NpbBAg8dKHkCbYf4J_2bpHH2ZJWWI",
  authDomain: "absensi-4389a-default-rtdb.firebaseapp.com",
  databaseURL: "https://absensi-4389a-default-rtdb.firebaseio.com",
  projectId: "absensi-4389a-default-rtdb",
  storageBucket: "absensi-4389a-default-rtdb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

// API KEY IMGBB (Untuk Upload Foto)
const IMGBB_KEY = "67650d8ee67ebb8bba94f3bb2c72eb4f"; 

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();