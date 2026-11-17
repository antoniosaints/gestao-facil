// Delegated listeners also cover forms loaded later by HTMX/loadPage.
(() => {
  const groups = (value, sizes, separators) => {
    let offset = 0;
    return sizes.map((size, index) => {
      const part = value.slice(offset, offset += size);
      return part ? separators[index] + part : '';
    }).join('');
  };
  const phone = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 15);
    const international = value.trimStart().startsWith('+') || digits.length > 11;
    if (!digits) return international ? '+' : '';
    if (international && (!digits.startsWith('55') || digits.length > 13)) return '+' + digits;
    const local = international ? digits.slice(2) : digits;
    const formatted = groups(local, [2, local.length > 10 ? 5 : 4, 4], ['', ') ', '-']);
    const national = local.length > 2 ? '(' + formatted : formatted;
    return international ? '+' + digits.slice(0, 2) + (local ? ' ' + national : '') : national;
  };
  function apply(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.inputMask) return;
    const original = input.value;
    const start = input.selectionStart;
    const digits = original.replace(/\D/g, '');
    let formatted;
    if (input.dataset.inputMask === 'phone') formatted = phone(original);
    else if (input.dataset.inputMask === 'cep') formatted = groups(digits.slice(0, 8), [5, 3], ['', '-']);
    else if (input.dataset.inputMask === 'cpf-cnpj') {
      const document = digits.slice(0, 14);
      formatted = document.length <= 11
        ? groups(document, [3, 3, 3, 2], ['', '.', '.', '-'])
        : groups(document, [2, 3, 3, 4, 2], ['', '.', '.', '/', '-']);
    } else return;
    if (formatted === original) return;
    input.value = formatted;
    if (event.type === 'input' && start !== null) {
      const before = original.slice(0, start).replace(/\D/g, '').length;
      let position = 0, count = 0;
      while (position < formatted.length && count < before) {
        if (/\d/.test(formatted[position])) count++;
        position++;
      }
      input.setSelectionRange(position, position);
    }
  }
  for (const event of ['input', 'focusin', 'change']) document.addEventListener(event, apply);
})();
