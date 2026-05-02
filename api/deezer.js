export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { track, artist } = req.query;
  if (!track) return res.status(400).json({ error: "track is required" });

  try {
    const q = encodeURIComponent(`${artist || ""} ${track}`.trim());
    const response = await fetch(
      `https://api.deezer.com/search?q=${q}&limit=3&output=json`
    );
    const data = await response.json();

    const results = (data.data || []).map(item => ({
      title: item.title,
      artist: item.artist?.name,
      preview: item.preview,
      cover: item.album?.cover_small,
    })).filter(r => r.preview);

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
