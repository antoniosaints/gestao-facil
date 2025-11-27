import { differenceInYears, format, getMonth, isValid, parse, parseISO } from "date-fns";
import Decimal from "decimal.js";
import { ptBR } from "date-fns/locale";

export const formatToMoneyValue = (value: any) => {
  const roundedValue = parseFloat(value.toFixed(2));
  return roundedValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};
export const formatToNumberValue = (value: string | number): number => {
  if (typeof value !== 'string') return Number(value)

  // Se for uma string vazia, retorne 0
  if (typeof value === 'string' && value.trim() === '') return 0

  // Remove espaços e símbolos de moeda
  value = value.trim().replace(/[^\d.,-]/g, '')

  // Se tiver vírgula e ponto, assume que vírgula é decimal (ex: 1.234,56)
  if (value.includes(',') && value.includes('.')) {
    value = value.replace(/\./g, '').replace(',', '.')
  }
  // Se tiver só vírgula, substitui por ponto
  else if (value.includes(',')) {
    value = value.replace(',', '.')
  }

  const number = parseFloat(value)
  return isNaN(number) ? 0 : number
}
export const formatToMoneyDecimalValue = (valor: Decimal | number): string => {
  return `R$ ${new Decimal(valor).toFixed(2)}`
}
export function formatCurrencyBR(value: number | string): string {
  const valueFormated = typeof value === 'string' ? formatToNumberValue(value) : value
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valueFormated)
}


export const formatLabel = (label: string, color: string, icon: string, capitalize: boolean = true) => {
  const baseClasses = `inline-flex items-center gap-1 px-2 py-0.5 border-2 rounded-xl w-max`;
  return `<span class="${baseClasses} text-${color}-800 border-${color}-400 dark:border-${color}-700 dark:text-${color}-300">
    <i class="${icon}"></i>
    <span>${ capitalize ? formatToCapitalize(label) : label}</span>
  </span>`;
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 11) {
    return cleaned.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  }
  if (cleaned.length === 10) {
    return cleaned.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  }
  return phone;
}
export function formatToCapitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
export function formatToLowerCase(text: string): string {
  return text.toLowerCase();
}
export function formatToUpperCase(text: string): string {
  return text.toUpperCase();
}
export function formatGetWeekdayName(date: string | Date): string {
  const parsed = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(parsed)) return "";
  return format(parsed, "EEEE", { locale: ptBR });
}
export function formatGetDateDetails(date: string | Date): {
  mesNumero: number;
  mesNome: string;
  diaSemana: string;
} {
  const parsed = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(parsed)) return { mesNumero: 0, mesNome: "", diaSemana: "" };

  return {
    mesNumero: getMonth(parsed) + 1, // getMonth retorna de 0 a 11
    mesNome: format(parsed, "MMMM", { locale: ptBR }),
    diaSemana: format(parsed, "EEEE", { locale: ptBR }),
  };
}
export function formatGetYearsOld(dataNascimento: string | Date): number {
  const parsed = typeof dataNascimento === 'string' ? parseISO(dataNascimento) : dataNascimento;
  if (!isValid(parsed)) return 0;
  return differenceInYears(new Date(), parsed);
}
export function formatCPF(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
export function formatCNPJ(cnpj: string): string {
  return cnpj.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

export function formatGerarSlug(nome: string): string {
  return nome
    .normalize('NFD')                       
    .replace(/[\u0300-\u036f]/g, '')      
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')           
    .trim()
    .split(/\s+/)
    .join('-');
}

export function formatGerarIdUnicoSimples(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

export function formatDateToPtBR(input: string | Date): string {
  try {
    const date: Date = typeof input === "string" ? parseISO(input) : input;

    if (!isValid(date)) return "Data inválida";

    const hasTime = typeof input === "string" && /T\d{2}:\d{2}/.test(input);

    const pattern = hasTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy";

    return format(date, pattern, { locale: ptBR });
  } catch {
    return "Data inválida";
  }
}
export function formatParsePtBRToDate(datePtBR: string): Date | null {
  const hasTime = /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(datePtBR);
  const pattern = hasTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy";

  const parsedDate = parse(datePtBR, pattern, new Date());

  return isValid(parsedDate) ? parsedDate : null;
}

export function validarCpfCnpj(valor: string) {
  const num = valor.replace(/\D/g, '')

  // Verifica se é CPF (11 dígitos)
  if (num.length === 11) return validarCPF(num)

  // Verifica se é CNPJ (14 dígitos)
  if (num.length === 14) return validarCNPJ(num)

  return false
}

function validarCPF(cpf: string) {
  if (/^(\d)\1+$/.test(cpf)) return false

  let soma = 0
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i)
  let resto = (soma * 10) % 11
  if (resto === 10 || resto === 11) resto = 0
  if (resto !== parseInt(cpf[9])) return false

  soma = 0
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i)
  resto = (soma * 10) % 11
  if (resto === 10 || resto === 11) resto = 0
  return resto === parseInt(cpf[10])
}

function validarCNPJ(cnpj: string) {
  if (/^(\d)\1+$/.test(cnpj)) return false

  let tamanho = cnpj.length - 2
  let numeros = cnpj.substring(0, tamanho)
  let digitos = cnpj.substring(tamanho)
  let soma = 0
  let pos = tamanho - 7
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros[tamanho - i]) * pos--
    if (pos < 2) pos = 9
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
  if (resultado !== parseInt(digitos[0])) return false

  tamanho += 1
  numeros = cnpj.substring(0, tamanho)
  soma = 0
  pos = tamanho - 7
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros[tamanho - i]) * pos--
    if (pos < 2) pos = 9
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
  return resultado === parseInt(digitos[1])
}