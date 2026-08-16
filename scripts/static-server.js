const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PORT = process.env.PORT || 8934;
http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const p = /^\/channel\//.test(urlPath) ? path.join(root, 'loop-channel-test.html') : path.join(root, decodeURIComponent(urlPath));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log('static server on ' + PORT));
