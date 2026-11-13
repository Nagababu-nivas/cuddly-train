#!/usr/bin/env node
/**
 * Tiny local static server for Orange using standard Node.js libraries.
 * Serves static files with no-cache headers for quick local iteration.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptDesEcb } from './js/providers/des.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 && process.argv[portArg + 1] ? Number(process.argv[portArg + 1]) : 5173;
const hostArg = process.argv.indexOf('--host');
const HOST = hostArg !== -1 && process.argv[hostArg + 1] ? process.argv[hostArg + 1] : '127.0.0.1';

function handleRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  let pathname = decodeURIComponent(reqUrl.pathname);

  // Full-track audio streaming resolution endpoint
  if (pathname === '/api/stream') {
    const q = reqUrl.searchParams.get('q');
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing query parameter q' }));
      return;
    }
    const apiUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(q)}`;
    fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
      .then((r) => r.json())
      .then((data) => {
        const results = data.results || [];
        if (!results.length) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No stream found' }));
          return;
        }
        const item = results[0];
        const encrypted = item.more_info?.encrypted_media_url;
        if (!encrypted) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No media URL found' }));
          return;
        }
        const decryptedUrl = decryptDesEcb(encrypted);
        const highQualityUrl = decryptedUrl.replace(/_[0-9]+\.mp4$/, '_320.mp4');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({
          success: true,
          url: highQualityUrl,
          fallbackUrl: decryptedUrl,
          title: item.title,
          artist: item.more_info?.singers || item.more_info?.artistMap?.primary_artists?.[0]?.name || '',
          duration: Number(item.more_info?.duration) || 0,
        }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(err) }));
      });
    return;
  }

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const filePath = path.join(__dirname, pathname);

  // Security: prevent path traversal out of directory
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

let currentPort = PORT;

function startServer(port) {
  currentPort = port;
  const server = http.createServer(handleRequest);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && currentPort < PORT + 10) {
      console.log(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
      startServer(currentPort + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, HOST, () => {
    console.log(`Orange is running at http://${HOST}:${port}/`);
  });

  process.on('SIGINT', () => {
    server.close(() => {
      console.log('\nStopped.');
      process.exit(0);
    });
  });
}

startServer(PORT);
