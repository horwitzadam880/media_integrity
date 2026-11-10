import { execFile, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  getArtifactHash,
  getAttachmentHash,
  getCommitHash,
} from "#helper/test-helper";

interface AttachmentHashManifest {
  files: Record<string, string>;
}

interface Manifest {
  files: Record<string, string>;
  hashedLinkPassword: string;
}

type VerificationResult = {
  verificationResult: {
    signature: {
      certificate: { buildSignerDigest: string; githubWorkflowSHA: string };
    };
  };
}[];

const execFileAsync = promisify(execFile);
const commitSHA = await getCommitHash();
const containerDigest = process.env.CONTAINER_DIGEST;

describe("manifest.json", () => {
  it("should be verified with sigstore", () => {
    const result = spawnSync(
      "sigstore",
      [
        "verify",
        "github",
        "--repository=horwitzadam880/media_integrity",
        `--sha=${commitSHA}`,
        "--bundle=./artifacts/manifest.json.sigstore.json",
        "--verbose",
        "./output/manifest.json",
      ],
      { encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("OK: output/manifest.json");
  });

  it("should contain the correct hashed link password", () => {
    const outputDir = path.resolve("output");
    const manifest = JSON.parse(
      await readFile(path.join(outputDir, "manifest.json"), "utf8"),
    ) as Manifest;

    expect(manifest.hashedLinkPassword).toEqual(
      "19e78e2a2d98518400d5f234c6d1e845bf20a9405d8541c10d91870864ddba27",
    );
  });
});

describe("container", () => {
  it("should be verified through github", { timeout: 60_000 }, async () => {
    const token = process.env.GH_TOKEN;

    const { stdout } = await execFileAsync(
      "gh",
      [
        "attestation",
        "verify",
        `oci://ghcr.io/horwitzadam880/media_integrity@sha256:${containerDigest ?? ""}`,
        "--repo=horwitzadam880/media_integrity",
        "--format",
        "json",
      ],
      {
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "true",
          ...(token ? { GH_TOKEN: token } : {}),
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      },
    );

    const data = JSON.parse(stdout) as VerificationResult;

    expect(data).toHaveLength(1);
    const certificate = data[0].verificationResult.signature.certificate;
    expect(certificate.githubWorkflowSHA).toEqual(commitSHA);
    expect(certificate.buildSignerDigest).toEqual(commitSHA);
  });
});

describe("output files", () => {
  it(
    "every preserved artifact hash matches against the manifest",
    { timeout: 300_000 },
    async () => {
      const outputDir = path.resolve("output");
      const manifest = JSON.parse(
        await readFile(path.join(outputDir, "manifest.json"), "utf8"),
      ) as Manifest;

      const mismatches = [];

      for (const [name, expectedHash] of Object.entries(manifest.files)) {
        const actualHash = await getArtifactHash(outputDir, name);

        if (actualHash !== expectedHash) {
          mismatches.push(actualHash);
        }
      }
      expect(mismatches.length).toEqual(0);
    },
  );

  it(
    "every HAR attachment hash matches against its attachment manifest",
    { timeout: 300_000 },
    async () => {
      const outputDir = path.resolve("output");
      const recordingsDir = path.join(outputDir, "recordings");
      const manifest = JSON.parse(
        await readFile(
          path.join(outputDir, "brock-har-attachments-manifest.json"),
          "utf8",
        ),
      ) as AttachmentHashManifest;

      const mismatches: string[] = [];

      for (const [name, expectedHash] of Object.entries(manifest.files)) {
        const actualHash = await getAttachmentHash(recordingsDir, name);

        if (actualHash !== expectedHash) {
          mismatches.push(actualHash);
        }
      }

      expect(mismatches.length).toEqual(0);
    },
  );
});
