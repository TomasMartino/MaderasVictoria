/* Configuración de Firebase para Maderas Victoria.
 * Se carga por etiqueta <script> (CDN), sin npm ni build step.
 * Expone window.TV_AUTH y window.TV_DB para usar en app.js.
 */
(function () {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyCiamjididC13iXvwh4QKVUPpJ9R6dYxJs",
    authDomain: "ecommerce-coder-1dea9.firebaseapp.com",
    projectId: "ecommerce-coder-1dea9",
    storageBucket: "ecommerce-coder-1dea9.firebasestorage.app",
    messagingSenderId: "232385402023",
    appId: "1:232385402023:web:8074a050d7c68b2f1bb782",
  };

  if (typeof firebase === "undefined") {
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    window.TV_AUTH = firebase.auth();
    window.TV_DB = firebase.firestore();
  } catch (e) {
    /* Firebase no disponible: la app sigue funcionando en modo local */
  }
})();
