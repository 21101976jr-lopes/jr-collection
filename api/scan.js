export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, manualQuery } = req.body;

    const discogsHeaders = {
      "User-Agent": "JrCollectionApp/1.0",
      "Authorization": `Discogs token=${process.env.DISCOGS_TOKEN}`
    };

    let aiResult = null;

    // If manual query provided, skip AI and go straight to Discogs
    if (manualQuery) {
      aiResult = { artist: "", album: manualQuery, query: manualQuery };
    } else {
      // Step 1: Identify with Claude AI — improved prompt for Brazilian records
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
              { type: "text", text: `Você é um especialista em discos de vinil, incluindo música brasileira, trilhas de novelas, coletâneas, sertanejo, MPB, axé, pagode e todo tipo de disco nacional e internacional.

Analise CUIDADOSAMENTE esta capa de disco de vinil. Leia TODO o texto visível na imagem: título, nome do artista, gravadora, ano, qualquer texto escrito na capa.

Retorne SOMENTE um objeto JSON válido, sem markdown, sem explicação:
{
  "artist": "Nome exato do artista/banda como aparece na capa",
  "album": "Nome exato do álbum como aparece na capa",
  "year": 1979,
  "genre": "Gênero musical",
  "label": "Gravadora se visível",
  "tracks": ["Faixa 1", "Faixa 2"],
  "confidence": "high|medium|low",
  "visibleText": "todo texto que você consegue ler na capa"
}

Se não conseguir identificar absolutamente nada, retorne: {"error":"não identificado"}` }
            ]
          }]
        })
      });

      const aiData = await aiRes.json();
      const raw = aiData.content?.map(b => b.text || "").join("").trim();
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

      if (parsed.error) {
        return res.status(200).json({ error: "não identificado", needsManualSearch: true });
      }
      aiResult = parsed;
    }

    // Step 2: Search Discogs with the identified name
    let coverUrl = null;
    let discogsData = {};
    let discogsResults = [];

    try {
      // Build best possible query
      const query = manualQuery || 
        (aiResult.artist && aiResult.album ? `${aiResult.artist} ${aiResult.album}` : aiResult.album || aiResult.artist);
      
      const searchQuery = encodeURIComponent(query);
      const searchRes = await fetch(
        `https://api.discogs.com/database/search?q=${searchQuery}&type=release&per_page=5`,
        { headers: discogsHeaders }
      );
      const searchJson = await searchRes.json();
      const results = searchJson.results || [];

      // Return top results so user can pick if needed
      discogsResults = results.slice(0, 5).map(r => ({
        id: r.id,
        title: r.title,
        year: r.year,
        label: r.label?.[0],
        cover: r.cover_image && !r.cover_image.includes("spacer") ? r.cover_image : null,
        country: r.country,
      }));

      if (results.length > 0) {
        const top = results[0];
        if (top.cover_image && !top.cover_image.includes("spacer")) {
          coverUrl = top.cover_image;
        }
        if (top.year) discogsData.year = parseInt(top.year);
        if (top.label?.length) discogsData.label = top.label[0];
        if (top.genre?.length) discogsData.genre = top.genre[0];

        // Get full tracklist
        if (top.id) {
          const releaseRes = await fetch(
            `https://api.discogs.com/releases/${top.id}`,
            { headers: discogsHeaders }
          );
          const releaseJson = await releaseRes.json();

          if (releaseJson.tracklist?.length > 0) {
            discogsData.tracks = releaseJson.tracklist
              .filter(t => t.type_ === "track")
              .map(t => {
                // If track has its own artist (compilations, novela soundtracks), include it
                const trackArtist = t.artists?.map(a => a.name.replace(/\s*\(\d+\)$/, "")).join(", ");
                return trackArtist ? `${trackArtist} - ${t.title}` : t.title;
              });
          }
          if (releaseJson.artists_sort) discogsData.artist = releaseJson.artists_sort;
          if (releaseJson.title) discogsData.album = releaseJson.title;
          if (releaseJson.labels?.[0]?.name) discogsData.label = releaseJson.labels[0].name;
          if (releaseJson.genres?.[0]) discogsData.genre = releaseJson.genres[0];
          if (releaseJson.year) discogsData.year = releaseJson.year;
          if (releaseJson.images?.[0]?.uri) coverUrl = releaseJson.images[0].uri;
        }
      }
    } catch {}

    return res.status(200).json({
      artist: discogsData.artist || aiResult?.artist || "",
      album:  discogsData.album  || aiResult?.album  || "",
      year:   discogsData.year   || aiResult?.year   || "",
      genre:  discogsData.genre  || aiResult?.genre  || "",
      label:  discogsData.label  || aiResult?.label  || "",
      tracks: discogsData.tracks?.length ? discogsData.tracks : (aiResult?.tracks || []),
      coverUrl,
      confidence: aiResult?.confidence || "medium",
      visibleText: aiResult?.visibleText || "",
      discogsResults, // top results so user can pick alternative
      needsManualSearch: discogsResults.length === 0,
    });

  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
