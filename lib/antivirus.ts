import { spawn } from "node:child_process";

export async function scanUploadedFile(filePath: string, contentEncryption: "none" | "e2ee-v1"): Promise<void> {
  if (contentEncryption === "e2ee-v1") return;
  const scanner = process.env.CLAMSCAN_PATH?.trim();
  if (!scanner) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(scanner, ["--no-summary", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Антивирусная проверка превысила тайм-аут"));
    }, 120_000);
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      if (code === 1) return reject(new Error("Файл отклонён антивирусной проверкой"));
      reject(new Error(stderr.trim() || "Антивирусная проверка завершилась ошибкой"));
    });
  });
}
