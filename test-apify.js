import fs from 'fs';

const token = process.env.APIFY_TOKEN;

const pageFunction = `async function pageFunction(context) {
    const { page, log } = context;
    log.info("Navigating and waiting for PH Discussions to load...");
    
    // Scroll down to trigger lazy load if needed
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
    }
    
    log.info("Extracting discussions...");
    const posts = await page.$$eval('a[href^="/discussions/"]', links => {
        const uniquePosts = new Map();
        
        links.forEach(link => {
            const title = link.innerText.trim();
            const url = 'https://www.producthunt.com' + link.getAttribute('href');
            
            // Only keep links with substantial text (real discussion titles, not just icons)
            if (title.length > 10 && !uniquePosts.has(url)) {
                // Try to find author and comments count nearby
                let author = "User";
                let commentsCount = "0";
                
                try {
                    // Go up a few levels to capture the whole article or container
                    const container = link.closest('article, li') || link.parentElement.parentElement;
                    const text = container ? container.innerText : "";
                    
                    const commentMatch = text.match(/(\\d+)\\s*(comments?|replies)/i);
                    if (commentMatch) commentsCount = commentMatch[1];
                    
                    // The author is usually mentioned before the 'ago' text or near the avatar
                    const authorElement = container ? container.querySelector('a[href^="/@"]') : null;
                    if (authorElement) {
                        author = authorElement.innerText.trim() || author;
                    }

                } catch(e) {}
                
                uniquePosts.set(url, {
                    title,
                    url,
                    creator: author,
                    date: "Today",
                    comments: [{ author: "System", text: \`Extracting \${commentsCount} comments requires deeper pagination\` }]
                });
            }
        });
        
        return Array.from(uniquePosts.values()).slice(0, 10);
    });
    
    return posts;
}`;

async function run() {
    console.log("Starting Apify Puppeteer Scraper...");
    const apiUrl = 'https://api.apify.com/v2/acts/apify~puppeteer-scraper/run-sync-get-dataset-items?token=' + token;

    const payload = {
        startUrls: [{ url: "https://www.producthunt.com/discussions" }],
        pageFunction: pageFunction,
        proxyConfiguration: { useApifyProxy: true }
    };

    const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

run();
