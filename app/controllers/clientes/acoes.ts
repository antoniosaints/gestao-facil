import { ClientesFornecedores } from "../../../generated";

export const acoes = (row: ClientesFornecedores) => {
  return `<div class="flex flex-nowrap items-center gap-1 p-1">
            <button
                onclick="openModalClientes(${row.id})"
                class="text-success px-1 py-[2px] rounded">
                <i class="fa-solid fa-user-pen"></i>
            </button>
            <button
                onclick="excluirCliente(${row.id})"
                class="text-danger px-1 py-[2px] rounded">
                <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
};
