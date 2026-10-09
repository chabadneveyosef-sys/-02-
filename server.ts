import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const REPO_FILE = path.join(DATA_DIR, 'erp_repository.json');

interface ServerRepositoryPayload {
  updatedAt: string;
  users: unknown[];
  auditLogs: unknown[];
  templates: unknown[];
  activities: unknown[];
  tasks: unknown[];
  transactions: unknown[];
  donors: unknown[];
  communityEntities: unknown[];
  defaultMapLocation?: {
    locationName: string;
    lat: number;
    lng: number;
    zoom: number;
  };
}

function readServerRepo(): ServerRepositoryPayload | null {
  try {
    if (!fs.existsSync(REPO_FILE)) return null;
    const raw = fs.readFileSync(REPO_FILE, 'utf-8');
    return JSON.parse(raw) as ServerRepositoryPayload;
  } catch (err) {
    console.error('Error reading server repository:', err);
    return null;
  }
}

function writeServerRepo(payload: ServerRepositoryPayload): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(REPO_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing server repository:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  // API: Health & Sync Status
  app.get('/api/health', (_req, res) => {
    const repo = readServerRepo();
    res.json({
      status: 'ok',
      hasData: Boolean(repo),
      updatedAt: repo?.updatedAt || null,
    });
  });

  // API: Download signed standalone Android APK (works on devices without any browser)
  app.get('/api/download-apk', (_req, res) => {
    const apkPublicPath = path.join(process.cwd(), 'public', 'chabad-erp.apk');
    const apkDistPath = path.join(process.cwd(), 'dist', 'chabad-erp.apk');
    const targetPath = fs.existsSync(apkPublicPath) ? apkPublicPath : apkDistPath;

    if (!fs.existsSync(targetPath)) {
      res.status(404).json({ error: 'APK file not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="chabad-erp-android.apk"');
    res.sendFile(targetPath);
  });

  // API: Get persistent ERP repository snapshot
  app.get('/api/repository', (_req, res) => {
    const repo = readServerRepo();
    res.json({
      ok: true,
      data: repo,
    });
  });

  // API: Save persistent ERP repository snapshot (used alongside Cloud Firestore)
  app.post('/api/repository', (req, res) => {
    const body = req.body as Partial<ServerRepositoryPayload>;
    const existing = readServerRepo();

    const nextPayload: ServerRepositoryPayload = {
      updatedAt: new Date().toISOString(),
      users: Array.isArray(body.users) ? body.users : existing?.users || [],
      auditLogs: Array.isArray(body.auditLogs) ? body.auditLogs : existing?.auditLogs || [],
      templates: Array.isArray(body.templates) ? body.templates : existing?.templates || [],
      activities: Array.isArray(body.activities) ? body.activities : existing?.activities || [],
      tasks: Array.isArray(body.tasks) ? body.tasks : existing?.tasks || [],
      transactions: Array.isArray(body.transactions) ? body.transactions : existing?.transactions || [],
      donors: Array.isArray(body.donors) ? body.donors : existing?.donors || [],
      communityEntities: Array.isArray(body.communityEntities)
        ? body.communityEntities
        : existing?.communityEntities || [],
      defaultMapLocation: body.defaultMapLocation || existing?.defaultMapLocation,
    };

    writeServerRepo(nextPayload);
    res.json({
      ok: true,
      updatedAt: nextPayload.updatedAt,
    });
  });

  // Vite middleware for development vs static dist for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      appType: 'spa',
    });
    app.use((req, _res, next) => {
      if (req.url === '/' || req.url?.startsWith('/index.html')) {
        vite.moduleGraph.invalidateAll();
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Chabad ERP Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
