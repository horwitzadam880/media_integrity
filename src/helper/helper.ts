import { exec, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

// Promisify exec for clean async/await usage
const execAsync = promisify(exec);

interface UploadConfig {
  bucketName: string;
  localPath: string;
  projectId: string;
}

const config: UploadConfig = {
  bucketName: "brock_footage_forensic_artifacts",
  localPath: "./output",
  projectId: "hopeful-text-494620-c1",
};

export interface AudioTrack {
  bitrate?: number;
  channels?: string;
  groupId: string;
  language: string;
  name: string;
  uri: string;
}

// old

export interface VariantStream {
  bandwidth: number;
  codecs: string;
  name?: string;
  resolution?: string;
  uri: string;
}

export async function getFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fileStream = createReadStream(filePath);

  try {
    // Pipeline safely handles stream errors and cleanup
    await pipeline(fileStream, hash);
    return hash.digest("hex");
  } catch (err) {
    console.error(`Hash calculation failed for ${filePath}:`, err);
    throw err;
  }
}

export function parseAudioTracks(text: string): AudioTrack[] {
  const lines = text.split("\n");
  const tracks: AudioTrack[] = [];

  for (const line of lines) {
    if (line.includes("#EXT-X-MEDIA:TYPE=AUDIO")) {
      const groupId = /GROUP-ID="([^"]+)"/.exec(line)?.[1] ?? "";
      const name = /NAME="([^"]+)"/.exec(line)?.[1] ?? "";
      const language = /LANGUAGE="([^"]+)"/.exec(line)?.[1] ?? "";
      const channels = /CHANNELS="([^"]+)"/.exec(line)?.[1];
      const uri = /URI="([^"]+)"/.exec(line)?.[1] ?? "";

      // Extract bitrate from groupId (aud128k, aud192k, etc)
      const bitrate = parseInt(/(\d+)k?$/.exec(groupId)?.[1] ?? "0");

      if (uri) {
        tracks.push({ bitrate, channels, groupId, language, name, uri });
      }
    }
  }

  return tracks;
}

export function parseVariantStreams(text: string): VariantStream[] {
  const lines = text.split("\n");
  const streams: VariantStream[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = line.replace("#EXT-X-STREAM-INF:", "");
      const bandwidth = parseInt(/BANDWIDTH=(\d+)/.exec(attrs)?.[1] ?? "0");
      const resolution = /RESOLUTION=([^,]+)/.exec(attrs)?.[1];
      const codecs = /CODECS="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const name = /NAME="([^"]+)"/.exec(attrs)?.[1];
      const uri = lines[i + 1]?.trim();

      if (uri) {
        streams.push({ bandwidth, codecs, name, resolution, uri });
      }
    }
  }

  return streams;
}

export async function processMedia(
  videoUrl: string,
  audioUrl1: string,
  audioUrl2: string,
) {
  // Arguments are an array. No need to wrap URLs in extra quotes here!
  const args = [
    "-loglevel",
    "debug",
    "-i",
    videoUrl,
    "-i",
    audioUrl1,
    "-i",
    audioUrl2,
    "-map",
    "0:v",
    "-c",
    "copy",
    "output/media/video_only.mp4",
    "-map",
    "1:a",
    "-c",
    "copy",
    "output/media/audio_track1.m4a",
    "-map",
    "2:a",
    "-c",
    "copy",
    "output/media/audio_track2.m4a",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:a",
    "-c",
    "copy",
    "output/media/final_combined.mp4",
  ];

  const ffmpeg = spawn("ffmpeg", args);

  // Optional: Stream the logs to a file so you can debug if it fails
  const logStream = createWriteStream("./output/ffmpeg-log.txt");

  // Handle FFmpeg output and errors
  pipeline(ffmpeg.stderr, logStream).catch((err: unknown) => {
    console.error("Error writing FFmpeg logs:", err);
  });

  return new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log("FFmpeg finished successfully");
        resolve(true);
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${String(code ?? "unknown")}. Check ffmpeg-log.txt`,
          ),
        );
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

export function unescapeUrl(url: string): string {
  return url.replace(/\\/g, "");
}

export async function uploadToGCS(): Promise<void> {
  // Strict check for the environment variable
  const keyContent = process.env.GDRIVE_KEY;
  if (!keyContent) {
    throw new Error("GDRIVE_KEY environment variable is missing.");
  }

  // Define temp path in a secure location
  const tempKeyPath = path.join(os.tmpdir(), `gcp-auth.json`);

  try {
    // 1. Create temp key file (using async fs to avoid linting errors)
    await fs.writeFile(tempKeyPath, keyContent, { mode: 0o600 });
    console.log("Secure temporary key created.");

    // 2. Authenticate
    // We use gcloud storage (modern) instead of gsutil
    await execAsync(
      `gcloud auth activate-service-account --key-file="${tempKeyPath}"`,
    );
    await execAsync(`gcloud config set project ${config.projectId}`);

    // 3. Parallel Upload
    // -r: Recursive
    console.log("Beginning multi-threaded upload...");
    const { stderr, stdout } = await execAsync(
      `gcloud storage cp -r "${config.localPath}" gs://${config.bucketName}/`,
    );

    console.log("Upload output:", stdout || stderr);
  } catch (error) {
    // Strict error handling
    if (error instanceof Error) {
      console.error("Upload failed:", error.message);
    } else {
      console.error("An unknown error occurred during upload.");
    }
    throw error;
  } finally {
    // 4. Forensic Cleanup
    try {
      await fs.unlink(tempKeyPath);
      console.log("Temporary credentials purged from disk.");
    } catch (cleanupError) {
      console.error("Failed to remove temp key:", cleanupError);
    }
  }
}

const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
};

export const hashDirectory = async (
  dir: string,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};

  const entries = await fs.readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        if (entry.isDirectory()) return;

        const fullPath = path.join(dir, entry.name);
        result[entry.name] = await hashFile(fullPath);
      }),
  );

  return result;
};
