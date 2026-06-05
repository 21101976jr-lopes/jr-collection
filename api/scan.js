export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, manualQuery, discogsId, useGemini } = req.body;

    const discogsHeaders = {
      "User-Agent": "JrCollectionApp/1.0",
      "Authorization": `Discogs token=${process.env.DISCOGS_TOKEN}`
    };

    // ── Path 1: Fetch directly by Discogs ID ─────────────────────────────
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

      if (useGemini) {
        // ── Gemini Flash — melhor para capas sem texto ou artísticas ──────
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    {
                      inline_data: {
                        mime_type: "image/jpeg",
                        data: imageBase64
                      }
                    },
                    {
                      text: `Você é um especialista em discografia mundial e brasileira. Analise esta capa de disco de vinil com máximo detalhe visual — cores, formas, rostos, elementos gráficos, estilo da época, e qualquer texto visível.

Retorne SOMENTE JSON válido sem markdown:
{
  "artist": "Nome exato do artista",
  "album": "Nome exato do álbum",
  "year": 1985,
  "genre": "Gênero musical",
  "label": "Gravadora",
  "tracks": [],
  "confidence": "high|medium|low",
  "visibleText": "todo texto visível na capa",
  "visualClues": "descrição dos elementos visuais que ajudaram na identificação"
}

Se não conseguir identificar: {"error":"não identificado"}`
                    }
                  ]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
              })
            }
          );
          const geminiData = await geminiRes.json();
          const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (raw) {
            const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
            if (!parsed.error) {
              aiResult = { ...parsed, usedGemini: true };
            }
          }
        } catch(e) {
          console.error("Gemini error:", e.message);
        }
      }

      // ── Claude — padrão, bom para texto legível ───────────────────────
      if (!aiResult) {
        try {
          const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1000,
              messages: [{
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
                  { type: "text", text: `Você é um especialista em discos de vinil com foco especial em música brasileira: sertanejo, MPB, novelas, axé, pagode, forró, e também rock/pop internacional.

Analise MUITO CUIDADOSAMENTE esta capa. Leia CADA PALAVRA visível.

Retorne SOMENTE JSON válido (sem markdown):
{
  "artist": "Nome exato como aparece na capa",
  "album": "Nome exato do álbum como aparece na capa",
  "year": 1985,
  "genre": "Gênero musical",
  "label": "Gravadora se visível",
  "tracks": [],
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
          const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
          if (!parsed.error) aiResult = parsed;
        } catch(e) {
          console.error("Claude error:", e.message);
        }
      }

      if (!aiResult) {
        return res.status(200).json({ error:"não identificado", needsManualSearch:true });
      }
    }

    // ── Search Discogs with multiple strategies ───────────────────────────
    const artist = manualQuery ? "" : (aiResult.artist||"");
    const album  = manualQuery ? manualQuery : (aiResult.album||"");

    const queries = manualQuery
      ? [manualQuery]
      : [
          `${artist} ${album}`,
          album,
          artist,
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

    if (bestRelease) {
      const tracks = (bestRelease.tracklist||[]).filter(t=>t.type_==="track").map(t=>{
        const a = t.artists?.map(a=>a.name.replace(/\s*\(\d+\)$/,"")).join(", ");
        return a ? `${a} - ${t.title}` : t.title;
      });
      const coverUrl = bestRelease.images?.[0]?.uri || (discogsResults[0]?.cover || null);

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
        usedGemini: aiResult?.usedGemini || false,
      });
    } else {
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
        usedGemini: aiResult?.usedGemini || false,
      });
    }

  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
