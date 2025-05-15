import { Request, Response } from "express";
import webPush, { PushSubscription } from "web-push";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  NotificationPayload,
  sendPushNotification,
} from "../../services/sendPushNotificationService";

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
  try {
    const subscription: PushSubscription = req.body;
    const { userId } = getCustomRequest(req).customData;

    if (!userId) {
      return res.status(400).json({ message: "ID do usuário é obrigatório." });
    }
    // Verifica se a inscrição já existe no banco de dados com Prisma
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        endpoint: subscription.endpoint,
      },
    });

    if (existingSubscription) {
      return res.status(200).json({
        message: "Você já está inscrito para notificações.",
        new: false,
      });
    }

    // Se não estiver inscrito, armazena a inscrição no banco de dados
    await prisma.subscription.create({
      data: {
        userId: Number(userId),
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    res.status(201).json({ message: "Inscrição salva com sucesso", new: true });
  } catch (err) {
    console.error("Erro ao salvar inscrição:", err);
    res.status(500).json({ message: "Erro interno ao salvar inscrição." });
  }
};

export const sendNotification = async (req: Request, res: Response) => {
  const { contaId } = getCustomRequest(req).customData;

  const payload: NotificationPayload = {
    title: "Estoque Atualizado",
    body: "O estoque de um produto foi alterado.",
  };

  await sendPushNotification(payload, contaId);

  res.status(200).json({
    message: "Notificações enviadas e inscrições inválidas removidas",
  });
};
