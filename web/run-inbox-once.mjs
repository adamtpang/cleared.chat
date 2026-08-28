process.env.PORT = '4423';
await import('./server.mjs');
await new Promise((r) => setTimeout(r, 700));
const t0 = Date.now();
const r = await fetch('http://localhost:4423/api/inbox');
const j = await r.json();
const fs = await import('node:fs');
fs.writeFileSync(new URL('./inbox-triage-result.json', import.meta.url), JSON.stringify(j));
console.log(
  'DONE in',
  ((Date.now() - t0) / 1000).toFixed(0) + 's |',
  j.error ? 'ERR: ' + j.error : 'items: ' + (j.items || []).length,
);
process.exit(0);
