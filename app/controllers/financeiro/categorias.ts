import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { Prisma } from "../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import {
  achatarArvoreCategorias,
  montarArvoreCategorias,
  rotuloCompactoCategoria,
  validarMovimentoCategoria,
  type CategoriaFlat,
} from "../../services/financeiro/categoriaArvorePolicy";

/// Lista plana das categorias da conta — base para montar a hierarquia em memória
/// (o Prisma não faz CTE recursiva, e a tabela é pequena e escopada por conta).
async function listarCategoriasDaConta(contaId: number): Promise<CategoriaFlat[]> {
  return prisma.categoriaFinanceiro.findMany({
    where: { contaId },
    select: { id: true, Uid: true, nome: true, parentId: true },
  });
}

async function contarLancamentosPorCategoria(contaId: number) {
  const totais = await prisma.lancamentoFinanceiro.groupBy({
    by: ["categoriaId"],
    where: { contaId },
    _count: { _all: true },
  });

  return new Map(totais.map((item) => [item.categoriaId, item._count._all]));
}

export const select2Categorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    // A hierarquia pode ter vários níveis: monta a árvore e exibe o caminho
    // completo ("Custos fixos › Aluguel › Sala 2") em cada opção. O id nunca entra
    // no rótulo: é a PK de uma tabela compartilhada entre contas e não significa
    // nada para o usuário.
    const categorias = await listarCategoriasDaConta(customData.contaId);

    if (!categorias.length) {
      return res.json({ results: [] });
    }

    const opcoes = achatarArvoreCategorias(montarArvoreCategorias(categorias));

    // `label` é o rótulo curto (usado no campo depois de escolher) e `caminho` é a
    // hierarquia completa, exibida na lista de opções.
    const paraOpcao = (categoria: (typeof opcoes)[number]) => ({
      id: categoria.id,
      label: rotuloCompactoCategoria(categoria.caminho),
      caminho: categoria.caminho,
    });

    // Caso o select2 mande apenas um ID (edição, por exemplo)
    if (id) {
      const selecionada = opcoes.find((categoria) => categoria.id === Number(id));

      if (!selecionada) {
        return res.json({ results: [] });
      }

      return res.json({ results: [paraOpcao(selecionada)] });
    }

    const termo = search?.trim().toLowerCase() || "";
    const results = opcoes
      .filter((categoria) => !termo || categoria.caminho.toLowerCase().includes(termo))
      .slice(0, 30)
      .map(paraOpcao);

    return res.json({ results });
  } catch (error) {
    return res.json({ results: [] });
  }
};

export const listCategorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;

    const categorias = await prisma.categoriaFinanceiro.findMany({
      where: {
        contaId,
      },
      select: {
        id: true,
        nome: true,
        parentId: true,
      },
      orderBy: [{ parentId: "asc" }, { nome: "asc" }],
    });

    return ResponseHandler(res, "Categorias listadas com sucesso!", categorias, 200);
  } catch (error) {
    handleError(res, error);
  }
};

/// Árvore completa da conta (sem paginação: a tela de categorias é uma árvore,
/// e o volume por conta é pequeno). Traz o total de lançamentos por categoria
/// para a UI avisar antes de excluir.
export const getArvoreCategorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;

    const [categorias, totais] = await Promise.all([
      listarCategoriasDaConta(contaId),
      contarLancamentosPorCategoria(contaId),
    ]);

    const arvore = montarArvoreCategorias(categorias, totais);

    return ResponseHandler(res, "Árvore de categorias carregada!", {
      arvore,
      total: categorias.length,
    });
  } catch (error) {
    handleError(res, error);
  }
};

/// Reparenta uma categoria (drag & drop na árvore). `parentId: null` a torna raiz.
export const moverCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    const novoPaiId =
      req.body?.parentId === null || req.body?.parentId === undefined || req.body?.parentId === ""
        ? null
        : Number(req.body.parentId);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe uma categoria válida." });
    }

    if (novoPaiId !== null && (!Number.isInteger(novoPaiId) || novoPaiId <= 0)) {
      return res.status(400).json({ message: "Informe uma categoria de destino válida." });
    }

    const categorias = await listarCategoriasDaConta(contaId);
    const validacao = validarMovimentoCategoria({ categorias, id, novoPaiId });

    if (!validacao.permitido) {
      const status = validacao.motivo === "CATEGORIA_INEXISTENTE" ? 404 : 400;
      return res.status(status).json({ message: validacao.mensagem });
    }

    const categoria = await prisma.categoriaFinanceiro.update({
      where: { id, contaId },
      data: { parentId: novoPaiId },
      select: { id: true, nome: true, parentId: true },
    });

    return ResponseHandler(res, "Categoria movida com sucesso!", categoria);
  } catch (error) {
    handleError(res, error);
  }
};

export const saveCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id, nome, categoriaPai } = req.body;

    if (!nome) {
      return ResponseHandler(res, "Nome da categoria obrigatorio!", null, 400);
    }

    const { contaId } = getCustomRequest(req).customData;
    const parentId = categoriaPai ? Number(categoriaPai) : null;

    if (id) {
      // Editar também move na árvore: revalida ciclo e profundidade.
      const categorias = await listarCategoriasDaConta(contaId);
      const validacao = validarMovimentoCategoria({
        categorias,
        id: Number(id),
        novoPaiId: parentId,
      });

      if (!validacao.permitido) {
        const status = validacao.motivo === "CATEGORIA_INEXISTENTE" ? 404 : 400;
        return res.status(status).json({ message: validacao.mensagem });
      }

      const categoria = await prisma.categoriaFinanceiro.update({
        where: {
          id: Number(id),
          contaId,
        },
        data: {
          nome,
          parentId,
        },
        select: { id: true, nome: true },
      });
      return ResponseHandler(res, "Categoria salva com sucesso!", categoria, 200);
    }

    if (parentId !== null) {
      const pai = await prisma.categoriaFinanceiro.findFirst({
        where: { id: parentId, contaId },
        select: { id: true },
      });

      if (!pai) {
        return res.status(400).json({ message: "Categoria pai inválida para esta conta." });
      }
    }

    const categoria = await prisma.categoriaFinanceiro.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("CAT"),
        contaId,
        nome,
        parentId,
      },
      select: { id: true, nome: true },
    });

    return ResponseHandler(res, "Categoria salva com sucesso!", categoria, 200);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe uma categoria válida." });
    }

    const categoria = await prisma.categoriaFinanceiro.findFirst({
      where: { id, contaId },
      select: {
        id: true,
        nome: true,
        parentId: true,
        _count: { select: { lancamentos: true } },
      },
    });

    if (!categoria) {
      return res.status(404).json({ message: "Categoria não encontrada." });
    }

    if (categoria._count.lancamentos > 0) {
      return res.status(400).json({
        message: `A categoria "${categoria.nome}" possui ${categoria._count.lancamentos} lançamento(s) e não pode ser excluída.`,
      });
    }

    // As subcategorias sobem um nível (assumem o pai da categoria excluída) em vez
    // de virarem órfãs na raiz.
    await prisma.$transaction(async (tx) => {
      await tx.categoriaFinanceiro.updateMany({
        where: { parentId: id, contaId },
        data: { parentId: categoria.parentId },
      });

      await tx.categoriaFinanceiro.delete({ where: { id } });
    });

    return ResponseHandler(res, "Categoria deletada com sucesso!", null, 200);
  } catch (error) {
    handleError(res, error);
  }
};
