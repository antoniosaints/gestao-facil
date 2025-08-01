async function loadQZ() {
  qz.security.setCertificatePromise(() => {
    return fetch("/printer/cert/public-key", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("gestao_facil:token")}`,
      },
    }).then((res) => res.text());
  });

  qz.security.setSignaturePromise((toSign) => {
    return fetch("/printer/cert/signature", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("gestao_facil:token")}`,
      },
      body: JSON.stringify({ data: toSign }),
    }).then((res) => res.text());
  });

  try {
    await qz.websocket.connect();
  } catch (err) {
    alert("QZ Tray não conectado");
  }
}

async function listarImpressoras() {
  const printers = await qz.printers.findAll();
  const select = document.getElementById("lista-impressoras");
  select.innerHTML = "";
  printers.forEach((p) => {
    const option = document.createElement("option");
    option.value = p;
    option.text = p;
    select.appendChild(option);
  });
  const salva = localStorage.getItem("gestafacil:impressora");
  if (salva) select.value = salva;
}

function salvarImpressora() {
  const impressora = document.getElementById("lista-impressoras").value;
  localStorage.setItem("gestafacil:impressora", impressora);
  alert("Impressora salva!");
}

function formatarReciboESC({
  loja = "CAS TELECOM",
  cnpj = "00.000.000/0000-00",
  endereco = "Rua Exemplo, 123 - Cidade",
  telefone = "(00) 0000-0000",
  dataHora = new Date(),
  itens = [],
  total = 0,
  pagamento = "Dinheiro",
  troco = 0,
}) {
  const ESC = "\x1B";
  const NL = "\x0A";

  function pad(text, length, align = "left") {
    if (align === "right") return text.toString().padStart(length);
    if (align === "center") {
      const padLeft = Math.floor((length - text.length) / 2);
      const padRight = length - text.length - padLeft;
      return " ".repeat(padLeft) + text + " ".repeat(padRight);
    }
    return text.toString().padEnd(length);
  }

  let output = "";

  // Reset e cabeçalho
  output += ESC + "@";
  output += ESC + "!" + "\x38"; // negrito + grande
  output += pad(loja, 32, "center") + NL;
  output += ESC + "!" + "\x00";
  output += pad("CNPJ: " + cnpj, 32) + NL;
  output += pad(endereco, 32) + NL;
  output += pad("Tel: " + telefone, 32) + NL;
  output += NL;

  output += pad("Data: " + dataHora.toLocaleString(), 32) + NL;
  output += "-".repeat(32) + NL;

  // Itens
  itens.forEach(({ descricao, qtd, valor }) => {
    const totalItem = (qtd * valor).toFixed(2);
    output +=
      pad(descricao, 16) +
      pad(`${qtd}x${valor.toFixed(2)}`, 8) +
      pad(totalItem, 8, "right") +
      NL;
  });

  output += "-".repeat(32) + NL;
  output += pad("TOTAL", 24) + pad("R$ " + total.toFixed(2), 8, "right") + NL;
  output += pad("Pagamento", 24) + pad(pagamento, 8, "right") + NL;
  output += pad("Troco", 24) + pad("R$ " + troco.toFixed(2), 8, "right") + NL;
  output += NL + pad("Obrigado pela preferência!", 32, "center") + NL;

  output += NL.repeat(3);
  output += ESC + "m"; // corte

  return output;
}

async function imprimirNota(content) {
  const impressora = localStorage.getItem("gestafacil:impressora");
  if (!impressora) return alert("Selecione uma impressora primeiro.");

  const config = qz.configs.create(impressora);
  const data = [
    {
      type: "raw",
      format: "plain",
      data: content,
    },
  ];

  await qz.print(config, data);
}
