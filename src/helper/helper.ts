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

export async function compressChromeContext() {
  const contextPath = path.join(rootOutputDir, "chrome-persistent-context");
  await execAsync(
    `tar -czvf ${path.join(rootOutputDir, "chrome-persistent-context.tar.gz")} ${contextPath}`,
  );
}

export async function createOutputFolders() {
  // await execAsync("rm -rf output");
  await execAsync("mkdir -p output/media output/recordings");
}

export async function getExternalIPAddress() {
  const { stdout } = await execAsync(
    "dig +short txt ch whoami.cloudflare @1.0.0.1",
  );
  return stdout.trim().replaceAll('"', "");
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

const rootOutputDir = path.join(process.cwd(), "output");

export async function processMedia(
  videoUrl: string,
  audioUrl1: string,
  audioUrl2: string,
  rootOutputDir: string,
): Promise<boolean> {
  const mediaDir = path.join(rootOutputDir, "media");
  const logFilePath = path.join(rootOutputDir, "ffmpeg-log.txt");
  const finalCombinedPath = path.join(mediaDir, "final_combined.mp4");

  await fs.mkdir(mediaDir, { recursive: true });

  const masterArgs = [
    "-http_proxy",
    "http://127.0.0.1:9898",
    "-loglevel",
    "debug",
    "-i",
    videoUrl,
    "-i",
    audioUrl1,
    "-i",
    audioUrl2,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:a:0",
    "-c",
    "copy",
    "-metadata:s:a:0",
    "title=Audio Track 1",
    "-metadata:s:a:1",
    "title=Audio Track 2",
    "-movflags",
    "+faststart",
    finalCombinedPath,
  ];

  const extractVideoArgs = [
    "-loglevel",
    "debug",
    "-i",
    finalCombinedPath,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-an",
    path.join(mediaDir, "video_only.mp4"),
  ];

  const extractAudio1Args = [
    "-loglevel",
    "debug",
    "-i",
    finalCombinedPath,
    "-map",
    "0:a:0",
    "-c",
    "copy",
    "-vn",
    path.join(mediaDir, "audio_track1.m4a"),
  ];

  const extractAudio2Args = [
    "-loglevel",
    "debug",
    "-i",
    finalCombinedPath,
    "-map",
    "0:a:1",
    "-c",
    "copy",
    "-vn",
    path.join(mediaDir, "audio_track2.m4a"),
  ];

  try {
    console.log("Starting master multi-track download pass...");
    await runFFmpeg(masterArgs, logFilePath);

    console.log("Extracting isolated video track...");
    await runFFmpeg(extractVideoArgs, logFilePath);

    console.log("Extracting isolated audio track 1...");
    await runFFmpeg(extractAudio1Args, logFilePath);

    console.log("Extracting isolated audio track 2...");
    await runFFmpeg(extractAudio2Args, logFilePath);

    console.log("All forensic processing stages completed successfully.");
    return true;
  } catch (error) {
    console.error(
      `Forensic media processing failed. Check logs at: ${logFilePath}`,
      error,
    );
    throw error;
  }
}

export async function startTCPDump() {
  const networkCapture = path.join(rootOutputDir, "network_capture.pcap");
  const consoleLog = path.join(rootOutputDir, "tcpdump_console.log");
  //$(ip route show default | awk '{print $5}')
  await execAsync(
    `tcpdump -i $(ip route show default | awk '{print $5}') -nn -B 8192 -U -s 0 -w ${networkCapture} > ${consoleLog} 2>&1 &`,
  );
}

export async function stopTCPDump() {
  await execAsync("pkill tcpdump");
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

async function runFFmpeg(args: string[], logPath: string): Promise<boolean> {
  const ffmpeg = spawn("ffmpeg", args);
  const logStream = createWriteStream(logPath, { flags: "a" });

  // Use modern pipeline to stream logs.
  // This automatically cleans up streams if either FFmpeg or the file system errors out.
  const loggingTask = pipeline(ffmpeg.stderr, logStream);

  // Wait for the OS process to clean close
  const processTask = new Promise<boolean>((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(true);
      else
        reject(
          new Error(`FFmpeg exited with code ${String(code ?? "unknown")}`),
        );
    });
    ffmpeg.on("error", reject);
  });

  // Concurrently wait for the process to end and logs to finish flushing safely
  try {
    await Promise.all([processTask, loggingTask]);
    return true;
  } catch (err) {
    // If anything fails, safely ensure the process is dead
    if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
      ffmpeg.kill("SIGKILL");
    }
    throw err;
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

export const extractSegmentNum = (url: string): number => {
  const match = /segment_num=(\d+)/.exec(url);
  if (!match) throw new Error(`No segment_num in URL: ${url}`);
  return parseInt(match[1]);
};

export const parseSegmentUrls = (m3u8Body: string): string[] =>
  m3u8Body
    .split("\n")
    .filter((line) => line.startsWith("https://"))
    .map((line) => line.trim());

export interface Segment {
  segment: number;
  status: "complete" | "downloading" | "error" | "initial";
  url: string;
}
