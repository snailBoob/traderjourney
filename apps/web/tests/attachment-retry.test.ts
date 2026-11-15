import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-attachment-retry-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, attachments } = await import("../src/db");
const { POST } = await import("../src/app/api/attachments/route");
const uploadId = "f1fd70fa-2705-45e4-8e99-2eb319ca107a";
const upload = (id = uploadId, day = "2026-10-01", name = "chart.png") => {
  const form = new FormData();
  form.set("type", "day");
  form.set("id", day);
  if (id) form.set("uploadId", id);
  form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name));
  return POST(new Request("http://localhost/api/attachments", { method: "POST", body: form }));
};

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(attachments).run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("retries a committed upload after a lost response without adding another attachment", async () => {
  expect((await upload()).status).toBe(200); // Client never receives this response.
  const retry = await upload();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ id: uploadId });
  expect(db.select().from(attachments).all()).toHaveLength(1);
});

it("rejects reuse of an upload ID for a different day or file", async () => {
  await upload();
  expect((await upload(uploadId, "2026-10-02")).status).toBe(400);
  expect((await upload(uploadId, "2026-10-01", "other.png")).status).toBe(400);
  expect(db.select().from(attachments).all()).toHaveLength(1);
});

it("keeps legacy uploads independent and validates supplied upload IDs", async () => {
  expect((await upload("")).status).toBe(200);
  expect((await upload("")).status).toBe(200);
  expect((await upload("invalid")).status).toBe(400);
  expect(db.select().from(attachments).all()).toHaveLength(2);
});
