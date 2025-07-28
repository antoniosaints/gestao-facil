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


function MaskToInputMoney(element) {
  IMask(element, {
    mask: Number,
    scale: 2,
    signed: false,
    thousandsSeparator: "",
    padFractionalZeros: true,
    normalizeZeros: true,
    radix: ",",
    mapToRadix: ["."],
  });
}

function MaskToInputPercentage(element) {
  IMask(element, {
    mask: "num",
    blocks: {
      num: {
        mask: Number,
        scale: 2,
        signed: false,
        thousandsSeparator: "",
        padFractionalZeros: true,
        normalizeZeros: true,
        radix: ",",
        mapToRadix: ["."],
        min: 0,
        max: 100,
      },
    },
    lazy: false,
  });
}
