import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const BASE = "http://localhost:5174";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "networkidle0" });
});

afterEach(async () => {
  await page.close();
});

/** Find the first button whose text includes `text`. */
async function findButton(text: string): Promise<ElementHandle<HTMLButtonElement> | null> {
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const label = await btn.evaluate((el) => el.textContent ?? "");
    if (label.includes(text)) return btn as ElementHandle<HTMLButtonElement>;
  }
  return null;
}

describe("App shell", () => {
  it("renders the SPARQL Studio title", async () => {
    const text = await page.$eval("main", (el) => el.textContent ?? "");
    expect(text).toContain("SPARQL Studio");
  });

  it("shows the Run query button", async () => {
    const btn = await findButton("Run query");
    expect(btn).not.toBeNull();
  });

  it("shows the status bar with Ready.", async () => {
    const text = await page.$eval("[role=status]", (el) => el.textContent ?? "");
    expect(text).toContain("Ready.");
  });
});

describe("Settings modal", () => {
  it("opens when clicking Settings", async () => {
    const btn = await findButton("Settings");
    await btn!.click();
    await page.waitForSelector("[role=dialog]");
    expect(await page.$("[role=dialog]")).not.toBeNull();
  });

  it("closes on Escape key", async () => {
    const btn = await findButton("Settings");
    await btn!.click();
    await page.waitForSelector("[role=dialog]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
    expect(await page.$("[role=dialog]")).toBeNull();
  });
});

describe("Sidebar", () => {
  it("hides the sidebar when clicking the toggle button", async () => {
    const hideBtn = await page.$("button[title='Hide panel']");
    await hideBtn!.click();
    await page.waitForSelector("button[title='Show panel']");
    expect(await page.$("button[title='Show panel']")).not.toBeNull();
  });
});

describe("Navigation", () => {
  it("navigates to the Graphs page", async () => {
    const btn = await findButton("Graphs");
    await btn!.click();
    await page.waitForFunction(() => window.location.hash.includes("graphs"));
    expect(page.url()).toContain("graphs");
  });

  it("navigates back from the Graphs page", async () => {
    await page.goto(`${BASE}/#/graphs`, { waitUntil: "networkidle0" });
    await page.goto(BASE, { waitUntil: "networkidle0" });
    const btn = await findButton("Run query");
    expect(btn).not.toBeNull();
  });
});

describe("Query execution", () => {
  it("clicking Run query changes the status bar away from Ready.", async () => {
    await page.waitForSelector(".editorHost");
    const runBtn = await findButton("Run query");
    await runBtn!.click();
    await page.waitForFunction(
      () => {
        const status = document.querySelector("[role=status]");
        return status !== null && !status.textContent?.includes("Ready.");
      },
      { timeout: 20000 }
    );
    const status = await page.$eval("[role=status]", (el) => el.textContent ?? "");
    expect(status).not.toContain("Ready.");
  });
});
