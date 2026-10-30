import { test, expect } from "@playwright/test";

test("static calculator computes all six structures without external APIs", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.goto("/?lang=en");
  await page.waitForFunction(() => !!(window as any).sundenCalculator);
  await expect(page.getByRole("heading", { name: "ShinePCB Board Impedance Calculator", exact: true })).toBeVisible();
  for (const design of ["M", "S", "GC", "ME", "SE", "SB"]) {
    await page.evaluate(code => {
      const calc = (window as any).sundenCalculator;
      calc.apply({ ...calc.read(), design: code, gapMm: 0.18 });
    }, design);
    await expect(page.locator("#output .out-row").first()).toBeVisible();
    expect(await page.locator("#output").innerText()).toMatch(/\d[\d.]* Ω/);
    expect(await page.locator("#output").innerText()).not.toMatch(/NaN|undefined/);
  }
  expect(await page.locator(".brand-logo img").evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1023);
  await page.locator("#menuBtn").click();
  expect(await page.locator("#menuList").innerText()).not.toMatch(/assistant|助手/i);
  expect(requests.every(url => url.startsWith("http://127.0.0.1:18771/"))).toBe(true);
  expect(requests.filter(url => /\/api\/|\/agents\/|\/assistant\//.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test("language switching preserves design, units and computed results", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).sundenCalculator);
  await page.evaluate(() => {
    const calc = (window as any).sundenCalculator;
    calc.apply({ ...calc.read(), design: "ME", material: "CFG294G2", gapMm: .18, widthMm: .4321, lengthMm: 71.2, frequencyGHz: 17 });
  });
  await page.getByRole("button", { name: "英制", exact: true }).click();
  await page.locator('#sideNav [data-area="circuitParameters"]').click();
  await page.locator('#sideNav [data-calc]').click();
  const before = await page.evaluate(() => (window as any).sundenCalculator.read());
  const impedance = await page.locator("#output .out-row").filter({ hasText: "差分阻抗 Zdiff" }).locator("span").last().innerText();
  await page.locator("#languageBtn").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.waitForFunction(() => !!(window as any).sundenCalculator);
  const after = await page.evaluate(() => (window as any).sundenCalculator.read());
  delete before.copper.label; delete after.copper.label;
  expect(after).toEqual(before);
  await expect(page.locator("#unitSwitch")).not.toBeChecked();
  await expect(page.locator("#areaName")).toHaveText("Circuit parameters");
  await expect(page.locator("#output .out-row").filter({ hasText: "Differential impedance Zdiff" }).locator("span").last()).toHaveText(impedance);
  expect((await page.locator("body").innerText()).replaceAll("中文", "")).not.toMatch(/[\u3400-\u9fff]/);
  const download = page.waitForEvent("download");
  await page.locator("#csvBtn").click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test("mobile dark calculator fits; former backend and private files are unavailable", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=en");
  await page.waitForFunction(() => !!(window as any).sundenCalculator);
  await page.locator("#navToggle").click();
  await page.locator("#menuBtn").click();
  await page.locator("#themeBtn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const path of ["/assistant", "/api/assistant/session", "/.git/config", "/.env", "/data/sunden-materials.sqlite"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  expect((await request.get("/kicad-transline.wasm")).headers()["content-type"]).toBe("application/wasm");
});
