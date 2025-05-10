import { Request, Response } from "express";
import webPush, { PushSubscription } from "web-push";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";

webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export const unsubscribe = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { endpoint } = req.body;

  if (!endpoint) {
    return res.status(400).json({ message: "Endpoint é obrigatório." });
  }

  try {
    const deleted = await prisma.subscription.deleteMany({
      where: { endpoint },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ message: "Inscrição não encontrada." });
    }

    return res.status(200).json({ message: "Inscrição removida com sucesso." });
  } catch (err) {
    console.error("Erro ao desinscrever:", err);
    return res
      .status(500)
      .json({ message: "Erro interno ao remover inscrição." });
  }
};

export const subscribe = async (req: Request, res: Response): Promise<any> => {
  const subscription: PushSubscription = req.body;

  // Verifica se a inscrição já existe no banco de dados com Prisma
  const existingSubscription = await prisma.subscription.findFirst({
    where: {
      endpoint: subscription.endpoint,
    },
  });

  if (existingSubscription) {
    // Se já estiver inscrito, retorna uma resposta informando que já existe
    return res
      .status(200)
      .json({
        message: "Você já está inscrito para notificações.",
        new: false,
      });
  }

  // Se não estiver inscrito, armazena a inscrição no banco de dados
  await prisma.subscription.create({
    data: {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  });

  res.status(201).json({ message: "Inscrição salva com sucesso", new: true });
};

export const sendNotification = async (req: Request, res: Response) => {
  // Recupera todas as inscrições salvas no banco com Prisma
  const subscriptions = await prisma.subscription.findMany();

  const payload = JSON.stringify({
    title: "Estoque Atualizado",
    body: "O estoque de um produto foi alterado.",
  });

  const failedSubscriptions: string[] = [];

  // Envia a notificação para cada inscrição
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
      } catch (err) {
        console.error("Erro ao enviar notificação:", err);

        // Se falhar, adiciona à lista de inscrições inválidas
        failedSubscriptions.push(sub.endpoint);
      }
    })
  );

  // Remove as inscrições inválidas
  if (failedSubscriptions.length > 0) {
    await prisma.subscription.deleteMany({
      where: {
        endpoint: {
          in: failedSubscriptions,
        },
      },
    });
  }

  res.status(200).json({
    message: "Notificações enviadas e inscrições inválidas removidas",
  });
};
