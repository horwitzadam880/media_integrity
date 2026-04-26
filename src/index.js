import crypto from "crypto";
import { chromium } from "playwright";
import {
  Observable,
  forkJoin,
  defer,
  timer,
  from,
  fromEvent,
  lastValueFrom,
  throwError,
  ReplaySubject,
} from "rxjs";
import {
  filter,
  take,
  map,
  retry,
  delayWhen,
  tap,
  toArray,
  timeout,
} from "rxjs/operators";

const BROCK_FOOTAGE_URL =
  "https://www.dropbox.com/scl/fi/soy9tt49p0x7eyoohjjpm/Brock-s-bodycam.mp4?rlkey=v6prev2pzm0b8axpltjcxczms&e=3&st=lhmaq952&dl=0";

async function main() {
  const browser = await chromium.launch();

  // Create context with HAR recording BEFORE creating page
  const context = await browser.newContext({
    recordHar: {
      path: "brock-footage.har",
      mode: "full",
      content: "attach", //
      serviceWorkers: "block",
    },
  });

  const page = await context.newPage();

  // const promises = Array.from(
  //     { length: 5 },
  //     () => page.waitForResponse(res => res.url().endsWith('.m3u8') && res.status() === 200, { timeout: 10000 })
  // )

  const response$ = new ReplaySubject();

  page.route("**/p.m3u8**", async (route) => {
    const response = await route.fetch();
    response$.next(response);
    await route.fulfill({ response });
  });

  await page.goto(BROCK_FOOTAGE_URL);

  // const m3u8Promise = await Promise.all(promises);

  const screenshot = await page.screenshot({ path: "screenshot.png" });

  const screenshotHash = crypto
    .createHash("sha256")
    .update(screenshot)
    .digest("hex");

  console.log("Screenshot Hash:", screenshotHash);

  // page.on('response', res => console.log(res.url()));

  // Wait for video element to exist
  console.log("waiting for video element to exist");
  await page.waitForSelector("video", { timeout: 30000 });

  console.log("clicking play button");
  // Click play button
  //   await page.click('video', { timeout: 5000 });

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
      delay: (err, retryCount) => {
        console.warn(`Retry #${retryCount}: ${err.message}. Waiting 3s...`);
        return timer(3000);
      },
    }),
    take(5),
    toArray(),
  );

  const m3u8Responses = await lastValueFrom(m3u8$);

  console.log("\n\n3U8 responses received:", m3u8Responses);

  // let m3u8Response;

  // //  Wait until we actually see an M3U8 response - not a blind timeout
  // try {
  //     m3u8Response = await m3u8Promise;
  // } catch (e) {
  //     await context.close();
  //     await browser.close();

  //     return console.log("No M3U8 response received within timeout, exiting.");
  // }

  // console.log("M3U8 responses received!");

  // m3u8Promise.forEach((response, index) => {
  //     console.log(`M3U8 Response ${index + 1}: URL: ${response.url()} Text: ${response.text()}`);
  // });

  // const m38u8Content = await m3u8Response.text();

  // console.log('M3U8 text: ', m38u8Content);

  // MUST close context to flush HAR to disk
  await context.close();

  // do stuff
  await browser.close();
}

main();
