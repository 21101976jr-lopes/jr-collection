export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, manualQuery, discogsId } = req.body;

    const discogsHeaders = {
      "User-Agent": "JrCollectionApp/1.0",
      "Authorization": `Discogs token=${process.env.DISCOGS_TOKEN}`
    };

    // ── Path 1: Fetch directly by Discogs ID ──────────────────────────────
    if (discogsId) {
      const r = await (await fetch(`https://api.discogs.com/releases/${discogsId}`, { headers: discogsHeaders })).json();
      const tracks = (r.tracklist||[]).filter(t=>t.type_==="track").map(t=>{
        const a = t.artists?.map(a=>a.name.replace(/\s*\(\d+\)$/,"")).join(", ");
        return a ? `${a} - ${t.title}` : t.title;
      });
      return res.status(200).json({
        artist: r.artists_sort||r.artists?.[0]?.name||"",
        album: r.title||"", year: r.year||"",
        genre: r.genres?.[0]||r.styles?.[0]||"",
        label: r.labels?.[0]?.name||"",
        tracks, coverUrl: r.images?.[0]?.uri||null, discogsResults:[],
      });
    }

    // ── Path 2: AI image recognition ─────────────────────────────────────
    let aiResult = null;
    if (!manualQuery) {
      if (!imageBase64) return res.status(400).json({ error: "Imagem não enviada" });
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
              { type: "text", text: `Você é um especialista em discos de vinil com foco especial em música brasileira: sertanejo, MPB, novelas, axé, pagode, forró, e também rock/pop internacional.

Analise MUITO CUIDADOSAMENTE esta capa de disco de vinil. Leia CADA PALAVRA visível na imagem.

Retorne SOMENTE JSON válido (sem markdown):
{
  "artist": "Nome exato como aparece na capa",
  "album": "Nome exato do álbum como aparece na capa",
  "year": 1985,
  "genre": "Gênero musical",
  "label": "Gravadora se visível",
  "tracks": ["liste músicas se visíveis na capa, senão deixe vazio"],
  "confidence": "high|medium|low",
  "visibleText": "TODO texto que você consegue ler na capa"
}

Se não conseguir identificar nada: {"error":"não identificado"}` }
            ]
          }]
        })
      });
      const aiData = await aiRes.json();
      const raw = aiData.content?.map(b=>b.text||"").join("").trim();
      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
        if (parsed.error) {
          return res.status(200).json({ error:"não identificado", needsManualSearch:true });
        }
        aiResult = parsed;
      } catch {
        return res.status(200).json({ error:"não identificado", needsManualSearch:true });
      }
    }

    // ── Path 3: Search Discogs with multiple strategies ───────────────────
    const artist = manualQuery ? "" : (aiResult.artist||"");
    const album  = manualQuery ? manualQuery : (aiResult.album||"");

    // Build multiple search queries to maximize chances of finding Brazilian music
    const queries = manualQuery
      ? [manualQuery]
      : [
          `${artist} ${album}`,           // full query
          album,                           // album only
          artist,                          // artist only
          // Remove common words that confuse search
          `${artist} ${album}`.replace(/internacional|nacional|trilha|sonora|vol\.|volume/gi,"").trim(),
        ].filter((q,i,arr) => q.trim().length > 2 && arr.indexOf(q) === i);

    let discogsResults = [];
    let bestRelease = null;

    for (const q of queries) {
      if (discogsResults.length >= 5) break;
      try {
        const searchRes = await fetch(
          `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=5`,
          { headers: discogsHeaders }
        );
        const searchJson = await searchRes.json();
        const results = searchJson.results || [];

        for (const r of results) {
          if (!discogsResults.find(x => x.id === r.id)) {
            discogsResults.push({
              id: r.id,
              title: r.title,
              year: r.year,
              label: r.label?.[0],
              cover: r.cover_image && !r.cover_image.includes("spacer") ? r.cover_image : null,
              country: r.country,
            });
          }
        }

        // Fetch full details of first new result
        if (!bestRelease && results.length > 0) {
          const rel = await (await fetch(
            `https://api.discogs.com/releases/${results[0].id}`,
            { headers: discogsHeaders }
          )).json();
          if (rel.title) bestRelease = rel;
        }
      } catch {}
    }

    discogsResults = discogsResults.slice(0, 5);

    // ── Build final response ──────────────────────────────────────────────
    if (bestRelease) {
      // Discogs found something — merge with AI result
      const tracks = (bestRelease.tracklist||[]).filter(t=>t.type_==="track").map(t=>{
        const a = t.artists?.map(a=>a.name.replace(/\s*\(\d+\)$/,"")).join(", ");
        return a ? `${a} - ${t.title}` : t.title;
      });
      const coverUrl = bestRelease.images?.[0]?.uri
        || (discogsResults[0]?.cover || null);

      return res.status(200).json({
        artist: bestRelease.artists_sort || aiResult?.artist || "",
        album:  bestRelease.title        || aiResult?.album  || "",
        year:   bestRelease.year         || aiResult?.year   || "",
        genre:  bestRelease.genres?.[0]  || bestRelease.styles?.[0] || aiResult?.genre || "",
        label:  bestRelease.labels?.[0]?.name || aiResult?.label || "",
        tracks: tracks.length ? tracks : (aiResult?.tracks||[]),
        coverUrl,
        confidence: aiResult?.confidence || "medium",
        discogsResults,
        foundOnDiscogs: true,
      });
    } else {
      // Discogs found nothing — return AI result so user doesn't lose data
      return res.status(200).json({
        artist: aiResult?.artist || "",
        album:  aiResult?.album  || "",
        year:   aiResult?.year   || "",
        genre:  aiResult?.genre  || "",
        label:  aiResult?.label  || "",
        tracks: aiResult?.tracks || [],
        coverUrl: null,
        confidence: aiResult?.confidence || "low",
        discogsResults: [],
        foundOnDiscogs: false,
        needsManualSearch: true,
      });
    }

  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
