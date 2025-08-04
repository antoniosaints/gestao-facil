// Registro do Service Worker para notificações push
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("../sw.js");
} else {
  console.error("Service Worker não é suportado.");
}

if (!("Notification" in window) || !("serviceWorker" in navigator)) {
  document.getElementById("subscribeBtn").style.display = "none";
  document.getElementById("unsubscribeBtn").style.display = "none";
}

async function subscribeUserOnReceiverPush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const reg = await navigator.serviceWorker.ready;

  if (!reg) {
    console.error("Service Worker not ready");
    return;
  }

  const existingSub = await reg.pushManager.getSubscription();
  const applicationServerKey = urlBase64ToUint8Array(
    "BEvOYxnUgVFlu2FKPdGZ29LqI3oq98V36gXqETlmaVFVxDsjKx16cSxVt_sl5SPl8SMo_183GjPIUQAXYWv7Rsk"
  );

  let subscription = existingSub; // Verifica se a chave atual é diferente da usada na inscrição antiga

  if (subscription) {
    const sameKey = compareKeys(
      subscription.options.applicationServerKey,
      applicationServerKey
    );
    if (!sameKey) {
      await subscription.unsubscribe();
      subscription = null;
    }
  } // Cria nova inscrição se necessário

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  window.localStorage.setItem("pushEndpoint", subscription.endpoint);

  try {
    const data = await fetch("/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("gestao_facil:token")}`,
      },
    });

    if (!data.ok) {
      throw new Error(`Erro na requisição: ${data.status} ${data.statusText}`);
    }

    const res = await data.json();

    showNotification(res.message, res.new ? "success" : "info");
    document.getElementById("subscribeBtn").style.display = "none";
    document.getElementById("unsubscribeBtn").style.display = "block";
    document.getElementById("sendNotificationBtn").style.display = "block";
  } catch (error) {
    console.error("Erro ao processar a inscrição:", error);
    showNotification(error.responseJSON?.message || 'Erro inesperado na requisição', 'error');
  }
}

async function unsubscribeUserToReceivePush() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    showNotification("Nenhuma inscrição ativa para cancelar.", "info");
    return;
  }

  const endpoint = subscription.endpoint;

  const data = await fetch("/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("gestao_facil:token")}`,
    },
  });

  const res = await data.json();

  await subscription.unsubscribe();
  window.localStorage.removeItem("pushEndpoint");

  showNotification(res.message, res.new ? "success" : "info");
  document.getElementById("subscribeBtn").style.display = "block";
  document.getElementById("unsubscribeBtn").style.display = "none";
  document.getElementById("sendNotificationBtn").style.display = "none";
}

document
  .getElementById("subscribeBtn")
  .addEventListener("click", subscribeUserOnReceiverPush);

document
  .getElementById("unsubscribeBtn")
  .addEventListener("click", unsubscribeUserToReceivePush);

// Compara ArrayBuffers de forma segura
function compareKeys(buf1, buf2) {
  if (!buf1 || !buf2) return false;
  const a = new Uint8Array(buf1);
  const b = new Uint8Array(buf2);
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

document
  .getElementById("sendNotificationBtn")
  .addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      Swal.fire({
        icon: "error",
        title: "Erro",
        text: "Você não está inscrito para enviar notificações.",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
      });
      return;
    }

    await fetch("/send-notification", {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("gestao_facil:token")}`,
      },
    });
  });

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

if ("standalone" in window.navigator && !window.navigator.standalone) {
  Swal.fire({
    icon: "info",
    title: "Instale o app",
    text: "Adicione este site à tela de início para receber notificações.",
    toast: true,
    position: "top-end",
    showConfirmButton: true,
    confirmButtonText: "Ok, Fechar",
  });
}
