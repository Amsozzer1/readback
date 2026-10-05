// Captures the compare view at its four frames.
//   tsx scripts/capture.ts --png   1280x800 screenshots in test-results/frames/ (layout check)
//   pnpm gif                       docs/demo.gif at 960x600
// Needs a production build (`pnpm build`). Playwright's browser lives in node_modules
// (PLAYWRIGHT_BROWSERS_PATH=0), installed with `pnpm exec playwright install chromium`.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { png: { type: "boolean", default: false }, gif: { type: "boolean", default: false } } });
const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const PORT = 3311;

if (!existsSync(root(".next/BUILD_ID"))) {
  console.error("No production build found. Run `pnpm build` first.");
  process.exit(1);
}

// Refuse to run against something already on the port: it could be a stale build.
const already = await fetch(`http://localhost:${PORT}/`).then(() => true, () => false);
if (already) {
  console.error(`Port ${PORT} is already in use; stop that server first so the capture uses this build.`);
  process.exit(1);
}

// Start next directly, in its own process group, so stopping it can't leave a server behind.
const server = spawn(root("node_modules/.bin/next"), ["start", "-p", String(PORT)], {
  cwd: root("."),
  stdio: "ignore",
  detached: true,
});
const stop = () => {
  try {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
};
process.on("exit", stop);

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/compare`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("next start didn't come up");
}

const { chromium } = await import("@playwright/test");
await waitForServer();
const browser = await chromium.launch();

try {
  if (values.png || !values.gif) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${PORT}/compare`);
    await mkdir(root("test-results/frames"), { recursive: true });
    const buttons = page.locator(".frames button");
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click();
      await page.screenshot({ path: root(`test-results/frames/frame-${i + 1}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      console.log(`frame ${i + 1}: saved; ${overflow > 0 ? `${overflow}px below the fold` : "fits without scrolling"}`);
    }
  }

  if (values.gif) {
    const { encodeGif } = await import("./gif-encode");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.75 });
    await page.goto(`http://localhost:${PORT}/compare`);
    const frames: { png: Buffer; delayMs: number }[] = [];
    const shot = async (delayMs: number) => frames.push({ png: await page.screenshot(), delayMs });
    const buttons = page.locator(".frames button");
    const slider = page.locator('input[type="range"]');
    const holds = [2600, 2600, 4200, 4800];
    for (let i = 0; i < (await buttons.count()); i++) {
      await buttons.nth(i).click();
      await shot(holds[i] ?? 2500);
      if (i < (await buttons.count()) - 1) {
        // Show the scrubber moving between frames: a few in-between steps.
        const from = Number(await slider.inputValue());
        await buttons.nth(i + 1).click();
        const to = Number(await slider.inputValue());
        for (const k of [1, 2, 3]) {
          const v = Math.round((from + ((to - from) * k) / 4) / 1000) * 1000;
          await slider.fill(String(v));
          await shot(250);
        }
      }
    }
    const gif = encodeGif(frames);
    await mkdir(root("docs"), { recursive: true });
    await writeFile(root("docs/demo.gif"), gif);
    console.log(`docs/demo.gif: ${frames.length} frames, ${(gif.length / 1024 / 1024).toFixed(2)} MB`);
  }
} finally {
  await browser.close();
  stop();
}
