import fetch from 'node-fetch';

async function testRedditSearch() {
    const query = "SaaS growth";
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=5`;
    
    console.log(`Fetching: ${url}`);
    
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    
    if (!res.ok) {
        console.log(`Failed! Status: ${res.status}`);
        return;
    }
    
    const data = await res.json();
    const children = data?.data?.children || [];
    console.log(`Found ${children.length} posts.`);
    
    if (children.length > 0) {
        console.log("First post:", children[0].data.title);
        console.log("Subreddit:", children[0].data.subreddit);
        console.log("URL:", `https://www.reddit.com${children[0].data.permalink}`);
    }
}

testRedditSearch();
