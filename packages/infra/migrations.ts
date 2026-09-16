import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().regex(/^\d+_[\w-]+$/) })).min(1),
});

export async function prepareMigrations() {
  const source = new URL("../db/src/migrations/", import.meta.url);
  const target = new URL("./.alchemy/migrations/", import.meta.url);
  const journal = journalSchema.parse(
    JSON.parse(await readFile(new URL("meta/_journal.json", source), "utf8")),
  );
  const files = journal.entries.map(({ tag }) => `${tag}.sql`);
  const sqlFiles = (await readdir(source)).filter((file) => file.endsWith(".sql")).sort();

  if (files.join("\n") !== sqlFiles.join("\n")) {
    throw new Error("Migration files must match the Drizzle journal in order.");
  }

  // Alchemy reads plain SQL; Drizzle keeps its journal and snapshots in the source folder.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await Promise.all(files.map((file) => copyFile(new URL(file, source), new URL(file, target))));

  return fileURLToPath(target);
}
