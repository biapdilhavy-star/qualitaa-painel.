// Painel de Chamada - servidor sem dependências. Rode: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = process.env.PORT || 3000;
const PIN = process.env.OPERATOR_PIN || '';          // opcional: protege o operador
const FILE = path.join(__dirname, 'state.json');
let units = {};
try { units = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
const clients = {};                                  // unidade -> Set({res, role})


// procura o index.html em qualquer pasta (aceita pasta public com outro nome ou aninhada)
function listAll(dir, depth) {
  let out = [];
  if (depth > 4) return out;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {}
  for (const it of items) {
    if (it.name === 'node_modules' || it.name === '.git') continue;
    const full = path.join(dir, it.name);
    out.push(path.relative(__dirname, full) + (it.isDirectory() ? '/' : ''));
    if (it.isDirectory()) out = out.concat(listAll(full, depth + 1));
  }
  return out;
}
function findIndex() {
  const direct = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')];
  for (const f of direct) if (fs.existsSync(f)) return f;
  const hit = listAll(__dirname, 0).find(f => /(^|[\\/])index\.html$/i.test(f));
  return hit ? path.join(__dirname, hit) : null;
}

const save = () => fs.writeFile(FILE, JSON.stringify(units), () => {});
const snap = u => {
  const s = units[u] || {};
  const tvs = [...(clients[u] || [])].filter(c => c.role === 'tv').length;
  return JSON.stringify({ cfg: s.cfg || null, call: s.call || null, tvs });
};
const push = u => { const d = 'data: ' + snap(u) + '\n\n'; (clients[u] || []).forEach(c => c.res.write(d)); };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function cleanCall(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    type: 'call', pre: str(c.pre, 2).toUpperCase(), num: str(c.num, 3).replace(/\D/g, ''),
    tipo: str(c.tipo, 20), dnum: str(c.dnum, 4).replace(/\D/g, ''),
    mode: ['img', 'som', 'vid'].includes(c.mode) ? c.mode : 'som', ts: Number(c.ts) || Date.now()
  };
}
function cleanCfg(c) {
  if (!c || typeof c !== 'object') return null;
  return { emp: str(c.emp, 40), uni: str(c.uni, 40), ci: Math.max(0, Math.min(6, parseInt(c.ci) || 0)),
           vol: Math.max(0.2, Math.min(1, Number(c.vol) || 1)) };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  const u = (url.searchParams.get('unit') || 'unidade').replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'unidade';

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const c = { res, role: url.searchParams.get('role') };
    (clients[u] = clients[u] || new Set()).add(c);
    push(u);
    req.on('close', () => { clients[u].delete(c); push(u); });
    return;
  }

  if (p === '/api/call' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
      if (PIN && b.pin !== PIN) { res.writeHead(401); return res.end(); }
      const s = units[u] = units[u] || {};
      const cfg = cleanCfg(b.cfg), call = cleanCall(b.call);
      if (cfg) s.cfg = cfg;
      if (call) s.call = call;
      save(); push(u);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
    });
    return;
  }

  if (p === '/' || p.startsWith('/tv/')) {
    const f = findIndex();
    if (!f) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('index.html nao encontrado. Arquivos vistos no servidor:\n' + listAll(__dirname, 0).join('\n'));
    }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(500); return res.end('Erro ao ler index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
    });
    return;
  }
  res.writeHead(404); res.end('Não encontrado');
}).listen(PORT, '0.0.0.0', () => {
  console.log('\nPainel de Chamada rodando!\n  Operador: http://localhost:' + PORT + '/');
  Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('  Na rede:  http://' + i.address + ':' + PORT + '/   (TV: /tv/nome-da-unidade)'));
});

setInterval(() => Object.values(clients).forEach(s => s.forEach(c => c.res.write(': ping\n\n'))), 20000);
