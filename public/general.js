document.addEventListener("DOMContentLoaded", async function () {
  if ("Notification" in window || "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();

    if (subscription) {
      document.getElementById("subscribeBtn").style.display = "none";
      document.getElementById("unsubscribeBtn").style.display = "block";
      document.getElementById("sendNotificationBtn").style.display = "block";
    } else {
      document.getElementById("subscribeBtn").style.display = "block";
      document.getElementById("unsubscribeBtn").style.display = "none";
      document.getElementById("sendNotificationBtn").style.display = "none";
    }
  }
});
