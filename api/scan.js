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

    // Step 2: Try to fetch cover art from MusicBrainz + Cover Art Archive
    let coverUrl = null;
    try {
      const mbQuery = encodeURIComponent(`release:"${parsed.album}" AND artist:"${parsed.artist}"`);
      const mbRes = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${mbQuery}&fmt=json&limit=3`,
        { headers: { "User-Agent": "JrCollection/1.0 (vinyl-catalog)" } }
      );
      const mbData = await mbRes.json();
      const releases = mbData.releases || [];
      for (const release of releases) {
        try {
          const coverRes = await fetch(`https://coverartarchive.org/release/${release.id}/front`, { redirect: "follow" });
          if (coverRes.ok) { coverUrl = coverRes.url; break; }
        } catch {}
      }
    } catch {}

    return res.status(200).json({ ...parsed, coverUrl });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
