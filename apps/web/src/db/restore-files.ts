import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { AUTH_DIRECTORY } from "@/lib/security-settings";

export const RESTORE_DIRECTORY = ".journal-restore";
type State = { old: string[]; incoming: string[]; phase: "moving" | "installing" | "committed" };

function saveState(root: string, state: State) {
  const file = join(root, "state.json");
  writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
  const fd = openSync(file + ".tmp", "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(file + ".tmp", file);
}

/** Runs before opening SQLite, also after a process interruption during replacement. */
export function recoverRestore(dir: string) {
  const root = join(dir, RESTORE_DIRECTORY);
  if (!existsSync(root)) return;
  const file = join(root, "state.json");
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, "utf8")) as State;
    if (state.phase !== "committed") {
      if (state.phase === "installing") {
        for (const name of state.incoming) {
          // A previous recovery may already have put an old entry back.
          if (!state.old.includes(name) || existsSync(join(root, "previous", name)))
            rmSync(join(dir, name), { recursive: true, force: true });
        }
        for (const suffix of ["-wal", "-shm"])
          rmSync(join(dir, `journal.db${suffix}`), { force: true });
      }
      for (const name of state.old) {
        const previous = join(root, "previous", name);
        if (existsSync(previous)) {
          rmSync(join(dir, name), { recursive: true, force: true });
          renameSync(previous, join(dir, name));
        }
      }
    }
  }
  rmSync(root, { recursive: true, force: true });
}

/** Caller closes SQLite first; the mount point itself is never renamed. */
export function replaceDataFiles(dir: string, verify: () => void) {
  const root = join(dir, RESTORE_DIRECTORY);
  const incomingDir = join(root, "incoming");
  mkdirSync(join(root, "previous"));
  const state: State = {
    old: readdirSync(dir).filter((name) => name !== RESTORE_DIRECTORY && name !== AUTH_DIRECTORY),
    incoming: readdirSync(incomingDir),
    phase: "moving",
  };
  saveState(root, state);
  for (const name of state.old) renameSync(join(dir, name), join(root, "previous", name));
  state.phase = "installing";
  saveState(root, state);
  for (const name of state.incoming) renameSync(join(incomingDir, name), join(dir, name));
  verify();
  state.phase = "committed";
  saveState(root, state);
  // Cleanup is retried on startup if the filesystem temporarily refuses it.
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* committed */
  }
}
