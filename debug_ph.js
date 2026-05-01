import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.goto('https://www.producthunt.com/forums?order=new', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 5000));

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 2000));

    const allHrefs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => a.href);
    });

    // Find common patterns indicating a discussion thread
    const possibleDiscussions = allHrefs.filter(h => h && h.includes('producthunt.com/'));

    fs.writeFileSync('ph_links_debug.json', JSON.stringify(possibleDiscussions, null, 2));
    await page.screenshot({ path: 'ph_screen.png' });

    await browser.close();
})();
