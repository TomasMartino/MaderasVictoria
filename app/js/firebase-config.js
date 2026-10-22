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
    /* Colecciones de la etapa 2: ventas y gastos.
     * Se crean automáticamente en Firestore al escribir el primer documento. */
    window.TV_VENTAS = firebase.firestore().collection("ventas");
    window.TV_GASTOS = firebase.firestore().collection("gastos");
  } catch (e) {
    /* Firebase no disponible: la app sigue funcionando en modo local */
  }
})();
