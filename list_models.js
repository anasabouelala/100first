import https from 'https';

const KEY = '***REMOVED***';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${KEY}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const j = JSON.parse(data);
    j.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .forEach(m => console.log(m.name));
  });
}).on('error', e => console.error(e));
