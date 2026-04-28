import crypto from "crypto";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { type APIResponse, chromium, devices } from "playwright";
import { lastValueFrom, ReplaySubject, throwError, timer } from "rxjs";
import { filter, retry, take, timeout, toArray } from "rxjs/operators";

import {
  getFileHash,
  parseAudioTracks,
  parseVariantStreams,
  processMedia,
  unescapeUrl,
  uploadToGCS,
} from "#helper/helper.js";

const BROCK_FOOTAGE_URL =
  "https://www.dropbox.com/scl/fi/soy9tt49p0x7eyoohjjpm/Brock-s-bodycam.mp4?rlkey=v6prev2pzm0b8axpltjcxczms&e=3&st=lhmaq952&dl=0";

async function main() {
  console.log(process.env.GDRIVE_KEY, "!!!!");

  const browser = await chromium.launch();

  // Create context with HAR recording BEFORE creating page
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    recordHar: {
      content: "attach", //
      mode: "full",
      path: "output/recordings/brock-footage.har",
    },
  });

  const page = await context.newPage();

  const response$ = new ReplaySubject<APIResponse>();

  void page.route("**/p.m3u8**", async (route) => {
    const response = await route.fetch();
    response$.next(response);
    void route.fulfill({ response });
  });

  await page.goto(BROCK_FOOTAGE_URL);

  const screenshot = await page.screenshot({ path: "screenshot.png" });

  const screenshotHash = crypto
    .createHash("sha256")
    .update(screenshot)
    .digest("hex");

  console.log("Screenshot Hash:", screenshotHash, "\n");

  // Wait for video element to exist
  console.log("Waiting for video element to exist\n");

  await page.waitForSelector("video", { timeout: 30000 });

  const m3u8$ = response$.pipe(
    filter(
      (res) =>
        (res.url().includes(".m3u8") ||
          res.url().includes("m3u8") ||
          (res.headers()["content-type"] || "").includes("mpegurl")) &&
        res.status() === 200,
    ),
    timeout({
      each: 10000,
      with: () => throwError(() => new Error("No .m3u8 response within 10s")),
    }),
    retry({
      count: 10,
      delay: (err: Error, retryCount: number) => {
        console.warn(
          `Retry #${String(retryCount)}: ${err.message}. Waiting 3s...`,
        );
        return timer(3000);
      },
    }),
    take(5),
    toArray(),
  );

  const m3u8ResponseObjects = await lastValueFrom(m3u8$);

  const m3u8Responses: { text: string; url: string }[] = await Promise.all(
    m3u8ResponseObjects.map(async (res) => ({
      text: await res.text(),
      url: res.url(),
    })),
  );

  console.log("\n\n M3U8 responses received:"); // m3u8Responses

  // Usage: select by resolution or name
  const streams = parseVariantStreams(m3u8Responses[0].text);
  const hd1152_864 = streams.find((s) => s.resolution === "1152x864");

  console.log(
    "Video stream playlist: ",
    unescapeUrl(String(hd1152_864?.uri)),
    "\n",
  );

  // Usage
  const audioTracks = parseAudioTracks(m3u8Responses[0].text);

  // Select Track 2 from 128k
  const track2 = audioTracks.find(
    (t) => t.name === "Track 2" && t.bitrate === 128,
  );

  // Select Track 1 from 192k
  const track1_192k = audioTracks.find(
    (t) => t.name === "Track 1" && t.bitrate === 192,
  );

  console.log("Track 1 (192k):", unescapeUrl(String(track1_192k?.uri)), "\n");
  console.log("Track 2 audio:", unescapeUrl(String(track2?.uri)), "\n");

  console.log("Creating media artifacts...\n");

  await processMedia(
    unescapeUrl(String(hd1152_864?.uri)),
    unescapeUrl(String(track1_192k?.uri)),
    unescapeUrl(String(track2?.uri)),
  );

  console.log("Media Files Download Finished!\nHashing files...\n");

  const track1Hash = await getFileHash("audio_track1.m4a");
  const track2Hash = await getFileHash("audio_track2.m4a");
  const videoHash = await getFileHash("video_only.mp4");
  const harHash = await getFileHash("recordings/brock-footage.har");
  const ffmpegLogHash = await getFileHash("ffmpeg-log.txt");

  console.log("\nTrack 1 Hash:", track1Hash);
  console.log("\nTrack 2 Hash:", track2Hash);
  console.log("\nVideo Hash:", videoHash);

  const manifest = {
    capturedAt: new Date().toISOString(),
    ffmpeg_attachments_manifest: {},
    files: {
      "audio_track1.m4a": track1Hash,
      "audio_track2.m4a": track2Hash,
      "brock-footage.har": harHash,
      "ffmpeg-log.txt": ffmpegLogHash,
      "screenshot.png": screenshotHash,
      "video_only.mp4": videoHash,
    },
    har_attachments_manifest: {},
    sourceUrl: BROCK_FOOTAGE_URL,
  };

  const manifestString = JSON.stringify(manifest, null, 2);

  writeFileSync("./output/manifest.json", manifestString);

  const manifestHash = createHash("sha256")
    .update(manifestString) // hash the string you wrote
    .digest("hex");

  console.log("Manifest hash:", manifestHash);

  uploadToGCS().catch((err: unknown) => {
    console.error("Failed to upload to GCS:", err);
  });
  // MUST close context to flush HAR to disk
  await context.close();

  // do stuff
  await browser.close();
}

void main();
