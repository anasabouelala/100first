import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  let graphqlFound = false;

  page.on('request', request => {
    if (request.url().includes('/frontend/graphql')) {
      const postData = request.postData();
      if (postData && postData.includes('Discussions')) {
        console.log("----- FOUND GRAPHQL REQUEST -----");
        console.log("HEADERS:", JSON.stringify(request.headers(), null, 2));
        console.log("PAYLOAD:", postData);
        console.log("---------------------------------");
        graphqlFound = true;
      }
    }
  });

  console.log("Navigating to https://www.producthunt.com/forums?order=new");
  await page.goto('https://www.producthunt.com/forums?order=new', { waitUntil: 'networkidle2' });

  // scroll down
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 4000));

  if (!graphqlFound) {
    console.log("Scanning DOM for json payload...");
    const nextData = await page.evaluate(() => document.getElementById('__NEXT_DATA__')?.innerText);
    console.log("Has NEXT_DATA?", !!nextData);
  }

  await browser.close();
})();
