/** Erro operacional seguro que a interface pode encaminhar à configuração do app. */
export class AppRequirementError extends Error {
  constructor(message: string, public code: string, public status = 422) {
    super(message);
  }
}
