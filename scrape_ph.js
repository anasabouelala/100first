import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const query = `
  query DiscussionsPage($cursor: String) {
    discussions(first: 26, after: $cursor) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          url
          createdAt
          user {
            name
          }
          commentsCount
          comments(first: 10) {
            edges {
              node {
                body
                user {
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

(async () => {
    console.log("Launching headless browser to bypass Cloudflare natively...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log("Navigating to producthunt.com to acquire standard session tokens...");
    await page.goto("https://www.producthunt.com/discussions", { waitUntil: 'networkidle2' });

    // Give it some time just in case of JS challenge
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log("Session acquired. Fetching GraphQL data inside the browser context...");

    let allDiscussions = [];
    let currentCursor = null;

    for (let i = 0; i < 10; i++) {
        console.log(`Fetching Page ${i + 1}... cursor: ${currentCursor}`);

        // Execute a fetch request inside the page context using the GraphQL query we made
        const result = await page.evaluate(async (graphqlQuery, pageCursor) => {
            try {
                const response = await fetch("https://www.producthunt.com/frontend/graphql", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "*/*"
                    },
                    body: JSON.stringify({
                        operationName: "DiscussionsPage",
                        variables: { cursor: pageCursor },
                        query: graphqlQuery
                    })
                });

                if (!response.ok) {
                    return { error: `GraphQL responded with status: ${response.status}` };
                }
                return await response.json();
            } catch (err) {
                return { error: err.toString() };
            }
        }, query, currentCursor);

        if (result.error) {
            console.error("Error inside browser fetch:", result.error);
            break;
        }

        if (result.errors) {
            console.error("GraphQL returned errors:", JSON.stringify(result.errors));
            break;
        }

        const { edges, pageInfo } = result.data.discussions;
        if (!edges || edges.length === 0) {
            console.log("No more discussions found.");
            break;
        }

        // Process nodes into our clean format
        const pageDiscussions = edges.map(edge => {
            const node = edge.node;

            const parsedComments = (node.comments?.edges || []).map(cEdge => ({
                author: cEdge.node?.user?.name || "Unknown",
                text: cEdge.node?.body || ""
            })).filter(c => c.text.length > 0);

            return {
                title: node.title,
                url: node.url.startsWith('http') ? node.url : `https://www.producthunt.com${node.url}`,
                creator: node.user?.name || "Anonymous",
                date: new Date(node.createdAt).toLocaleDateString(),
                commentsCount: node.commentsCount,
                comments: parsedComments
            };
        });

        allDiscussions = allDiscussions.concat(pageDiscussions);

        if (!pageInfo.hasNextPage) {
            break;
        }

        currentCursor = pageInfo.endCursor;
        // Delay slightly to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`Successfully scraped ${allDiscussions.length} discussions.`);

    fs.writeFileSync('ph_opportunities.json', JSON.stringify(allDiscussions, null, 2));
    console.log("Saved results to ph_opportunities.json");

    await browser.close();
})();
