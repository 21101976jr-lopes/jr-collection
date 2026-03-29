export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Imagem não enviada" });

    // Step 1: Identify album with Claude AI
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
            { type: "text", text: `Você está vendo a capa de um disco de vinil (LP). Identifique o álbum e retorne SOMENTE um objeto JSON válido, sem markdown, sem explicação. Formato exato:\n{"artist":"Nome do artista","album":"Nome do álbum","year":1979,"genre":"Gênero","label":"Gravadora","tracks":["Faixa 1","Faixa 2"],"confidence":"high|medium|low"}\nSe não conseguir identificar, retorne: {"error":"não identificado"}` }
          ]
        }]
      })
    });

    const aiData = await aiRes.json();
    const raw = aiData.content?.map(b => b.text || "").join("").trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (parsed.error) return res.status(200).json({ error: "não identificado" });

    // Step 2: Search Discogs — has extensive Brazilian catalog including novelas
    let coverUrl = null;
    let discogsData = {};
    try {
      const discogsHeaders = {
        "User-Agent": "JrCollectionApp/1.0",
        "Authorization": `Discogs token=${process.env.DISCOGS_TOKEN}`
      };

      const searchQuery = encodeURIComponent(`${parsed.artist} ${parsed.album}`);
      const searchRes = await fetch(
        `https://api.discogs.com/database/search?q=${searchQuery}&type=release&per_page=3`,
        { headers: discogsHeaders }
      );
      const searchJson = await searchRes.json();
      const results = searchJson.results || [];

      if (results.length > 0) {
        const top = results[0];

        // Cover image from Discogs
        if (top.cover_image && !top.cover_image.includes("spacer")) {
          coverUrl = top.cover_image;
        }

        // Basic data from search result
        if (top.year) discogsData.year = parseInt(top.year);
        if (top.label?.length) discogsData.label = top.label[0];
        if (top.genre?.length) discogsData.genre = top.genre[0];

        // Get full tracklist from release detail
        if (top.id) {
          const releaseRes = await fetch(
            `https://api.discogs.com/releases/${top.id}`,
            { headers: discogsHeaders }
          );
          const releaseJson = await releaseRes.json();

          if (releaseJson.tracklist?.length > 0) {
            discogsData.tracks = releaseJson.tracklist
              .filter(t => t.type_ === "track")
              .map(t => t.title);
          }
          if (releaseJson.artists_sort) discogsData.artist = releaseJson.artists_sort;
          if (releaseJson.title) discogsData.album = releaseJson.title;
          if (releaseJson.labels?.[0]?.name) discogsData.label = releaseJson.labels[0].name;
          if (releaseJson.genres?.[0]) discogsData.genre = releaseJson.genres[0];
          if (releaseJson.year) discogsData.year = releaseJson.year;
          // Better cover from release images
          if (releaseJson.images?.[0]?.uri) coverUrl = releaseJson.images[0].uri;
        }
      }
    } catch {}

    // Merge: Discogs takes priority over AI when available
    return res.status(200).json({
      artist: discogsData.artist || parsed.artist,
      album:  discogsData.album  || parsed.album,
      year:   discogsData.year   || parsed.year,
      genre:  discogsData.genre  || parsed.genre,
      label:  discogsData.label  || parsed.label,
      tracks: discogsData.tracks?.length ? discogsData.tracks : (parsed.tracks || []),
      coverUrl,
    });

  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
