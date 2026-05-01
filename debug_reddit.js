import puppeteer from 'puppeteer-core';
import fs from 'fs';

(async () => {
    console.log("Launching your actual Chrome profile in the background to diagnose...");
    
    // Connect to the user's active Chrome profile
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir: 'C:\\Users\\hp\\AppData\\Local\\Google\\Chrome\\User Data',
        headless: "new"
    });

    const page = await browser.newPage();
    
    console.log("Navigating to Reddit Notifications...");
    await page.goto("https://www.reddit.com/notifications", { waitUntil: "networkidle2" });
    
    const html = await page.content();
    fs.writeFileSync('reddit_debug_dump.html', html);
    
    // Strip it the way the background script does
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    fs.writeFileSync('reddit_debug_plaintext.txt', plainText);

    console.log("Done extracting. Analyzing to see why 'microsaas' failed...");
    const lower = plainText.toLowerCase();
    
    console.log("Does it contain 'nouveau dans r'? ", lower.includes("nouveau dans r"));
    console.log("Does it contain 'microsaas'? ", lower.includes("microsaas"));
    
    if (lower.includes("microsaas")) {
        const index = lower.indexOf("microsaas");
        console.log("SURROUNDING TEXT:");
        console.log(plainText.substring(Math.max(0, index - 50), index + 100));
    }
    
    await browser.close();
})();
