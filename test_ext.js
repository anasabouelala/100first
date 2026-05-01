import puppeteer from 'puppeteer';
import path from 'path';

(async () => {
    const extensionPath = path.resolve('c:/Users/hp/Downloads/100first/answerly-extension');
    console.log("Loading extension from:", extensionPath);
    
    try {
        const browser = await puppeteer.launch({
            headless: "new", 
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`
            ]
        });

        // Wait for service worker to register
        console.log("Waiting for service worker target...");
        const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' || t.type() === 'background_page', { timeout: 10000 });
        
        console.log("Background target found:", swTarget.url());
        const worker = await swTarget.worker();
        if (worker) {
            worker.on('console', msg => console.log('SW LOG:', msg.text()));
            worker.on('error', err => console.error('SW ERR:', err));
        }

        const page = await browser.newPage();
        
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        
        console.log("Navigating to localhost:3001...");
        await page.goto('http://localhost:3001', { waitUntil: 'networkidle2' });

        await new Promise(r => setTimeout(r, 3000));

        // Dispatch the recon pulse event!
        console.log("Dispatching answerly_recon_pulse...");
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('answerly_recon_pulse', { 
                detail: { keywords: [{query: "test", platform: "X"}] } 
            }));
        });

        console.log("Waiting 5s for extension to process the recon pulse...");
        await new Promise(r => setTimeout(r, 5000));

        await browser.close();
        console.log("Test finished.");
    } catch (e) {
        console.error("Puppeteer error:", e);
        process.exit(1);
    }
})();
