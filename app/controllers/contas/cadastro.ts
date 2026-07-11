import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { addDays } from "date-fns";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { updateContaSchema } from "../../schemas/contas";
import { redisConnecion } from "../../utils/redis";
import { getConfiguredPlatformGateway } from "../../services/contas/platformGatewayService";
import { hashPassword } from "../../services/auth/passwordService";
import {
  getOrCreateCodigoIndicacao,
  getPlatformIndicacaoConfig,
  resolverIndicador,
  vincularIndicacaoNoCadastro,
} from "../../services/contas/indicacaoService";
import { getContaInfoCacheKey, syncAuthenticatedSessionCaches } from "../../services/session/accountSessionCacheService";
import { sendSessionUpdated } from "../../hooks/contas/socket";

export const criarConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      nome,
      email,
      senha,
      telefone,
      conta,
      tipo,
      funcionarios = 1,
      dicasNovidades,
      cpfCnpj,
      indicacao,
    } = req.body;

    if (
      !nome ||
      !email ||
      !senha ||
      !telefone ||
      !conta ||
      !tipo ||
      !funcionarios
    ) {
      return res.status(400).json({
        status: 400,
        message: "Todos os campos obrigatórios devem ser preenchidos",
        data: null,
      });
    }

    const platformGateway = await getConfiguredPlatformGateway();

    // Indicação: resolve o código informado (link/campo) antes de criar a conta.
    const indicadorContaId = await resolverIndicador(indicacao);

    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.contas.create({
        data: {
          nome: conta,
          email,
          valor: 70,
          valorBasePlano: 70,
          asaasCustomerId: "MERCADOPAGO",
          data: new Date(),
          funcionarios: Number(funcionarios),
          gateway: platformGateway as any,
          vencimento: addDays(new Date(), 7),
          categoria: tipo,
          tipo: tipo,
          dicasNovidades,
          documento: cpfCnpj,
          status: "ATIVO",
          telefone,
        },
      });
      const user = await tx.usuarios.create({
        data: {
          nome,
          email,
          senha: await hashPassword(senha),
          emailReceiver: true,
          pushReceiver: true,
          permissao: "root",
          status: "ATIVO",
          contaId: created.id,
          telefone,
        },
      });

      return {
        created,
        user,
      };
    });

    // Gera o código de indicação da nova conta (para ela mesma indicar depois).
    await getOrCreateCodigoIndicacao(data.created.id).catch((e) =>
      console.error("[indicacao] falha ao gerar código:", e),
    );

    // Vincula ao indicador e aplica o bônus do indicado (se o programa estiver ativo).
    if (indicadorContaId) {
      await vincularIndicacaoNoCadastro({
        novaContaId: data.created.id,
        indicadorContaId,
        valorBasePlano: data.created.valorBasePlano,
      }).catch((e) => console.error("[indicacao] falha ao vincular indicação:", e));
    }

    ResponseHandler(res, "Conta criada com sucesso", data);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const getMinhaIndicacao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;

    const codigo = await getOrCreateCodigoIndicacao(contaId);
    const [conta, indicados, config] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: { id: contaId },
        select: { creditoIndicacao: true, status: true },
      }),
      prisma.contas.findMany({
        where: { indicadoPorContaId: contaId },
        select: {
          id: true,
          nome: true,
          nomeFantasia: true,
          status: true,
          indicacaoRecompensada: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      getPlatformIndicacaoConfig(),
    ]);

    return ResponseHandler(res, "Dados de indicação", {
      codigo,
      creditoIndicacao: Number(conta.creditoIndicacao || 0),
      contaAtiva: conta.status === "ATIVO",
      programa: {
        ativo: config.ativa,
        tipoRecompensa: config.tipoRecompensa,
        valorRecompensa: config.valorRecompensa.toNumber(),
        tipoBonusIndicado: config.tipoBonusIndicado,
        valorBonusIndicado: config.valorBonusIndicado.toNumber(),
      },
      indicados: indicados.map((indicado) => ({
        id: indicado.id,
        nome: indicado.nomeFantasia || indicado.nome,
        status: indicado.status,
        recompensado: indicado.indicacaoRecompensada,
        createdAt: indicado.createdAt,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const atualizarDadosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const body = updateContaSchema.safeParse(req.body);

    if (!body.success) {
      return res.status(400).json({
        status: 400,
        message: body.error.issues[0].message,
        data: null,
      });
    }

    const conta = await prisma.contas.update({
      where: {
        id: customData.contaId,
      },
      data: {
        nome: body.data.nome,
        telefone: body.data.telefone,
        documento: body.data.documento,
        dicasNovidades: body.data.dicasNovidades,
        nomeFantasia: body.data.nomeFantasia,
        endereco: body.data.endereco,
        cep: body.data.cep,
        tipo: body.data.tipo,
        emailAvisos: body.data.emailAvisos,
      },
    });

    await syncAuthenticatedSessionCaches(customData.contaId, customData.userId);
    sendSessionUpdated(customData.contaId, {
      reason: "dados-conta-atualizados",
      contaId: customData.contaId,
    });

    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
export const dadosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const data = getCustomRequest(req).customData;
    const cacheKey = getContaInfoCacheKey(data.contaId);
    const cached = await redisConnecion.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const conta = await prisma.contas.findFirst({
      where: {
        id: data.contaId,
        Usuarios: {
          some: {
            id: data.userId,
          }
        },
      },
      include: {
        Usuarios: true,
      },
    });

    await redisConnecion.set(cacheKey, JSON.stringify(conta), "EX", 3600);
    
    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
export const infosConta = async (req: Request, res: Response): Promise<any> => {
  try {
    const data = getCustomRequest(req).customData;
    const conta = await prisma.contas.findFirst({
      where: {
        id: data.contaId,
      },
    });
    return res.json(conta);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
