import fetch from 'node-fetch';

async function findQuery() {
    console.log("Fetching Reddit Homepage...");
    const res = await fetch("https://www.reddit.com/", {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = await res.text();
    
    console.log("Extracting JS bundle URLs...");
    // Just find any JS file
    const jsUrls = [...new Set([...html.matchAll(/"(https:\/\/[^"]+\.js)"/g)].map(m => m[1]))];
    
    console.log(`Found ${jsUrls.length} JS bundles. Searching for GraphQL notification IDs...`);
    
    for (const url of jsUrls) {
        try {
            const jsRes = await fetch(url);
            const jsText = await jsRes.text();
            
            // Look for GraphQL hashes or notification keywords
            if (jsText.toLowerCase().includes('updateinboxactivityseenstate') || jsText.toLowerCase().includes('notifications') || jsText.includes('queryId')) {
                // Find potential hashes (usually 32 char hex or similar)
                // In Apollo, persisted queries look like {id:"hash"}
                const jsonMatches = jsText.match(/\{[^}]*"id"\s*:\s*"([a-f0-9]{32,})"[^}]*\}/gi) || [];
                if (jsonMatches.length > 0 || jsText.toLowerCase().includes('notifications')) {
                    console.log(`\n\n--- Found potential GraphQL info in ${url} ---`);
                    const idx = jsText.toLowerCase().indexOf('notification');
                    if (idx !== -1) {
                        console.log(jsText.substring(Math.max(0, idx - 100), idx + 200));
                    }
                }
            }
        } catch(e) {}
    }
    console.log("\nDone");
}

findQuery();
