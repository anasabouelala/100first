import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

(async () => {
    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    console.log("Navigating to https://www.producthunt.com/forums?order=new...");
    await page.goto('https://www.producthunt.com/forums?order=new', { waitUntil: 'networkidle2' });

    // Wait to pass CF
    await new Promise(r => setTimeout(r, 5000));

    console.log("Bypassed Cloudflare. Collecting discussion links from 10 pages (~260 links)...");

    // Scroll down until we have 260 links
    const linksToScrape = await page.evaluate(async () => {
        let collectedLinks = new Set();

        for (let i = 0; i < 40; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 1000));

            const loadMore = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('load more'));
            if (loadMore) {
                loadMore.click();
                await new Promise(r => setTimeout(r, 1500));
            }

            // Grab all new discussion links
            const anchors = Array.from(document.querySelectorAll('a[href^="/p/"]'));
            anchors.forEach(a => {
                // Discard single-segment /p/category links. Real posts have 3 parts: /p/category/slug
                const parts = new URL(a.href).pathname.split('/');
                if (parts.length >= 4) {
                    collectedLinks.add(a.href);
                }
            });

            if (collectedLinks.size >= 260) break;
        }
        return Array.from(collectedLinks).slice(0, 260); // Ensure exactly up to 260
    });

    console.log(`Successfully extracted ${linksToScrape.length} unique discussion URLs. Starting deeper comment extraction...`);

    // We will run the fetching inside the browser page to piggyback on the active Cloudflare token!
    const results = await page.evaluate(async (urls) => {

        // Batch size of 10 to speed up
        const BATCH_SIZE = 10;
        let allData = [];

        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            const batch = urls.slice(i, i + BATCH_SIZE);

            const batchResults = await Promise.all(batch.map(async (url) => {
                try {
                    const response = await fetch(url);
                    if (!response.ok) return { url, error: response.status };

                    const html = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    // Extract Title
                    const titleEl = doc.querySelector('h1');
                    const title = titleEl ? titleEl.innerText : 'Unknown Title';

                    // Extract Author
                    const authorEl = Array.from(doc.querySelectorAll('a[href^="/@"]'))[0];
                    let author = authorEl ? authorEl.innerText.trim() : 'Unknown Author';

                    // Extract Date
                    const timeEl = doc.querySelector('time');
                    const date = timeEl ? timeEl.innerText || timeEl.getAttribute('datetime') : 'Recent';

                    // Extract comments count
                    let commentsCount = 0;
                    const matchCount = html.match(/(\\d+)\\s*(comments|replies)/i);
                    if (matchCount) commentsCount = parseInt(matchCount[1]);

                    // Extract comments
                    let comments = [];
                    const commentAuthors = Array.from(doc.querySelectorAll('a[href^="/@"]'));
                    const seenTexts = new Set();

                    // Usually the first /@ link is the author. Comments map to subsequent links.
                    for (let c = 1; c < Math.min(commentAuthors.length, 30); c++) {
                        const cAuthor = commentAuthors[c];
                        let cText = "";
                        try {
                            let container = cAuthor.closest('div');
                            if (container && container.parentElement) {
                                cText = container.parentElement.innerText.replace(cAuthor.innerText, '').substring(0, 300).trim();
                            }
                        } catch (e) { }

                        if (cText && cAuthor.innerText) {
                            const cleanText = cText.split('\\n').filter(l => l.length > 10)[0] || cText.split('\\n')[0];
                            if (!seenTexts.has(cleanText)) {
                                seenTexts.add(cleanText);
                                comments.push({ author: cAuthor.innerText.trim(), text: cleanText });
                            }
                        }
                    }

                    return {
                        title,
                        url,
                        author,
                        date,
                        commentsCount: commentsCount || comments.length,
                        comments
                    };
                } catch (err) {
                    return { url, error: err.toString() };
                }
            }));

            allData.push(...batchResults);
        }
        return allData;
    }, linksToScrape);

    console.log(`Completed fetching data for ${results.length} discussions.`);

    // Clean structured data
    const cleanResults = results.filter(r => !r.error && r.title !== 'Unknown Title');

    fs.writeFileSync('ph_discussions_dataset.json', JSON.stringify(cleanResults, null, 2));
    console.log("Saved the full dataset to: ph_discussions_dataset.json");

    await browser.close();
})();
