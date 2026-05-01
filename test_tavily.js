const TAVILY_API_KEY = "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";

async function run() {
    const query = `site:producthunt.com/discussions`;
    const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: query,
            search_depth: "advanced",
            max_results: 10,
            include_raw_content: true
        })
    });
    const data = await response.json();
    console.log(data);
}
run();
