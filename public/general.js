document.addEventListener("DOMContentLoaded", async function () {
  if ("Notification" in window || "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();

    if (subscription) {
      document.getElementById("subscribeBtn").style.display = "none";
      document.getElementById("subscribeBtnHeader").style.display = "none";
      document.getElementById("unsubscribeBtn").style.display = "block";
      document.getElementById("unsubscribeBtnHeader").style.display =
        window.innerWidth < 768 ? "block" : "none";
      // document.getElementById("sendNotificationBtn").style.display = "block";
    } else {
      document.getElementById("subscribeBtn").style.display = "block";
      document.getElementById("subscribeBtnHeader").style.display =
        window.innerWidth < 768 ? "block" : "none";
      document.getElementById("unsubscribeBtn").style.display = "none";
      document.getElementById("unsubscribeBtnHeader").style.display = "none";
      // document.getElementById("sendNotificationBtn").style.display = "none";
    }
  }
});
function logOut() {
  localStorage.removeItem("gestao_facil:token");
  localStorage.removeItem("gestao_facil:refreshToken");
  localStorage.removeItem("gestao_facil:usuario");
  localStorage.removeItem("gestao_facil:username");
  localStorage.removeItem("gestao_facil:permissao");
  localStorage.setItem("gestao_facil:isauth", false);
  window.location.href = "/login";
}

function showNotification(message, type = "info") {
  // Remove existing notifications
  const existingNotification = document.querySelector(".notification");
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement("div");
  notification.className = `notification fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full`;

  const colors = {
    success: "bg-green-500 text-white",
    error: "bg-red-500 text-white",
    info: "bg-blue-500 text-white",
    warning: "bg-yellow-500 text-white",
  };

  const icons = {
    success: "fas fa-check-circle",
    error: "fas fa-exclamation-circle",
    info: "fas fa-info-circle",
    warning: "fas fa-exclamation-triangle",
  };

  notification.className += ` ${colors[type]}`;

  notification.innerHTML = `
                <div class="flex items-center space-x-3">
                    <i class="${icons[type]}"></i>
                    <span>${message}</span>
                </div>
            `;

  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.classList.remove("translate-x-full");
  }, 100);

  // Auto remove
  setTimeout(() => {
    notification.classList.add("translate-x-full");
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 5000);
}

function MaskToInputMoney(element) {
  return IMask(element, {
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

function MaskMoneyNative(element) {
  $(element).on("input", function (e) {
    let value = $(this).val().replace(/\D/g, "");
    value = (value / 100).toFixed(2).replace(".", ",");
    $(this).val(value);
  });
}

function getValueInputMoney(element) {
  const valor = $(element).val().replace(/\D/g, "");
  const numero = parseFloat(String(valor).replace(",", "."));
  return numero;
}

function MaskToInputPercentage(element) {
  return IMask(element, {
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

function toggleModeGerencial() {
  $.ajax({
    url: "/api/usuarios/toggleModeGerencial",
    type: "GET",
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
    dataType: "json",
    success: function (response) {
      window.location.href = "/gerencia";
    },
    error: function (xhr, status, error) {
      const mensagem =
        xhr.responseJSON?.message || "Erro inesperado na requisição";
      showNotification(mensagem, "error");
      if (status === 401) window.location.href = "/login";
    },
  });
}
