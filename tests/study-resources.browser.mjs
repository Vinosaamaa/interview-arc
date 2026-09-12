import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { resourceHtml, resourcePdf, resourceText } from './fixtures/study-resource-content.mjs';

const base = process.env.ARC_TEST_BASE ?? 'http://127.0.0.1:3016';
await mkdir('.cache/resources', { recursive: true });
const context = await chromium.launchPersistentContext(join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'JobApplyChrome'), { executablePath: process.env.ARC_BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', headless: true, viewport: { width: 1365, height: 1000 }, args: ['--remote-debugging-port=9224'] });
try {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/resources');
  await page.getByRole('heading', { name: 'Keep the whole source.' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  const suffix = Date.now(), htmlName = `Synthetic source ${suffix}.html`, pdfName = `Synthetic diagrams ${suffix}.pdf`, mdName = `Synthetic full notes ${suffix}.md`;
  await page.locator('input[type=file]').setInputFiles([{ name: htmlName, mimeType: 'text/html', buffer: Buffer.from(resourceHtml) }, { name: mdName, mimeType: 'text/markdown', buffer: Buffer.from(resourceText) }, { name: pdfName, mimeType: 'application/pdf', buffer: resourcePdf() }]);
  await page.waitForFunction(() => document.querySelectorAll('.resource-jobs li').length === 3 && [...document.querySelectorAll('.resource-jobs [role=status]')].every(e => e.textContent === 'Saved'), undefined, { timeout: 90000 });
  await page.getByRole('button', { name: new RegExp('^' + htmlName.replaceAll('.', '\\.')) }).click();
  await page.getByText('Collapsed but preserved.', { exact: false }).waitFor();
  assert.equal(await page.locator('.resource-text').textContent().then(s => s.includes('NEVER_EXECUTE')), false);
  const originalHref = await page.getByRole('link', { name: 'Download original' }).getAttribute('href');
  assert.equal(await (await context.request.get(base + originalHref)).text(), resourceHtml);
  await page.getByRole('button', { name: new RegExp('^' + mdName.replaceAll('.', '\\.')) }).click();
  await page.getByRole('heading', { name: mdName, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).waitFor();
  let recovered = '';
  while (true) {
    recovered += await page.locator('.resource-text').textContent();
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.isDisabled()) break;
    const prior = await page.locator('.resource-paging span').textContent(); await next.click();
    await page.waitForFunction(text => document.querySelector('.resource-paging span').textContent !== text, prior);
  }
  assert.equal(recovered, resourceText);
  await page.getByRole('button', { name: new RegExp('^' + pdfName.replaceAll('.', '\\.') + '\\s+\\d') }).click();
  await page.getByRole('button', { name: 'Page 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await page.locator('article img').waitFor();
  await page.waitForFunction(() => document.querySelector('article img')?.naturalWidth > 100);
  await page.screenshot({ path: '.cache/resources/library-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.cache/resources/library-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Use in ChatGPT' }).click();
  assert.match(await page.locator('textarea').inputValue(), /get_study_resource/);
  // A slow earlier search must not replace a newer result or append an old page.
  const fixture = (await (await context.request.get(base + '/api/study-resources')).json()).resources[0];
  let releaseSlow, markSlowStarted;
  const slowStarted = new Promise(resolve => { markSlowStarted = resolve; });
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });
  await page.route('**/api/study-resources?offset=0&query=race-*', async route => {
    const slow = route.request().url().endsWith('race-slow');
    if (slow) { markSlowStarted(); await slowGate; }
    await route.fulfill({ json: { resources: [{ ...fixture, title: slow ? 'Stale search result' : 'Current search result' }], nextOffset: null } });
  });
  await page.getByLabel('Find in your library').fill('race-slow');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await slowStarted;
  await page.getByLabel('Find in your library').fill('race-fast');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: /^Current search result/ }).waitFor();
  const slowFinished = page.waitForResponse(response => response.url().endsWith('query=race-slow'));
  releaseSlow();
  await (await slowFinished).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.resource-list strong').allTextContents().then(t => t.join()), 'Current search result');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ originalDownload: 'byte exact', fullMarkdown: 'all fragments exact', htmlCollapsedContent: 'preserved', pdfTextAndPageImage: 'pass', chatRequest: 'pass', searchRace: 'newest result retained', desktop: 'pass', mobile390: 'pass', actualChatgptHost: 'not exercised' }));
} catch (error) { const page = context.pages().at(-1); console.error((await page?.locator('main').innerText())?.slice(0,3000)); await page?.screenshot({path:'.cache/resources/browser-failure.png',fullPage:true}); throw error; } finally { await context.close(); }
