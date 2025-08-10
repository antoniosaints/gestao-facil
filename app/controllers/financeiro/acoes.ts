import { LancamentoFinanceiro } from "../../../generated";

export const acoes = (row: LancamentoFinanceiro) => {
  return `<div class="flex flex-nowrap items-center justify-center gap-1 p-1">
            <button
                onclick="visualizarLancamento('${row.id}')"
                class="text-cyan-500 px-1 py-[2px] rounded">
                <i class="fa-solid fa-eye"></i>
            </button>
            ${
              row.vendaId
                ? ``
                : ` <button
                        onclick="editarLancamento('${row.id}')"
                        class="text-success px-1 py-[2px] rounded">
                        <i class="fa-solid fa-file-pen"></i>
                    </button>
            `
            }
            ${
              row.status === "PAGO"
                ? ``
                : ``
            }
            <button
                onclick="escluirLancamento('${row.id}')"
                class="text-danger px-1 py-[2px] rounded">
                <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
};
