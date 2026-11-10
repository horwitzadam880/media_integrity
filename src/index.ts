import crypto from "crypto";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as http from "node:http";
import path from "node:path";
import { type APIResponse, chromium, devices } from "playwright";
import { lastValueFrom, ReplaySubject, throwError } from "rxjs";
import { filter, take, timeout, toArray } from "rxjs/operators";
import { fileURLToPath } from "url";

import {
  compressChromeContext,
  copySSLKeylogFile,
  createOutputFolders,
  getDropboxMetadata,
  getExternalIPAddress,
  getFileHash,
  hashDirectory,
  parseAudioTracks,
  parseVariantStreams,
  processMedia,
  randomPause,
  startTCPDump,
  unescapeUrl,
  uploadToGCS,
} from "./helper/helper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BROCK_FOOTAGE_URL = // actual
  "https://www.dropbox.com/scl/fo/6ocr0u3dycntll5x48l7r/AIAaU5i5mz1h6r9SUyYy-qc?rlkey=esjo4eve600tspyws41yrsloo&st=8z7bcsr9&dl=0";

console.log("BROCK_FOOTAGE_URL: ", BROCK_FOOTAGE_URL);

//@eslint-disable-next-line

const rawLinkPassword = process.env.DROPBOX_LINK_PASSWORD ?? "";

const linkPasswordHash = crypto
  .createHash("sha256")
  .update(rawLinkPassword)
  .digest("hex");

process.env.SSLKEYLOGFILE = "/forensic_scraper/output/ssl_keys.log";

