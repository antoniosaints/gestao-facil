export function gerarIdUnicoComMetaFinal(prefixo: string, tamanho = 5, metaDigitos = 4) {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < tamanho; i++) {
    const randomIndex = Math.floor(Math.random() * caracteres.length);
    id += caracteres[randomIndex];
  }
  const timestamp = Date.now().toString();
  const metaFinal = timestamp.slice(-metaDigitos); // últimos dígitos do timestamp
  return `${prefixo}_${id}${metaFinal}`;
}