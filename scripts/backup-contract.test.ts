import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = (name: string) => readFile(path.join(projectRoot, "scripts", name), "utf8");

describe("portable backup scripts", () => {
  it("exports JSON/CSV metadata plus a MongoDB dump and MinIO mirror", async () => {
    const [metadata, backup] = await Promise.all([script("export-metadata.ps1"), script("backup.ps1")]);
    expect(metadata).toContain("mongoexport");
    expect(metadata).toContain("entries.csv");
    expect(backup).toContain("mongodump");
    expect(backup).toContain("mc mirror --overwrite local/$MINIO_BUCKET /backup");
    expect(backup).toContain("backup-manifest.json");
  });

  it("requires explicit destructive restore confirmation and registers a local scheduled backup", async () => {
    const [restore, schedule] = await Promise.all([script("restore-backup.ps1"), script("register-backup-task.ps1")]);
    expect(restore).toContain("[switch]$ReplaceExisting");
    expect(restore).toContain("mongorestore");
    expect(schedule).toContain("schtasks /Create");
    expect(schedule).toContain("backup.ps1");
  });

  it("ships a non-destructive target-runtime validation command before any optional restore check", async () => {
    const validation = await script("verify-local-stack.ps1");
    expect(validation).toContain("Invoke-RestMethod -Uri \"http://localhost:8787/health\"");
    expect(validation).toContain("export-metadata.ps1");
    expect(validation).toContain("backup.ps1");
    expect(validation).toContain("Optional destructive restore check");
  });

  it("uses only database and object-storage keys declared in the local configuration template", async () => {
    const [metadata, backup, restore, config] = await Promise.all([script("export-metadata.ps1"), script("backup.ps1"), script("restore-backup.ps1"), readFile(path.join(projectRoot, "ops", "local-config.template"), "utf8")]);
    const declared = ["MONGO_DATABASE", "MONGO_INITDB_ROOT_USERNAME", "MONGO_INITDB_ROOT_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "MINIO_BUCKET"];
    declared.forEach(key => expect(config).toContain(`${key}=`));
    [metadata, backup, restore].forEach(contents => expect(contents).not.toContain("$MONGO_INITDB_DATABASE"));
    [metadata, backup, restore].forEach(contents => ["MONGO_DATABASE", "MONGO_INITDB_ROOT_USERNAME", "MONGO_INITDB_ROOT_PASSWORD"].forEach(key => expect(contents).toContain(`$${key}`)));
    [backup, restore].forEach(contents => ["MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "MINIO_BUCKET"].forEach(key => expect(contents).toContain(`$${key}`)));
  });
});
