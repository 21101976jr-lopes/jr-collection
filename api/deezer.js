const VERSION_RULES = [
  ["live", /\b(live|ao vivo|en vivo|in concert)\b/i],
  ["acoustic", /\b(acoustic|acustic[oa])\b/i],
  ["remix", /\bremix(ed)?\b/i],
  ["radio_edit", /\bradio\s+edit\b/i],
  ["demo", /\bdemo\b/i],
  ["cover", /\bcover\b/i],
  ["tribute", /\btribute\b|\btributo\b/i],
  ["karaoke", /\bkaraoke\b/i],
  ["remaster", /\bremaster(ed)?\b/i],
];

const normalizeText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const getVersionTypes = (...values) => {
  const text = values.filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return new Set(VERSION_RULES.filter(([, pattern]) => pattern.test(text)).map(([type]) => type));
};

const stripVersionParts = (value) => {
  let text = String(value || "");
  for (const [, pattern] of VERSION_RULES) {
    text = text.replace(new RegExp(`\\([^)]*${pattern.source}[^)]*\\)`, "ig"), " ");
    text = text.replace(new RegExp(`\\[[^\\]]*${pattern.source}[^\\]]*\\]`, "ig"), " ");
  }
  return normalizeText(text);
};

const normalizeAlbum = (value) => normalizeText(value)
  .replace(/\b(deluxe|expanded|anniversary|special)\s+(edition|version)\b/g, " ")
  .replace(/\b(deluxe|expanded)\b$/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const versionsMatch = (expected, candidate) => {
  if (expected.size !== candidate.size) return false;
  return [...expected].every(type => candidate.has(type));
};

const evaluateCandidate = (item, requested) => {
  const candidateArtist = item.artist?.name || "";
  const candidateAlbum = item.album?.title || "";
  const candidateTitle = item.title_short || item.title || "";
  const expectedVersions = getVersionTypes(requested.track, requested.album);
  const candidateVersions = getVersionTypes(item.title, item.title_version, candidateArtist, candidateAlbum);

  if (normalizeText(candidateArtist) !== normalizeText(requested.artist)) {
    return { accepted: false, reason: "artist_mismatch" };
  }
  if (stripVersionParts(candidateTitle) !== stripVersionParts(requested.track)) {
    return { accepted: false, reason: "title_mismatch" };
  }
  if (normalizeAlbum(candidateAlbum) !== normalizeAlbum(requested.album)) {
    return { accepted: false, reason: "album_mismatch" };
  }
  if (!versionsMatch(expectedVersions, candidateVersions)) {
    return { accepted: false, reason: "version_mismatch" };
  }
  if (!item.preview) return { accepted: false, reason: "preview_missing" };

  let score = 300;
  if (normalizeText(item.title || "") === normalizeText(requested.track)) score += 20;
  if (Number(requested.position) && Number(item.track_position) === Number(requested.position)) score += 5;
  if (Number(requested.year) && String(item.album?.release_date || "").startsWith(String(requested.year))) score += 3;
  const confidenceScore = score;
  score += Math.min(Number(item.rank) || 0, 1000000) / 1000000;
  return { accepted: true, score, confidenceScore };
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { track, artist, album, year, position } = req.query;
  if (!track || !artist || !album) {
    return res.status(400).json({ error: "track, artist and album are required", results: [] });
  }

  try {
    const q = encodeURIComponent(`${artist} ${track}`.trim());
    const response = await fetch(
      `https://api.deezer.com/search?q=${q}&limit=10&output=json`
    );
    if (!response.ok) throw new Error(`Deezer returned ${response.status}`);
    const data = await response.json();

    const requested = { track, artist, album, year, position };
    const approved = (data.data || [])
      .map(item => ({ item, evaluation: evaluateCandidate(item, requested) }))
      .filter(({ evaluation }) => evaluation.accepted)
      .sort((a, b) => b.evaluation.score - a.evaluation.score);

    if (approved.length > 1 && approved[0].evaluation.confidenceScore === approved[1].evaluation.confidenceScore) {
      return res.status(200).json({ results: [] });
    }

    const results = approved.slice(0, 1).map(({ item }) => ({
      id: item.id,
      title: item.title,
      title_short: item.title_short,
      title_version: item.title_version,
      artist: item.artist?.name,
      artist_id: item.artist?.id,
      album: item.album?.title,
      album_id: item.album?.id,
      duration: item.duration,
      track_position: item.track_position,
      rank: item.rank,
      preview: item.preview,
      cover: item.album?.cover_small,
    }));

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
