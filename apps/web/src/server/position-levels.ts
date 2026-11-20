import { execFile } from "node:child_process";
import { join } from "node:path";

type Levels = { stopLoss?: number; profitTarget?: number };

/** Best effort: a missing worker, timeout or unreadable chart must not prevent saving. */
export function recognizePositionLevels(bytes: Buffer): Promise<Levels> {
  return new Promise((resolve) => {
    const child = execFile(
      process.env.POSITION_OCR_PYTHON || "python3",
      [join(process.cwd(), "scripts/read-position-levels.py")],
      { timeout: 12_000, killSignal: "SIGKILL", maxBuffer: 8192 },
      (error, stdout) => {
        if (error) return resolve({});
        try {
          const raw = JSON.parse(stdout);
          const parsed: Levels = {};
          for (const [field, value] of [
            ["stopLoss", raw.stopLoss],
            ["profitTarget", raw.takeProfit],
          ] as const) {
            if (
              typeof value === "string" &&
              /^\d+\.\d+$/.test(value) &&
              Number.isFinite(Number(value)) &&
              Number(value) > 0
            )
              parsed[field] = Number(value);
          }
          resolve(parsed);
        } catch {
          resolve({});
        }
      },
    );
    child.stdin?.on("error", () => {}); // Worker may exit before reading the image.
    child.stdin?.end(bytes);
  });
}
