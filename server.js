require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');
const PARAMETERS_FILE = path.join(__dirname, 'parameters.json');
const CANS_DIR = path.join(__dirname, 'public', 'cans');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_COOKIE = 'mt_admin_session';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function parseCookies(cookieHeader) {
  return (cookieHeader || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getAdminSessionId(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[ADMIN_COOKIE] || '';
}

function isAdminSessionValid(sessionId) {
  const session = adminSessions.get(sessionId);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const sessionId = getAdminSessionId(req);
  if (!sessionId || !isAdminSessionValid(sessionId)) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  req.adminSessionId = sessionId;
  next();
}

function setAdminCookie(res, sessionId) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function slugifyFileName(name) {
  return name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function saveFlavorImage(name, file) {
  if (!file) return null;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext !== '.png') {
    throw new Error('A imagem precisa ser PNG (.png)');
  }

  if (!fs.existsSync(CANS_DIR)) {
    fs.mkdirSync(CANS_DIR, { recursive: true });
  }

  const base = slugifyFileName(name) || 'flavor';
  fs.writeFileSync(path.join(CANS_DIR, base), file.buffer);
  return base;
}

function maybeDeleteFlavorImage(imageName, flavors) {
  if (!imageName) return;
  const stillUsed = flavors.some(flavor => flavor.image === imageName);
  if (stillUsed) return;

  const filePath = path.join(CANS_DIR, imageName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function readDB() {
  if (!fs.existsSync(DB_FILE)) return { entries: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { entries: [] }; }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function readParameters() {
  if (!fs.existsSync(PARAMETERS_FILE)) return { users: [], flavors: [] };
  try {
    const raw = fs.readFileSync(PARAMETERS_FILE, 'utf8');
    const data = JSON.parse(raw);

    const users = Array.isArray(data.users)
      ? data.users
          .map(u => {
            if (typeof u === 'string') return u.trim();
            if (u && typeof u.name === 'string') return u.name.trim();
            return '';
          })
          .filter(Boolean)
      : [];

    const flavors = Array.isArray(data.flavors)
      ? data.flavors
          .map(f => {
            if (typeof f === 'string') return { name: f.trim(), image: null };
            if (f && typeof f.name === 'string') {
              return {
                name: f.name.trim(),
                image: typeof f.image === 'string' ? f.image.trim() : null
              };
            }
            return null;
          })
          .filter(f => f && f.name)
      : [];

    return {
      users,
      flavors
    };
  } catch {
    return { users: [], flavors: [] };
  }
}

function writeParameters(data) {
  fs.writeFileSync(PARAMETERS_FILE, JSON.stringify(data, null, 2));
}

// GET all entries
app.get('/api/entries', (req, res) => {
  const db = readDB();
  res.json(db.entries);
});

// GET app parameters (users/flavors)
app.get('/api/parameters', (req, res) => {
  res.json(readParameters());
});

app.get('/api/admin/parameters', requireAdmin, (req, res) => {
  res.json(readParameters());
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const params = readParameters();
  res.json({ users: params.users });
});

app.get('/api/admin/flavors', requireAdmin, (req, res) => {
  const params = readParameters();
  res.json({ flavors: params.flavors });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!rawName) {
    return res.status(400).json({ error: 'Nome do usuário é obrigatório' });
  }

  const params = readParameters();
  const exists = params.users.some(user => user.toLowerCase() === rawName.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Usuário já existe' });
  }

  params.users.push(rawName);
  writeParameters(params);
  res.status(201).json({ ok: true, users: params.users });
});

app.delete('/api/admin/users/:name', requireAdmin, (req, res) => {
  const target = decodeURIComponent(req.params.name || '').trim().toLowerCase();
  if (!target) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  const params = readParameters();
  const before = params.users.length;
  params.users = params.users.filter(user => user.toLowerCase() !== target);
  if (params.users.length === before) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  writeParameters(params);
  res.json({ ok: true, users: params.users });
});

app.post('/api/admin/flavors', requireAdmin, upload.single('image'), (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!rawName) {
    return res.status(400).json({ error: 'Nome do sabor é obrigatório' });
  }

  const params = readParameters();
  const exists = params.flavors.some(flavor => flavor.name.toLowerCase() === rawName.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Sabor já existe' });
  }

  let imageName = null;
  try {
    imageName = saveFlavorImage(rawName, req.file || null);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Falha ao salvar imagem do sabor' });
  }

  params.flavors.push({ name: rawName, image: imageName });
  writeParameters(params);
  res.status(201).json({ ok: true, flavors: params.flavors });
});

app.delete('/api/admin/flavors/:name', requireAdmin, (req, res) => {
  const target = decodeURIComponent(req.params.name || '').trim().toLowerCase();
  if (!target) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  const params = readParameters();
  const targetFlavor = params.flavors.find(flavor => flavor.name.toLowerCase() === target);
  if (!targetFlavor) {
    return res.status(404).json({ error: 'Sabor não encontrado' });
  }

  params.flavors = params.flavors.filter(flavor => flavor.name.toLowerCase() !== target);
  maybeDeleteFlavorImage(targetFlavor.image, params.flavors);

  writeParameters(params);
  res.json({ ok: true, flavors: params.flavors });
});

app.get('/api/admin/entries', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.entries);
});

app.get('/api/admin/me', (req, res) => {
  const sessionId = getAdminSessionId(req);
  if (!sessionId || !isAdminSessionValid(sessionId)) {
    return res.json({ authenticated: false });
  }

  res.json({ authenticated: true, username: ADMIN_USER });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const sessionId = crypto.randomUUID();
  adminSessions.set(sessionId, {
    username: ADMIN_USER,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });

  setAdminCookie(res, sessionId);
  res.json({ ok: true, username: ADMIN_USER });
});

app.post('/api/admin/logout', (req, res) => {
  const sessionId = getAdminSessionId(req);
  if (sessionId) {
    adminSessions.delete(sessionId);
  }
  clearAdminCookie(res);
  res.json({ ok: true });
});

// POST new entry
app.post('/api/entries', (req, res) => {
  const { name, date, flavor } = req.body;
  if (!name || !date || !flavor) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, date, flavor' });
  }

  const cleanName = name.trim();
  const cleanFlavor = flavor.trim();
  const { users, flavors } = readParameters();
  const allowedUser = users.some(u => u.trim().toLowerCase() === cleanName.toLowerCase());
  if (!allowedUser) {
    return res.status(400).json({ error: 'Usuário não permitido. Selecione um nome da lista.' });
  }

  const allowedFlavor = flavors.some(f => f.name.toLowerCase() === cleanFlavor.toLowerCase());
  if (!allowedFlavor) {
    return res.status(400).json({ error: 'Sabor não permitido. Selecione um sabor da lista.' });
  }

  const db = readDB();
  const entry = { id: Date.now(), name: cleanName, date, flavor: cleanFlavor, createdAt: new Date().toISOString() };
  db.entries.push(entry);
  writeDB(db);
  res.status(201).json(entry);
});

// DELETE entry
app.delete('/api/entries/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  const before = db.entries.length;
  db.entries = db.entries.filter(e => e.id !== id);
  if (db.entries.length === before) return res.status(404).json({ error: 'Não encontrado' });
  writeDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Monster Tracker rodando na porta ${PORT}`));
