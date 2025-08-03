import { LancamentoFinanceiro } from "../../../generated";

export const acoes = (row: LancamentoFinanceiro) => {
  return `<div class="flex flex-nowrap items-center gap-1 p-1">
            <button
                onclick="visualizarProduto('${row.id}')"
                class="text-cyan-500 px-1 py-[2px] rounded">
                <i class="fa-solid fa-eye"></i>
            </button>
            <button
                onclick="abrirModalReporProdutos('${row.id}')"
                class="text-info px-1 py-[2px] rounded">
                <i class="fa-solid fa-check-to-slot"></i>
            </button>
            <button
                onclick="editarProduto('${row.id}')"
                class="text-success px-1 py-[2px] rounded">
                <i class="fa-solid fa-file-pen"></i>
            </button>
            <button
                onclick="escluirLancamento('${row.id}')"
                class="text-danger px-1 py-[2px] rounded">
                <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
};
