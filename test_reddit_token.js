import fetch from 'node-fetch';

async function testFetch() {
    console.log("Fetching Reddit homepage...");
    const authRes = await fetch("https://www.reddit.com/", {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = await authRes.text();
    
    console.log("Response size: ", html.length);
    
    const tokenMatch1 = html.match(/bearer-token="([^"]+)"/i);
    const tokenMatch2 = html.match(/"accessToken":"([^"]+)"/i);
    
    console.log("bearer-token match: ", tokenMatch1 ? tokenMatch1[1].substring(0, 10) + "..." : "null");
    console.log("accessToken match: ", tokenMatch2 ? tokenMatch2[1].substring(0, 10) + "..." : "null");
    
    // Search for other potential tokens
    const allTokens = html.match(/"[^"]*token[^"]*":"([^"]+)"/gi);
    if (allTokens) {
        console.log("Other token-like strings found: ");
        console.log(allTokens.slice(0, 5));
    }
}

testFetch();
