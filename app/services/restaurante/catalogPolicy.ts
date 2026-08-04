export interface RestauranteOpcaoPolicyInput {
  nome: string;
  ativo: boolean;
}

export interface RestauranteGrupoPolicyInput {
  minimo: number;
  maximo: number;
  opcoes: RestauranteOpcaoPolicyInput[];
}

export function validateRestauranteGrupo(input: RestauranteGrupoPolicyInput): string[] {
  const errors: string[] = [];
  const activeOptions = input.opcoes.filter((option) => option.ativo);

  if (input.minimo > input.maximo) {
    errors.push("O minimo de escolhas nao pode ser maior que o maximo.");
  }

  if (input.minimo > activeOptions.length) {
    errors.push("O minimo de escolhas nao pode superar a quantidade de opcoes ativas.");
  }

  const normalizedNames = activeOptions.map((option) => option.nome.trim().toLocaleLowerCase("pt-BR"));
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    errors.push("As opcoes ativas do grupo devem ter nomes diferentes.");
  }

  return errors;
}
