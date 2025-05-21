import { Request, Response, Router } from "express";
import { getCpuInfo, getDiskUsage, getMemoryUsage, getNetworkInfo } from "system-monitoring";

const monitorRouter = Router();

monitorRouter.get('/monitor/metrics', async (req: Request, res: Response) => {
  try {
    const [cpuInfo, memoryUsage, diskUsage, networkInterfaces] = await Promise.all([
      getCpuInfo(),
      getMemoryUsage(),
      getDiskUsage(),
      getNetworkInfo(),
    ]);

    res.json({
      cpu: cpuInfo,
      memory: memoryUsage,
      disk: diskUsage,
      network: networkInterfaces,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao coletar métricas do sistema.' });
  }
});

export {
  monitorRouter
}