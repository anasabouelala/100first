import * as cheerio from 'cheerio';

async function testScrape() {
    try {
        const res = await fetch('https://www.producthunt.com/discussions');
        const html = await res.text();
        const $ = cheerio.load(html);

        console.log('Title:', $('title').text());

        // Look for links to discussions
        const links = [];
        $('a[href^="/discussions/"]').each((i, el) => {
            links.push($(el).attr('href'));
        });

        console.log('Discussion Links found:', links.length);
        console.log(links.slice(0, 10));

        // Also Next.js __NEXT_DATA__
        const nextData = $('#__NEXT_DATA__').html();
        console.log('Next Data found:', !!nextData);
    } catch (e) {
        console.error(e);
    }
}

testScrape();
