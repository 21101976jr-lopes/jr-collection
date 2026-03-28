export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Imagem não enviada" });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
            { type: "text", text: `Você está vendo a capa de um disco de vinil (LP). Identifique o álbum e retorne SOMENTE um objeto JSON válido, sem markdown, sem explicação. Formato exato:
{"artist":"Nome do artista","album":"Nome do álbum","year":1979,"genre":"Gênero","label":"Gravadora","tracks":["Faixa 1","Faixa 2"],"confidence":"high|medium|low"}
Se não conseguir identificar, retorne: {"error":"não identificado"}` }
          ]
        }]
      })
    });

    const data = await response.json();
    const raw = data.content?.map(b => b.text || "").join("").trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Erro interno: " + e.message });
  }
}