async function main() {
  await createOutputFolders();

  const rootOutputDir = path.join(process.cwd(), "output");

  const { kill: stopTCPDump } = startTCPDump(rootOutputDir);

  const browser = await chromium.launch();

  const userDataDir = path.resolve(
    __dirname,
    "../output/chrome-persistent-context",
  );

  // Create context with HAR recording BEFORE creating page
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...devices["Desktop Chrome"],
    args: [
      "--headless=new", // Mandatory for extension support in headless mode
    ],
    channel: "chromium",
    headless: true, // Use '--headless=new' via args for extensions
    recordHar: {
      content: "attach",
      path: path.join(rootOutputDir, "recordings", "brock-footage.har"),
    },
  });

  await context.route("**/*", (route) => {
    const url = route.request().url();

    //  Dropbox block list (blocked by uBlock Origin)
    const shouldBlock =
      url.includes("marketing.dropbox.com") ||
      url.includes("/log/") ||
      url.includes("/log_") ||
      url.includes("/alternate_wtl") ||
      url.includes("/2/udcl/") ||
      url.includes("/2/client_metrics/") ||
      url.includes("/pro_events");

    if (shouldBlock) {
      return route.abort();
    }

    // Otherwise, let the request through
    return route.continue();
  });

  const page = await context.newPage();

  const resBodies: { originalBodyText: string; url: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const proxyServer = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      return res.end();
    }

    try {
      // 1. Pass the absolute string directly into Node's native URL parser
      const urlObj = new URL(req.url);

      // 2. Change the protocol back to secure HTTPS for Playwright
      if (urlObj.protocol === "http:") {
        urlObj.protocol = "https:";
      }

      // 3. THE PROTOCOL PORT FIX:
      // If FFmpeg baked port 80 into the address, clear it out.
      // This forces Playwright to default to safe TLS channels (Port 443).
      if (urlObj.port === "80") {
        urlObj.port = "";
      }

      const secureTargetUrl = urlObj.toString();

      const playwrightResponse = await context.request.fetch(secureTargetUrl, {
        method: "GET",
      });

      const contentType = (
        playwrightResponse.headers()["content-type"] || ""
      ).toLowerCase();

      let bodyBuffer = await playwrightResponse.body();

      // 4. THE CRITICAL FIX: Bulk scan and strip ALL secure protocol strings
      // out of the streaming text contents (.m3u8 index files, sub-playlists, etc.)
      if (
        secureTargetUrl.includes(".m3u8") ||
        secureTargetUrl.includes("m3u8") ||
        contentType.includes("mpegurl") ||
        contentType.includes("text/") ||
        contentType.includes("application/x-mpegurl")
      ) {
        let textData = bodyBuffer.toString("utf-8");

        if (textData.includes("https://")) {
          resBodies.push({
            originalBodyText: textData,
            url: secureTargetUrl,
          });

          // Force every hidden asset link inside the playlist text to use plain HTTP.
          textData = textData.replace(/https:\/\//g, "http://");
        }

        bodyBuffer = Buffer.from(textData, "utf-8");
      }

      // 5. Send payload back down to FFmpeg's buffer
      res.writeHead(playwrightResponse.status(), playwrightResponse.headers());
      res.end(bodyBuffer);
    } catch (err) {
      console.log(err);

      console.error("Internal HAR Injection Proxy Routing Error:", err);
      res.writeHead(502);
      res.end();
    }
  });

  // Assign an ephemeral localhost port for the proxy loopback tunnel
  const PROXY_PORT = 9898;

  await new Promise<void>((resolve) =>
    proxyServer.listen(PROXY_PORT, "127.0.0.1", resolve),
  );

  console.log(
    `HAR Integration proxy server tracking on loopback port: ${String(PROXY_PORT)}`,
  );

  const response$ = new ReplaySubject<APIResponse>();

  void page.route("**/p.m3u8**", async (route) => {
    const response = await route.fetch();
    response$.next(response);
    void route.fulfill({ response });
  });

  const externalIPAddress = await getExternalIPAddress();

  await page.goto(BROCK_FOOTAGE_URL, { timeout: 6000000 });

  const screenshot1 = await page.screenshot({
    path: path.join(rootOutputDir, "screenshot1.png"),
  });

  const screenshot1Hash = crypto
    .createHash("sha256")
    .update(screenshot1)
    .digest("hex");

  console.log("Screenshot1 Hash:", screenshot1Hash, "\n");

  //Login now

  const passwordInput = page.locator("#shared-link-password");
  const submitButton = page.getByTestId("shared-link-password-button");

  await passwordInput.waitFor({ state: "visible" });

  await page.waitForTimeout(randomPause(1, 3));

  await passwordInput.click();

  await page.waitForTimeout(randomPause(2, 5));

  await passwordInput.fill(rawLinkPassword);

  await page.waitForTimeout(randomPause(1, 2));

  await submitButton.click();

  const gridLink = page.getByTestId("grid-link");
  await gridLink.waitFor({ state: "visible", timeout: 15000 });

  const screenshot2 = await page.screenshot({
    path: path.join(rootOutputDir, "screenshot2.png"),
  });

  const screenshot2Hash = crypto
    .createHash("sha256")
    .update(screenshot2)
    .digest("hex");

  console.log("Screenshot2 Hash:", screenshot2Hash, "\n");

  const declineCookiesBtn = page.locator("#decline_cookies_button");

  await declineCookiesBtn
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {
      console.log("Cookie banner did not appear, moving on.");
    });

  await page.waitForTimeout(randomPause(1, 3));

  await declineCookiesBtn.click();

  await page.waitForTimeout(randomPause(1, 4));

  await gridLink.click();

  // Wait for video element to exist
  console.log("Waiting for video element to exist\n");

  await page.waitForSelector("video", { timeout: 30000 });

  const screenshot3 = await page.screenshot({
    path: path.join(rootOutputDir, "screenshot3.png"),
  });

  const screenshot3Hash = crypto
    .createHash("sha256")
    .update(screenshot3)
    .digest("hex");

  console.log("Screenshot3 Hash:", screenshot3Hash, "\n");

  const m3u8$ = response$.pipe(
    filter(
      (res) =>
        (res.url().includes(".m3u8") ||
          res.url().includes("m3u8") ||
          (res.headers()["content-type"] || "").includes("/")) &&
        res.status() === 200,
    ),
    timeout({
      each: 10000,
      with: () => throwError(() => new Error("No .m3u8 response within 10s")),
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

  console.log("M3U8 responses received"); // m3u8Responses

  // Usage: select by resolution or name
  const streams = parseVariantStreams(m3u8Responses[0].text);

  const hd1152_864 = streams.find((s) => s.resolution === "1152x864"); // 1152x864 (actual) -- 720x576 (test)

  console.log(
    "Video stream playlist: ",
    unescapeUrl(String(hd1152_864?.uri)),
    "\n",
  );

  // Usage
  const audioTracks = parseAudioTracks(m3u8Responses[0].text);

  // Select Track 2 from 128k
  const track2 = audioTracks.find(
    (t) => t.name === "Track 2" && t.bitrate === 128, // 2 (actual) -- 1 (test)
  );

  // Select Track 1 from 192k
  const track1_192k = audioTracks.find(
    (t) => t.name === "Track 1" && t.bitrate === 192,
  );

  console.log("Track 1 (192k):", unescapeUrl(String(track1_192k?.uri)), "\n");
  console.log("Track 2 audio:", unescapeUrl(String(track2?.uri)), "\n");

  console.log("Creating media artifacts...\n");

  const remappedURIs = {
    hd1152_864: unescapeUrl(String(hd1152_864?.uri)).replace(
      /^https:/i,
      "http:",
    ),
    track1_192k: unescapeUrl(String(track1_192k?.uri)).replace(
      /^https:/i,
      "http:",
    ),
    track2: unescapeUrl(String(track2?.uri)).replace(/^https:/i, "http:"),
  };

  await processMedia(
    remappedURIs.hd1152_864,
    remappedURIs.track1_192k,
    remappedURIs.track2,
    rootOutputDir,
  );

  console.log("Media Files Download Finished!");

  // MUST close context to flush HAR to disk
  await context.close();

  await browser.close();

  await stopTCPDump();

  await compressChromeContext();

  console.log("Hashing files...");

  const track1Hash = await getFileHash(
    path.join(rootOutputDir, "media", "audio_track1.m4a"),
  );

  const track2Hash = await getFileHash(
    path.join(rootOutputDir, "media", "audio_track2.m4a"),
  );

  const videoHash = await getFileHash(
    path.join(rootOutputDir, "media", "video_only.mp4"),
  );

  const finalVideoCombinedHash = await getFileHash(
    path.join(rootOutputDir, "media", "final_combined.mp4"),
  );

  const ffmpegLogHash = await getFileHash(
    path.join(rootOutputDir, "ffmpeg-log.txt"),
  );

  console.log("\nTrack 1 Hash:", track1Hash);
  console.log("\nTrack 2 Hash:", track2Hash);
  console.log("\nVideo Hash:", videoHash);

  const networkCaptureHash = await getFileHash(
    path.join(rootOutputDir, "network_capture.pcap"),
  );

  const tcpdump_consoleLogHash = await getFileHash(
    path.join(rootOutputDir, "tcpdump_console.log"),
  );

  const sslKeysLogHash = await getFileHash(
    path.join(rootOutputDir, "ssl_keys.log"),
  );

  await copySSLKeylogFile();

  const chromeContextHash = await getFileHash(
    path.join(rootOutputDir, "chrome-persistent-context.tar.gz"),
  );

  const harHash = await getFileHash(
    path.join(rootOutputDir, "recordings", "brock-footage.har"),
  );

  // Build HAR attachments manifest
  const harAttachmentsHashes = await hashDirectory(
    path.join(rootOutputDir, "recordings"),
  );

  writeFileSync(
    path.join(rootOutputDir, "brock-har-attachments-manifest.json"),
    JSON.stringify(
      {
        files: harAttachmentsHashes,
        name: "brock-har-attachments-manifest.json",
      },
      null,
      2,
    ),
  );

  const harAttachmentsManifestHash = await getFileHash(
    path.join(rootOutputDir, "brock-har-attachments-manifest.json"),
  );

  console.log("HAR attachments Manifest: ", harAttachmentsManifestHash);

  //Build ffmpeg mapped response bodies
  writeFileSync(
    path.join(rootOutputDir, "ffmpeg-mapped-response-bodies.json"),
    JSON.stringify(resBodies, null, 2),
  );

  const ffmpegMappedResBodiesHash = await getFileHash(
    path.join(rootOutputDir, "ffmpeg-mapped-response-bodies.json"),
  );

  const dropboxMetadata = await getDropboxMetadata(
    BROCK_FOOTAGE_URL,
    process.env.DROPBOX_KEY ?? "",
  );

  writeFileSync(
    path.join(rootOutputDir, "dropbox-metadata.json"),
    JSON.stringify(dropboxMetadata, null, 2),
  );

  const dropboxMetadataHash = await getFileHash(
    path.join(rootOutputDir, "dropbox-metadata.json"),
  );

  // Create main hash manifest
  const manifest = {
    capturedAt: new Date().toISOString(),
    files: {
      "audio_track1.m4a": track1Hash,
      "audio_track2.m4a": track2Hash,
      "brock-footage.har": harHash,
      "brock-har-attachments-manifest.json": harAttachmentsManifestHash,
      "chrome-persistent-context.tar.gz": chromeContextHash,
      "dropbox-metadata.json": dropboxMetadataHash,
      "ffmpeg-log.txt": ffmpegLogHash,
      "ffmpeg-mapped-response-bodies.json": ffmpegMappedResBodiesHash,
      "final_combined.mp4": finalVideoCombinedHash,
      "network_capture.pcap": networkCaptureHash,
      "screenshot1.png": screenshot1Hash,
      "screenshot2.png": screenshot2Hash,
      "screenshot3.png": screenshot3Hash,
      "ssl_keys.log.bak": sslKeysLogHash,
      "tcpdump_console.log": tcpdump_consoleLogHash,
      "video_only.mp4": videoHash,
    },
    hashedLinkPassword: linkPasswordHash,
    ipAddress: externalIPAddress,
    sourceUrl: BROCK_FOOTAGE_URL,
  };

  const manifestString = JSON.stringify(manifest, null, 2);

  writeFileSync(path.join(rootOutputDir, "manifest.json"), manifestString);

  const manifestHash = createHash("sha256")
    .update(manifestString) // hash the string you wrote
    .digest("hex");

  await uploadToGCS().catch((err: unknown) => {
    console.error("Failed to upload to GCS:", err);
  });

  console.log("Root hash manifest: ", manifestString);

  console.log("Manifest hash: ", manifestHash);

  console.log("All tasks completed successfully.\n");

  process.exit(0); // Forces the event loop to instantly terminate
}

void main();
