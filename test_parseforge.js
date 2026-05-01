const token = process.env.APIFY_TOKEN;

async function run() {
    const response = await fetch(`https://api.apify.com/v2/acts/parseforge~producthunt-scraper/run-sync-get-dataset-items?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            startUrls: [{ url: "https://www.producthunt.com/discussions" }],
            maxItems: 5
        })
    });

    if (!response.ok) {
        console.error("Failed:", response.status, await response.text());
        return;
    }
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}

run();
