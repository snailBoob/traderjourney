import { handler, ok, requireValue } from "@/server/api";
import { createBackup, MAX_BACKUP_UPLOAD, restoreBackup } from "@/server/backup";

export const runtime = "nodejs";

export const POST = handler(
  async (request: Request) => {
    // A custom header also prevents cross-origin HTML forms from invoking restore.
    requireValue(request.headers.get("x-journal-backup") === "1", "Invalid backup request.");
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    // Next can use the internal listener in request.url. Host retains the
    // browser-facing address and port when the connection is forwarded.
    const host = request.headers.get("host");
    const expectedOrigin = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    requireValue(
      !origin || origin === expectedOrigin,
      "Cross-origin backup requests are not allowed.",
    );
    const password = decodeURIComponent(request.headers.get("x-backup-password") ?? "");
    const action = url.searchParams.get("action");
    if (action === "create") {
      const bytes = await createBackup(password);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="Tradejournal_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.zip"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    requireValue(action === "restore", "Choose backup or restore.");
    requireValue(
      Number(request.headers.get("content-length") ?? 0) <= MAX_BACKUP_UPLOAD,
      "Backup uploads are limited to 512 MiB.",
    );
    requireValue(request.body, "Upload a backup ZIP.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BACKUP_UPLOAD) {
          await reader.cancel();
          requireValue(false, "Backup uploads are limited to 512 MiB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    await restoreBackup(Buffer.concat(chunks), password);
    return ok({ restored: true });
  },
  { exclusive: true },
);
