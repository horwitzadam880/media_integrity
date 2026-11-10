import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { getFileHash } from "../helper/helper.js";

const execAsync = promisify(exec);

export async function getArtifactHash(outputDir: string, name: string) {
  const _isMediaFile = (fileName: string) => {
    if (
      fileName === "audio_track1.m4a" ||
      fileName === "audio_track2.m4a" ||
      fileName === "final_combined.mp4" ||
      fileName === "video_only.mp4"
    ) {
      return true;
    }
    return false;
  };

  const _isHarFile = (fileName: string) => {
    return fileName === "brock-footage.har";
  };

  const getDir = (fileName: string) => {
    if (_isMediaFile(fileName)) {
      return "media";
    } else if (_isHarFile(fileName)) {
      return "recordings";
    } else {
      return "";
    }
  };

  const filePath = path.join(outputDir, getDir(name), name);

  const res = await getFileHash(filePath);
  return res;
}

export async function getAttachmentHash(outputDir: string, name: string) {
  const filePath = path.join(outputDir, name);
  const result = await getFileHash(filePath);
  return result;
}

export async function getCommitHash() {
  const { stdout } = await execAsync("git rev-parse HEAD");
  return stdout.trim();
}
