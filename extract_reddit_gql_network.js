import puppeteer from 'puppeteer-core';

(async () => {
    // Launch an isolated, headless browser
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir: 'C:\\Users\\hp\\AppData\\Local\\Temp\\reddit_temp_profile',
        headless: "new"
    });

    const page = await browser.newPage();
    
    console.log("Listening to network requests for GraphQL...");
    
    page.on('request', request => {
        if (request.url().includes('gql.reddit.com')) {
            const postData = request.postData();
            if (postData && postData.toLowerCase().includes('notification')) {
                console.log("\n\n=== FOUND GraphQL REQUEST ===");
                console.log("URL:", request.url());
                console.log("Headers:", request.headers());
                console.log("Body:", JSON.parse(postData));
            }
        }
    });

    console.log("Navigating to Reddit...");
    await page.goto("https://www.reddit.com/", { waitUntil: "networkidle2" });
    
    // Sometimes guests don't trigger the notification query on the homepage. 
    // We will simulate a click on something or go to /notifications
    console.log("Navigating to /notifications as a guest...");
    await page.goto("https://www.reddit.com/notifications", { waitUntil: "networkidle2" });

    await browser.close();
    console.log("Done.");
})();
