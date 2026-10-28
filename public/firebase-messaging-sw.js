importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "SUA_API_KEY_FIREBASE",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO_FIREBASE",
  messagingSenderId: "SEU_MESSAGING_SENDER_ID",
  appId: "SEU_FIREBASE_APP_ID"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {

  const titulo =
    payload.notification?.title ||
    "Sítio 4 Irmãos";

  const opcoes = {
    body:
      payload.notification?.body ||
      "Novo alerta do sistema.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  };

  self.registration.showNotification(
    titulo,
    opcoes
  );
});