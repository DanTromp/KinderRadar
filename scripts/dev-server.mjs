import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(process.env.KINDERRADAR_STATIC_ROOT ?? join(projectRoot, 'dist'));
const preferredPort = Number.parseInt(process.env.PORT ?? '4173', 10);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

function toFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://localhost:${preferredPort}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath.endsWith('/')
    ? join(decodedPath, 'index.html')
    : decodedPath;
  const filePath = normalize(join(root, requestedPath));

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  return filePath;
}

async function findFile(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      return filePath;
    }

    if (fileStat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      const indexStat = await stat(indexPath);
      return indexStat.isFile() ? indexPath : null;
    }
  } catch {
    if (!extname(filePath)) {
      const indexPath = join(filePath, 'index.html');
      try {
        const indexStat = await stat(indexPath);
        return indexStat.isFile() ? indexPath : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

async function handleRequest(request, response) {
  const filePath = await findFile(toFilePath(request.url ?? '/'));

  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

function listen(port, attemptsLeft = 10) {
  const server = createServer(handleRequest);

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0 && !process.env.PORT) {
      server.close();
      listen(port + 1, attemptsLeft - 1);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Set another port with: $env:PORT=5000; npm start`);
      process.exitCode = 1;
      return;
    }

    throw error;
  });

  server.listen(port, () => {
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.log(`KinderRadar is running at http://localhost:${activePort}/`);
  });
}

listen(preferredPort);
