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

    // ── Path 1: Fetch directly by Discogs release ID (when user picks alternative) ──
    if (discogsId) {
      const releaseRes = await fetch(
        `https://api.discogs.com/releases/${discogsId}`,
        { headers: discogsHeaders }
      );
      const r = await releaseRes.json();
      const tracks = (r.tracklist || [])
        .filter(t => t.type_ === "track")
        .map(t => {
          const artist = t.artists?.map(a => a.name.replace(/\s*\(\d+\)$/, "")).join(", ");
          return artist ? `${artist} - ${t.title}` : t.title;
        });
      return res.status(200).json({
        artist: r.artists_sort || r.artists?.[0]?.name || "",
        album: r.title || "",
        year: r.year || "",
        genre: r.genres?.[0] || r.styles?.[0] || "",
        label: r.labels?.[0]?.name || "",
        tracks,
        coverUrl: r.images?.[0]?.uri || null,
        discogsResults: [],
      });
    }

    // ── Path 2: Manual text search ──
    let aiResult = null;
    if (manualQuery) {
      aiResult = { artist: "", album: manualQuery };
    } else {
      // ── Path 3: AI image recognition ──
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
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
              { type: "text", text: `Você é um especialista em discos de vinil, incluindo música brasileira, trilhas de novelas, coletâneas, sertanejo, MPB e todo tipo de disco nacional e internacional.\n\nAnalise CUIDADOSAMENTE esta capa. Leia TODO o texto visível: título, artista, gravadora, ano.\n\nRetorne SOMENTE JSON válido sem markdown:\n{"artist":"Nome exato do artista","album":"Nome exato do álbum","year":1979,"genre":"Gênero","label":"Gravadora","tracks":[],"confidence":"high|medium|low","visibleText":"todo texto visível na capa"}\n\nSe não identificar nada: {"error":"não identificado"}` }
            ]
          }]
        })
      });
      const aiData = await aiRes.json();
      const raw = aiData.content?.map(b => b.text || "").join("").trim();
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (parsed.error) return res.status(200).json({ error: "não identificado", needsManualSearch: true });
      aiResult = parsed;
    }

    // ── Search Discogs ──
    const query = manualQuery || (aiResult.artist && aiResult.album ? `${aiResult.artist} ${aiResult.album}` : aiResult.album || aiResult.artist);
    const searchRes = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=5`,
      { headers: discogsHeaders }
    );
    const searchJson = await searchRes.json();
    const results = searchJson.results || [];

    const discogsResults = results.slice(0, 5).map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      label: r.label?.[0],
      cover: r.cover_image && !r.cover_image.includes("spacer") ? r.cover_image : null,
      country: r.country,
    }));

    if (results.length === 0) {
      return res.status(200).json({
        artist: aiResult?.artist || "", album: aiResult?.album || "",
        year: aiResult?.year || "", genre: aiResult?.genre || "",
        label: aiResult?.label || "", tracks: aiResult?.tracks || [],
        coverUrl: null, discogsResults: [], needsManualSearch: true,
      });
    }

    // Fetch full details of top result
    const top = results[0];
    const releaseRes = await fetch(`https://api.discogs.com/releases/${top.id}`, { headers: discogsHeaders });
    const rel = await releaseRes.json();

    const tracks = (rel.tracklist || [])
      .filter(t => t.type_ === "track")
      .map(t => {
        const artist = t.artists?.map(a => a.name.replace(/\s*\(\d+\)$/, "")).join(", ");
        return artist ? `${artist} - ${t.title}` : t.title;
      });

    return res.status(200).json({
      artist: rel.artists_sort || aiResult?.artist || "",
      album: rel.title || aiResult?.album || "",
      year: rel.year || aiResult?.year || "",
      genre: rel.genres?.[0] || rel.styles?.[0] || aiResult?.genre || "",
      label: rel.labels?.[0]?.name || aiResult?.label || "",
      tracks: tracks.length ? tracks : (aiResult?.tracks || []),
      coverUrl: rel.images?.[0]?.uri || (top.cover_image && !top.cover_image.includes("spacer") ? top.cover_image : null),
      confidence: aiResult?.confidence || "medium",
      discogsResults,
    });

  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
