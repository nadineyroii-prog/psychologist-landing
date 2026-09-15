import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if(msg.type() === 'error') errors.push(msg.text()); });
page.on('request', request => { if(!request.url().startsWith('http://127.0.0.1:4321') && !request.url().startsWith('data:')) external.push(request.url()); });
await mkdir('.qa', { recursive: true });
const reports = [];
for (const width of [375, 768, 1024, 1440]) {
  await page.setViewportSize({width, height: width === 375 ? 812 : 1000});
  await page.goto('http://127.0.0.1:4321/', {waitUntil:'networkidle'});
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.about-portrait').scrollIntoViewIfNeeded();
  await page.locator('.about-portrait img').evaluate(image => image.decode());
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
  const report = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    h1: document.querySelectorAll('h1').length,
    sections: document.querySelectorAll('main section').length,
    images: [...document.images].map(i => ({src:i.getAttribute('src'), loaded:i.complete && i.naturalWidth > 0, alt:!!i.alt})),
    brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(h=>h !== '#' && !document.getElementById(h.slice(1))),
    fonts:document.fonts.check('18px "Golos Text"') && document.fonts.check('44px "PT Serif"'),
  }));
  reports.push(report);
  await page.screenshot({path:`.qa/page-${width}.png`,fullPage:true});
  await page.evaluate(() => window.scrollTo({top:0,left:0,behavior:'instant'}));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({path:`.qa/hero-${width}.png`});
  if(width === 375) {
    await page.locator('.mobile-menu summary').click();
    await page.locator('.mobile-menu a[href="#meeting"]').click();
    if(await page.locator('.mobile-menu').getAttribute('open') !== null) throw Error('Mobile menu remains open');
  }
}
await page.locator('.faq summary').first().click();
if(await page.locator('.faq details').first().getAttribute('open') === null) throw Error('FAQ does not open');
await page.locator('#open-booking').click();
if(!await page.locator('#booking-dialog').isVisible()) throw Error('Dialog does not open');
await page.getByLabel('Вечер', {exact:false}).check();
await page.locator('#demo-form button').click();
if(!await page.locator('#demo-result').isVisible()) throw Error('Demo completion missing');
await page.keyboard.press('Escape');
if(await page.locator('#booking-dialog').isVisible()) throw Error('Escape does not close dialog');
if(!await page.locator('#open-booking').evaluate(el=>el===document.activeElement)) throw Error('Focus not returned');
await page.locator('#open-booking').click();
if(!await page.locator('#demo-form').isVisible()) throw Error('Demo form does not reset');
await page.locator('.dialog-close').click();
const result = {reports,errors,external, interactionChecks:'FAQ, mobile navigation, demo selection/completion/reset, Escape and focus restoration passed'};
await writeFile('.qa/report.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();
if(errors.length || external.length || reports.some(r=>r.overflow || r.h1!==1 || r.sections!==8 || r.brokenAnchors.length || !r.fonts || r.images.some(i=>!i.loaded||!i.alt))) process.exitCode=1;
