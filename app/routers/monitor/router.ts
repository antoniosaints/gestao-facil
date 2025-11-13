import { Router } from "express";
import os from "os";
import { exec } from "child_process";
import util from "util";

const execAsync = util.promisify(exec);
const monitorRouter = Router();

function formatSize(bytes: number) {
  return {
    bytes,
    mb: +(bytes / 1024 / 1024).toFixed(2),
    gb: +(bytes / 1024 / 1024 / 1024).toFixed(2),
  };
}

async function getCpuInfo() {
  const cpus = os.cpus();
  return cpus.map((cpu) => ({
    model: cpu.model,
    speedMHz: cpu.speed,
    times: cpu.times,
  }));
}
async function getCpuUsagePercent(): Promise<number> {
  function cpuTimes() {
    const cpus = os.cpus();
    let idle = 0,
      total = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  const start = cpuTimes();
  await new Promise((r) => setTimeout(r, 100)); // 100ms intervalo
  const end = cpuTimes();

  const idleDiff = end.idle - start.idle;
  const totalDiff = end.total - start.total;

  const usage = 100 * (1 - idleDiff / totalDiff);
  return +usage.toFixed(2);
}

async function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total: formatSize(total),
    free: formatSize(free),
    used: formatSize(used),
    usagePercent: +((used / total) * 100).toFixed(2),
  };
}

async function getDiskUsage() {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        "wmic logicaldisk get size,freespace,caption",
      );
      const lines = stdout.trim().split("\n").slice(1);
      const firstDisk = lines.find(Boolean);
      if (!firstDisk) return { error: "Nenhum disco encontrado" };

      const parts = firstDisk.trim().split(/\s+/);
      const caption = parts[0];
      const free = parseInt(parts[1] || "0", 10);
      const size = parseInt(parts[2] || "0", 10);
      const used = size - free;

      return {
        drive: caption,
        total: formatSize(size),
        used: formatSize(used),
        free: formatSize(free),
        usagePercent: +((used / size) * 100).toFixed(2),
      };
    } else {
      const { stdout } = await execAsync("df -kP /");
      const parts = stdout.trim().split("\n")[1].split(/\s+/);
      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      const available = parseInt(parts[3]) * 1024;

      return {
        filesystem: parts[0],
        total: formatSize(total),
        used: formatSize(used),
        free: formatSize(available),
        usagePercent: +((used / total) * 100).toFixed(2),
      };
    }
  } catch {
    return { error: "Não foi possível obter uso de disco" };
  }
}

async function getNetworkInfo() {
  return os.networkInterfaces();
}

monitorRouter.get("/monitor/metrics", async (req, res) => {
  try {
    const [cpuInfo, cpuUsage, memoryUsage, diskUsage, networkInterfaces] =
      await Promise.all([
        getCpuInfo(),
        getCpuUsagePercent(),
        getMemoryUsage(),
        getDiskUsage(),
        getNetworkInfo(),
      ]);

    res.json({
      cpu: cpuInfo,
      cpuUsage: cpuUsage,
      memory: memoryUsage,
      disk: diskUsage,
      network: networkInterfaces,
    });
  } catch {
    res.status(500).json({ error: "Erro ao coletar métricas do sistema." });
  }
});

export { monitorRouter };
