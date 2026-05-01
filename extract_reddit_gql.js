import fetch from 'node-fetch';

async function findQuery() {
    console.log("Fetching Reddit Homepage...");
    const res = await fetch("https://www.reddit.com/");
    const html = await res.text();
    
    console.log("Extracting JS bundle URLs...");
    const jsUrls = [...html.matchAll(/src="(https:\/\/www\.redditstatic\.com\/shreddit\/[^"]+\.js)"/g)].map(m => m[1]);
    
    console.log(`Found ${jsUrls.length} JS bundles. Searching for GraphQL notifications query...`);
    
    for (const url of jsUrls) {
        const jsRes = await fetch(url);
        const jsText = await jsRes.text();
        
        // Search for GraphQL strings
        if (jsText.toLowerCase().includes('notifications') && jsText.includes('query')) {
            const queries = jsText.match(/query[^{]*{[^}]+notifications[^}]+}/gi) || [];
            if (queries.length > 0) {
                console.log(`\n\n--- Found matching query in ${url} ---`);
                console.log(queries[0].substring(0, 500));
            }
        }
    }
    console.log("\nDone");
}

findQuery();
