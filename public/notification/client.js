// Registro do Service Worker para notificações push
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("../sw.js");
}
if (!("Notification" in window) || !("serviceWorker" in navigator)) {
  document.getElementById("subscribeBtn").style.display = "none";
  document.getElementById("unsubscribeBtn").style.display = "none";
}

document.getElementById("subscribeBtn").addEventListener("click", async () => {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      "BEvOYxnUgVFlu2FKPdGZ29LqI3oq98V36gXqETlmaVFVxDsjKx16cSxVt_sl5SPl8SMo_183GjPIUQAXYWv7Rsk"
    ),
  });
  window.localStorage.setItem("pushEndpoint", subscription.endpoint);
  const data = await fetch("/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
    headers: { "Content-Type": "application/json" },
  });
  const res = await data.json();

  Swal.fire({
    icon: res.new ? "success" : "info",
    title: res.new ? "Inscrição em notificações" : "Atualização de inscrição",
    text: res.message,
    toast: true,
    position: "bottom-end",
    showConfirmButton: false,
    timer: 3000,
  });
});
document
  .getElementById("unsubscribeBtn")
  .addEventListener("click", async () => {
    const endpoint = window.localStorage.getItem("pushEndpoint");
    if (!endpoint) {
      Swal.fire({
        icon: "error",
        title: "Erro",
        text: "Nenhuma inscrição em push encontrada.",
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
      });
      return;
    }
    const data = await fetch("/unsubscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: endpoint,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await data.json();
    if (res.error) {
      Swal.fire({
        icon: "error",
        title: "Erro",
        text: res.error,
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
      });
      return;
    }
    Swal.fire({
      icon: res.new ? "success" : "info",
      title: res.new ? "Inscrição em notificações" : "Atualização de inscrição",
      text: res.message,
      toast: true,
      position: "bottom-end",
      showConfirmButton: false,
      timer: 3000,
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
    position: "bottom",
    showConfirmButton: true,
    confirmButtonText: "Ok, Fechar",
  });
}
