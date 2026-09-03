const crypto = require("crypto");

const TTL_SECONDS = 72 * 60 * 60;
const MAX_BODY_BYTES = 4_500_000;

const redisConfig = () => ({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
});

const redis = async command => {
  const { url, token } = redisConfig();
  if (!url || !token) throw new Error("STORAGE_NOT_CONFIGURED");
  const response = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error("STORAGE_ERROR");
  const data = await response.json();
  if (data.error) throw new Error("STORAGE_ERROR");
  return data.result;
};

const text = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
const escapeHtml = value => text(value, 5000).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const safeCover = value => {
  const cover = String(value || "");
  return /^(data:image\/(?:jpeg|png|webp);base64,|https:\/\/)/i.test(cover) ? cover : "";
};

const unavailablePage = () => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catálogo indisponível</title><body style="margin:0;background:#0a0a0a;color:#f0ece4;font-family:Georgia,serif;display:grid;min-height:100vh;place-items:center"><p>Este catálogo temporário não está mais disponível.</p></body></html>`;

const catalogPage = catalog => {
  const categoryNames = { banda:"Banda / Artista", novela:"Novela", coletanea:"Coletânea", outros:"Outros/Venda" };
  const order = ["banda", "novela", "coletanea", "outros"];
  const groups = order.map(id => ({ id, records: catalog.records.filter(record => record.category === id) })).filter(group => group.records.length);
  const cards = groups.map(group => `<section><h2>${categoryNames[group.id]}</h2><div class="grid">${group.records.map(record => `<article>${record.coverPhoto ? `<img src="${escapeHtml(record.coverPhoto)}" alt="Capa de ${escapeHtml(record.album)}">` : `<div class="cover">💿</div>`}<div class="info"><small>${escapeHtml(record.artist)}</small><h3>${escapeHtml(record.album)}</h3><p>${escapeHtml(record.year)}${record.year && record.genre ? " · " : ""}${escapeHtml(record.genre)}</p></div></article>`).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(catalog.catalogName)}</title><style>*{box-sizing:border-box}body{margin:0;background:#0a0a0a;color:#f0ece4;font-family:Georgia,serif}header,main{width:min(1100px,100%);margin:auto;padding:24px 18px}header{background:linear-gradient(#130707,#0a0a0a);border-bottom:1px solid #222}h1{margin:0 0 5px;font-weight:400;letter-spacing:2px}header p,article p{margin:0;color:#999;font-family:monospace}h2{color:#d4af6a;font-weight:400;border-bottom:1px solid #282014;padding-bottom:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:16px}article{overflow:hidden;border:1px solid #1d1d1d;border-radius:12px;background:#0d0d0d}img,.cover{width:100%;aspect-ratio:1;object-fit:cover;background:#161616}.cover{display:grid;place-items:center;font-size:48px}.info{padding:12px}.info small{color:#c94b41;font-family:monospace}.info h3{font-size:18px;margin:6px 0 8px;font-weight:400}</style></head><body><header><h1>${escapeHtml(catalog.catalogName)}</h1><p>${catalog.records.length} disco${catalog.records.length === 1 ? "" : "s"} no catálogo</p></header><main>${cards}</main></body></html>`;
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "POST") {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: "O catálogo é grande demais para compartilhar." });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.records) || body.records.length > 3000) return res.status(400).json({ error: "Catálogo inválido." });
      const records = body.records.map(record => ({
        category: ["banda", "novela", "coletanea", "outros"].includes(record?.category) ? record.category : "outros",
        artist: text(record?.artist, 160), album: text(record?.album, 160), year: text(record?.year, 12),
        genre: text(record?.genre, 100), coverPhoto: safeCover(record?.coverPhoto)
      })).sort((a, b) => a.artist.localeCompare(b.artist, "pt-BR", { sensitivity:"base" }) || a.album.localeCompare(b.album, "pt-BR", { sensitivity:"base" }));
      const payload = JSON.stringify({ catalogName: text(body.catalogName, 100) || "Jr Collection", records });
      if (Buffer.byteLength(payload) > MAX_BODY_BYTES) return res.status(413).json({ error: "O catálogo é grande demais para compartilhar." });
      const ip = text(req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress, 100);
      const rateKey = `share-rate:${crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
      const count = await redis(["INCR", rateKey]);
      if (count === 1) await redis(["EXPIRE", rateKey, 3600]);
      if (count > 10) return res.status(429).json({ error: "Muitos links criados. Tente novamente mais tarde." });
      const id = crypto.randomBytes(24).toString("base64url");
      await redis(["SET", `share:${id}`, payload, "EX", TTL_SECONDS]);
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      return res.status(201).json({ url: `${protocol}://${host}/compartilhar/${id}`, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() });
    } catch (error) {
      if (error.message === "STORAGE_NOT_CONFIGURED") return res.status(503).json({ error: "O armazenamento de compartilhamento ainda não está configurado." });
      return res.status(500).json({ error: "Não foi possível gerar o link." });
    }
  }
  if (req.method === "GET") {
    try {
      const id = text(req.query.id, 80);
      if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return res.status(404).send(unavailablePage());
      const value = await redis(["GET", `share:${id}`]);
      if (!value) return res.status(404).send(unavailablePage());
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(catalogPage(typeof value === "string" ? JSON.parse(value) : value));
    } catch {
      return res.status(404).send(unavailablePage());
    }
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
};
