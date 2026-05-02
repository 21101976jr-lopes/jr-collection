import { useState, useRef, useCallback, useMemo, useEffect } from "react";

const STORAGE_KEY = "jr-collection-records";
const DB_NAME = "JrCollectionDB";
const DB_VERSION = 1;

// ── IndexedDB for covers (supports hundreds of MB) ────────────────────────
let _db = null;
const openDB = () => new Promise((resolve, reject) => {
  if (_db) { resolve(_db); return; }
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers");
  };
  req.onsuccess = e => { _db = e.target.result; resolve(_db); };
  req.onerror = () => reject(req.error);
});

const dbGetCover = async (id) => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction("covers", "readonly");
      const req = tx.objectStore("covers").get(String(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
};

const dbSetCover = async (id, dataUrl) => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction("covers", "readwrite");
      if (dataUrl) tx.objectStore("covers").put(dataUrl, String(id));
      else tx.objectStore("covers").delete(String(id));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch { return false; }
};

const dbGetAllCovers = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction("covers", "readonly");
      const store = tx.objectStore("covers");
      const result = {};
      store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { result[cursor.key] = cursor.value; cursor.continue(); }
        else resolve(result);
      };
    });
  } catch { return {}; }
};

// ── localStorage for catalog data (text only, small) ─────────────────────
const loadRecords = () => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
};

const saveRecords = (records) => {
  try {
    // Save catalog WITHOUT photos (keep localStorage small)
    const slim = records.map(({ coverPhoto, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch(e) { console.error("Save error:", e); }
};

// Save single cover to IndexedDB
const saveSingleCover = async (id, dataUrl) => {
  await dbSetCover(id, dataUrl);
};

// Compress image to max ~100KB — aggressive but good quality for album art
const compressImage = (dataUrl, maxWidth = 500) => new Promise(resolve => {
  if (!dataUrl) { resolve(null); return; }
  if (dataUrl.startsWith("http")) { resolve(dataUrl); return; }
  if (!dataUrl.startsWith("data:image")) { resolve(dataUrl); return; }
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height, 1));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        // Start with quality 0.7, reduce if still too big
        let result = canvas.toDataURL("image/jpeg", 0.7);
        if (result.length > 150000) result = canvas.toDataURL("image/jpeg", 0.5);
        if (result.length > 150000) result = canvas.toDataURL("image/jpeg", 0.35);
        resolve(result && result.length > 100 ? result : dataUrl);
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  } catch { resolve(dataUrl); }
});

// Download a Discogs URL and convert to compressed base64
// This prevents expiring URLs — photo is stored permanently
const fetchAndCompressUrl = (url) => new Promise(resolve => {
  if (!url || !url.startsWith("http")) { resolve(url); return; }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      const maxW = 500;
      const scale = Math.min(1, maxW / Math.max(img.width, img.height, 1));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      let result = canvas.toDataURL("image/jpeg", 0.7);
      if (result.length > 150000) result = canvas.toDataURL("image/jpeg", 0.5);
      resolve(result && result.length > 100 ? result : url);
    } catch { resolve(url); }
  };
  img.onerror = () => resolve(url); // keep URL if download fails
  img.src = url;
});

// Export catalog as JSON file
const exportCatalog = (records) => {
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jr-collection-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// Import catalog from JSON file
const importCatalog = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      const records = data.records || data; // support both formats
      if (Array.isArray(records)) resolve(records);
      else reject(new Error("Formato inválido"));
    } catch { reject(new Error("Arquivo inválido")); }
  };
  reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
  reader.readAsText(file);
});

// ── Deezer 30s preview ───────────────────────────────────────────────────
const useDeezerPreview = () => {
  const [playing, setPlaying] = React.useState(null); // track name playing
  const [loading, setLoading] = React.useState(null);
  const audioRef = React.useRef(null);

  const searchAndPlay = async (trackName, artist) => {
    // If same track, toggle pause/play
    if (playing === trackName) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlaying(null);
      return;
    }

    // Stop current
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(null);
    setLoading(trackName);

    try {
      // Extract just the song title (remove "Artist - " prefix from compilations)
      const songTitle = trackName.includes(" - ")
        ? trackName.split(" - ").slice(1).join(" - ")
        : trackName;
      const searchArtist = trackName.includes(" - ")
        ? trackName.split(" - ")[0]
        : artist;

      const q = encodeURIComponent(`${searchArtist} ${songTitle}`);
      const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1&output=json`);
      const data = await res.json();
      const preview = data.data?.[0]?.preview;

      if (!preview) { setLoading(null); alert("Prévia não disponível para esta música."); return; }

      const audio = new Audio(preview);
      audioRef.current = audio;
      audio.volume = 0.8;
      audio.onended = () => { setPlaying(null); audioRef.current = null; };
      audio.onerror = () => { setPlaying(null); setLoading(null); audioRef.current = null; };
      await audio.play();
      setPlaying(trackName);
    } catch { alert("Erro ao buscar prévia."); }
    setLoading(null);
  };

  const stop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(null);
  };

  return { playing, loading, searchAndPlay, stop };
};

const DEMO_DATA = [
  { id: 1, tipo: "banda", artist: "Pink Floyd", album: "The Wall - Disco 1", year: 1979, genre: "Rock Progressivo", label: "Harvest", washed: true, washedDate: "2024-10-15", scratches: false, coverPhoto: null, coverEmoji: "🎸", tracks: ["In the Flesh?","The Thin Ice","Another Brick in the Wall Pt.1","The Happiest Days","Another Brick in the Wall Pt.2","Mother","Goodbye Blue Sky","Empty Spaces","Young Lust","One of My Turns"] },
  { id: 2, tipo: "banda", artist: "Pink Floyd", album: "The Wall - Disco 2", year: 1979, genre: "Rock Progressivo", label: "Harvest", washed: false, washedDate: "2023-03-01", scratches: false, coverPhoto: null, coverEmoji: "🎸", tracks: ["Don't Leave Me Now","Another Brick in the Wall Pt.3","Goodbye Cruel World","Hey You","Is There Anybody Out There?","Nobody Home","Vera","Bring the Boys Back Home","Comfortably Numb","The Show Must Go On","In the Flesh","Run Like Hell","Waiting for the Worms","Stop","The Trial","Outside the Wall"] },
  { id: 3, tipo: "banda", artist: "Pink Floyd", album: "Dark Side of the Moon", year: 1973, genre: "Rock Progressivo", label: "Harvest", washed: false, washedDate: "2022-01-01", scratches: false, coverPhoto: null, coverEmoji: "🌑", tracks: ["Speak to Me","Breathe","On the Run","Time","The Great Gig in the Sky","Money","Us and Them","Brain Damage","Eclipse"] },
  { id: 4, tipo: "coletanea", artist: "Vários Artistas", album: "Rock in Rio Vol. 1", year: 1985, genre: "Coletânea", label: "CBS", washed: true, washedDate: "2025-01-20", scratches: true, coverPhoto: null, coverEmoji: "🎪", tracks: ["Queen - Bohemian Rhapsody","AC/DC - Back in Black","Rod Stewart - Do Ya Think I'm Sexy","Ozzy Osbourne - Crazy Train","Iron Maiden - The Trooper"] },
];

const monthsAgo = (d) => (new Date() - new Date(d)) / (1000 * 60 * 60 * 24 * 30);

const washInfo = (washed, washedDate) => {
  if (!washed) return { color: "#e74c3c", glow: "#e74c3c33", label: "Não lavado", key: "red" };
  const m = monthsAgo(washedDate);
  if (m > 12) return { color: "#f39c12", glow: "#f39c1233", label: "Lavado há mais de 1 ano", key: "yellow" };
  return              { color: "#2ecc71", glow: "#2ecc7133", label: "Lavado recentemente", key: "green" };
};

const WashBadge = ({ washed, washedDate }) => {
  const { color, glow, label } = washInfo(washed, washedDate);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: glow, border: `1px solid ${color}44`, borderRadius: 20, padding: "4px 12px 4px 8px" }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0, display: "inline-block" }} />
      <span style={{ fontSize: 13, color, fontFamily: "monospace" }}>{label}</span>
    </span>
  );
};

const WashDot = ({ washed, washedDate }) => {
  const { color, glow } = washInfo(washed, washedDate);
  return <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, boxShadow: `0 0 0 3px ${glow}`, flexShrink: 0, display: "inline-block" }} />;
};

const VinylSVG = ({ size = 36, spin = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={spin ? { animation: "spin 2.5s linear infinite" } : {}}>
    <circle cx="50" cy="50" r="48" fill="#111" stroke="#2a2a2a" strokeWidth="2" />
    {[40, 32, 24, 16].map(r => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#1e1e1e" strokeWidth="1.5" />)}
    <circle cx="50" cy="50" r="10" fill="#c0392b" />
    <circle cx="50" cy="50" r="4" fill="#0a0a0a" />
  </svg>
);

const PhotoPicker = ({ value, onChange }) => {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {value
        ? <img src={value} alt="capa" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8, border: "2px solid #c0392b" }} />
        : <div style={{ width: 100, height: 100, background: "#111", borderRadius: 8, border: "2px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>💿</div>
      }
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" style={pBtn} onClick={() => camRef.current.click()}>📷 Câmera</button>
        <button type="button" style={pBtn} onClick={() => fileRef.current.click()}>🖼 Galeria</button>
        {value && <button type="button" style={{ ...pBtn, color: "#e74c3c", borderColor: "#e74c3c44" }} onClick={() => onChange(null)}>✕ Remover</button>}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f); }} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f); }} />
    </div>
  );
};
const pBtn = { background: "transparent", border: "1px solid #2a2a2a", color: "#aaa", borderRadius: 4, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontFamily: "monospace" };

// ── Scanner ───────────────────────────────────────────────────────────────
function ScanOverlay({ onClose, onDetected }) {
  const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null), fileRef = useRef(null);
  const [phase, setPhase] = useState("camera"); // camera|preview|analyzing|result|manual|error
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [camErr, setCamErr] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [altResults, setAltResults] = useState([]);

  const startCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
    } catch { setCamErr(true); }
  }, []);
  const stopCam = useCallback(() => streamRef.current?.getTracks().forEach(t => t.stop()), []);
  useEffect(() => { startCam(); return stopCam; }, [startCam, stopCam]);

  const snap = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    stopCam(); setPreview(c.toDataURL("image/jpeg", 0.85)); setPhase("preview");
  };
  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => { stopCam(); setPreview(ev.target.result); setPhase("preview"); };
    r.readAsDataURL(file);
  };

  const analyze = async (imageBase64, manual) => {
    setPhase("analyzing");
    try {
      const body = manual
        ? { manualQuery: manual }
        : { imageBase64: imageBase64.split(",")[1] };

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const parsed = await res.json();

      if (parsed.error) {
        setErrMsg("Não consegui identificar. Digite o nome do disco abaixo para buscar.");
        setPhase("manual");
      } else {
        setResult(parsed);
        setAltResults(parsed.discogsResults || []);
        setPhase("result");
        // If not found on Discogs but AI identified, set a warning flag
        if (parsed.foundOnDiscogs === false) {
          setErrMsg("Disco não encontrado no Discogs. Dados preenchidos pela IA — confira e complete as faixas.");
        } else {
          setErrMsg("");
        }
      }
    } catch {
      setErrMsg("Erro ao analisar. Verifique sua conexão.");
      setPhase("manual");
    }
  };

  const searchManual = async () => {
    if (!manualQuery.trim()) return;
    setSearching(true);
    await analyze(null, manualQuery.trim());
    setSearching(false);
  };

  const pickAlt = async (altId) => {
    setPhase("analyzing");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsId: altId })
      });
      const parsed = await res.json();
      if (!parsed.error) { setResult(parsed); setAltResults(parsed.discogsResults || []); setPhase("result"); }
      else { setPhase("result"); }
    } catch { setPhase("result"); }
  };

  const retry = () => { setPreview(null); setResult(null); setErrMsg(""); setManualQuery(""); setAltResults([]); setPhase("camera"); startCam(); };

  const rb = "2px solid #c0392b";
  const btn = (p, color) => ({
    background: p ? (color||"#c0392b") : "transparent",
    border: `1px solid ${p ? (color||"#c0392b") : "#444"}`,
    color: p ? "#fff" : "#999",
    borderRadius: 4, padding: "12px 24px", cursor: "pointer", fontSize: 15, fontFamily: "monospace"
  });

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:1000, display:"flex", flexDirection:"column", fontFamily:"'Georgia',serif" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:"1px solid #1a1a1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}><VinylSVG size={24}/><span style={{ fontSize:14, fontFamily:"monospace", letterSpacing:2, color:"#888", textTransform:"uppercase" }}>Escanear capa</span></div>
        <button style={{ background:"transparent", border:"1px solid #333", color:"#777", borderRadius:3, padding:"7px 16px", cursor:"pointer", fontSize:14, fontFamily:"monospace" }} onClick={() => { stopCam(); onClose(); }}>✕ Fechar</button>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, gap:20, overflowY:"auto" }}>

        {/* Camera */}
        {phase==="camera" && !camErr && (<>
          <p style={{ fontSize:15, fontFamily:"monospace", color:"#666", textAlign:"center" }}>Aponte para a capa do disco e fotografe</p>
          <div style={{ position:"relative", width:"100%", maxWidth:460 }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width:"100%", borderRadius:8, border:"2px solid #1e1e1e", background:"#111", display:"block" }} />
            {[{top:8,left:8,borderTop:rb,borderLeft:rb},{top:8,right:8,borderTop:rb,borderRight:rb},{bottom:8,left:8,borderBottom:rb,borderLeft:rb},{bottom:8,right:8,borderBottom:rb,borderRight:rb}].map((s,i)=><div key={i} style={{ position:"absolute", width:24, height:24, ...s }}/>)}
          </div>
          <canvas ref={canvasRef} style={{ display:"none" }}/>
          <button style={{ width:80, height:80, borderRadius:"50%", background:"#c0392b", border:"4px solid #fff", cursor:"pointer", fontSize:32, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={snap}>📷</button>
          <button style={btn(false)} onClick={() => fileRef.current.click()}>📁 Usar foto da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleFile}/>
        </>)}

        {phase==="camera" && camErr && (<>
          <div style={{ fontSize:52 }}>📷</div>
          <p style={{ fontFamily:"monospace", fontSize:15, color:"#666", lineHeight:1.7, textAlign:"center" }}>Câmera não disponível.<br/>Use uma foto da galeria.</p>
          <button style={btn(true)} onClick={() => fileRef.current.click()}>📁 Escolher da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleFile}/>
        </>)}

        {/* Preview */}
        {phase==="preview" && (<>
          <p style={{ fontSize:15, fontFamily:"monospace", color:"#666", textAlign:"center" }}>A foto ficou boa?</p>
          <img src={preview} alt="preview" style={{ width:"100%", maxWidth:380, borderRadius:8, border:"2px solid #1e1e1e" }}/>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", justifyContent:"center" }}>
            <button style={btn(false)} onClick={retry}>↩ Tirar outra</button>
            <button style={btn(true)} onClick={() => analyze(preview, null)}>🔍 Identificar disco</button>
          </div>
        </>)}

        {/* Analyzing */}
        {phase==="analyzing" && (<>
          <div style={{ width:50, height:50, borderRadius:"50%", border:"3px solid #1e1e1e", borderTop:"3px solid #c0392b", animation:"spin 0.8s linear infinite" }}/>
          <p style={{ fontSize:15, fontFamily:"monospace", color:"#666" }}>Buscando disco…</p>
          <VinylSVG size={48} spin/>
        </>)}

        {/* Result */}
        {phase==="result" && result && (<>
          <p style={{ fontFamily:"monospace", color: result.foundOnDiscogs===false ? "#f39c12" : "#2ecc71", fontSize:14, textAlign:"center" }}>
            {result.foundOnDiscogs===false ? "⚠ Identificado pela IA (não encontrado no Discogs)" : "✓ Disco identificado!"}
          </p>
          {errMsg && result.foundOnDiscogs===false && (
            <p style={{ fontFamily:"monospace", color:"#f39c12", fontSize:12, textAlign:"center", maxWidth:420, lineHeight:1.6 }}>{errMsg}</p>
          )}
          <div style={{ width:"100%", maxWidth:460, background:"#0e0e0e", border:"1px solid #222", borderRadius:8, overflow:"hidden" }}>
            <div style={{ display:"flex", gap:0 }}>
              {result.coverUrl && <img src={result.coverUrl} alt="capa" style={{ width:110, height:110, objectFit:"cover", flexShrink:0 }}/>}
              <div style={{ padding:14, flex:1 }}>
                <div style={{ fontSize:12, color:"#c0392b", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{result.artist}</div>
                <div style={{ fontSize:19, color:"#f0ece4", marginBottom:3, lineHeight:1.2 }}>{result.album}</div>
                <div style={{ fontSize:12, color:"#555", fontFamily:"monospace" }}>{result.year} · {result.label}</div>
              </div>
            </div>
            {result.tracks?.length > 0 && (
              <div style={{ maxHeight:130, overflowY:"auto", borderTop:"1px solid #1a1a1a", padding:"8px 14px" }}>
                {result.tracks.map((t,i)=><div key={i} style={{ fontSize:13, fontFamily:"monospace", color:"#777", padding:"3px 0" }}><span style={{ color:"#2a2a2a", marginRight:10 }}>{String(i+1).padStart(2,"0")}</span>{t}</div>)}
              </div>
            )}
          </div>

          {/* Alternative results from Discogs */}
          {altResults.length > 1 && (
            <div style={{ width:"100%", maxWidth:460 }}>
              <p style={{ fontSize:12, fontFamily:"monospace", color:"#555", marginBottom:8 }}>Não é esse? Veja outras opções:</p>
              {altResults.slice(1).map(r => (
                <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"#0e0e0e", border:"1px solid #1a1a1a", borderRadius:6, marginBottom:6, cursor:"pointer" }}
                  onClick={() => pickAlt(r.id)}>
                  {r.cover ? <img src={r.cover} alt="" style={{ width:40, height:40, objectFit:"cover", borderRadius:4 }}/> : <div style={{ width:40, height:40, background:"#111", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>💿</div>}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:"#ddd", fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.title}</div>
                    <div style={{ fontSize:11, color:"#555", fontFamily:"monospace" }}>{r.year} · {r.label} · {r.country}</div>
                  </div>
                  <span style={{ color:"#c0392b", fontSize:18 }}>›</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ width:"100%", maxWidth:460, background:"#1a0a0a", border:"1px solid #c0392b33", borderRadius:8, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
            <span style={{ fontSize:13, fontFamily:"monospace", color:"#888" }}>Disco errado?</span>
            <button style={{ background:"#c0392b22", border:"1px solid #c0392b66", color:"#ff8080", borderRadius:4, padding:"9px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace" }}
              onClick={() => { setPhase("manual"); setManualQuery(""); }}>
              ✏️ Corrigir — buscar pelo nome
            </button>
          </div>
          <button style={btn(true)} onClick={() => onDetected(result)}>+ Adicionar ao catálogo</button>
        </>)}

        {/* Manual search */}
        {phase==="manual" && (<>
          {errMsg && <p style={{ fontFamily:"monospace", color:"#f39c12", fontSize:14, textAlign:"center", maxWidth:340 }}>{errMsg}</p>}
          <p style={{ fontFamily:"monospace", color:"#888", fontSize:14, textAlign:"center" }}>Digite o nome do disco para buscar no Discogs:</p>
          <div style={{ width:"100%", maxWidth:420, display:"flex", flexDirection:"column", gap:10 }}>
            <input
              style={{ width:"100%", background:"#111", border:"1px solid #c0392b55", borderRadius:6, padding:"13px 16px", color:"#f0ece4", fontSize:16, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }}
              placeholder="Ex: Final Feliz Internacional"
              value={manualQuery}
              onChange={e => setManualQuery(e.target.value)}
              onKeyDown={e => e.key==="Enter" && searchManual()}
              autoFocus
            />
            <button style={{ ...btn(true), opacity: searching||!manualQuery.trim() ? 0.6 : 1 }} onClick={searchManual} disabled={searching||!manualQuery.trim()}>
              {searching ? "Buscando…" : "🔍 Buscar no Discogs"}
            </button>
          </div>
          <button style={btn(false)} onClick={retry}>↩ Tirar outra foto</button>
        </>)}

        {/* Error */}
        {phase==="error" && (<>
          <div style={{ fontSize:48, textAlign:"center" }}>🔍</div>
          <p style={{ fontFamily:"monospace", color:"#e74c3c", fontSize:14, textAlign:"center", maxWidth:340 }}>{errMsg}</p>
          <button style={btn(true)} onClick={retry}>↩ Tentar novamente</button>
        </>)}

      </div>
    </div>
  );
}

// ── Form fields helper ────────────────────────────────────────────────────
const EMPTY_FORM = { artist: "", album: "", year: "", genre: "", label: "", tipo: "banda", location: "", washed: false, washedDate: new Date().toISOString().split("T")[0], scratches: false, tracks: "", coverPhoto: null, coverEmoji: "💿" };

const fStyle = { width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 4, padding: "11px 14px", color: "#f0ece4", fontSize: 16, fontFamily: "monospace", outline: "none", boxSizing: "border-box" };
const lStyle = { display: "block", fontSize: 12, fontFamily: "monospace", color: "#666", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" };

function RecordForm({ initial, onSave, onCancel, title }) {
  const [form, setForm] = useState(initial);
  const [discogsQuery, setDiscogsQuery] = useState("");
  const [discogsResults, setDiscogsResults] = useState([]);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [showDiscogs, setShowDiscogs] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const searchDiscogs = async () => {
    if (!discogsQuery.trim()) return;
    setDiscogsLoading(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualQuery: discogsQuery.trim() })
      });
      const data = await res.json();
      if (!data.error) {
        // Show results list for user to pick — do NOT auto-fill
        const allResults = data.discogsResults || [];
        // Add the top result to list if not already there
        if (data.album && !allResults.find(r => r.title === data.album)) {
          allResults.unshift({
            id: null, // will re-fetch by name
            title: `${data.artist} - ${data.album}`,
            year: data.year,
            label: data.label,
            cover: data.coverUrl,
            country: "",
            _fullData: data, // carry full data for instant fill
          });
        }
        setDiscogsResults(allResults.length ? allResults : []);
        if (allResults.length === 0) {
          // Nothing found at all — fill with what AI got
          setForm(p => ({
            ...p,
            artist: data.artist || p.artist,
            album: data.album || p.album,
            year: String(data.year || p.year),
            genre: data.genre || p.genre,
            label: data.label || p.label,
            tracks: Array.isArray(data.tracks) ? data.tracks.join("\n") : (data.tracks || p.tracks),
            coverPhoto: data.coverUrl || p.coverPhoto,
          }));
          setShowDiscogs(false);
          alert("Nenhum resultado encontrado. Preencha manualmente.");
        }
      }
    } catch {}
    setDiscogsLoading(false);
  };

  const pickDiscogsResult = async (r) => {
    setDiscogsLoading(true);
    try {
      let data;
      if (r._fullData) {
        data = r._fullData;
      } else {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discogsId: r.id })
        });
        data = await res.json();
      }
      if (!data.error) {
        setForm(p => ({
          ...p,
          artist: data.artist || p.artist,
          album: data.album || p.album,
          year: String(data.year || p.year),
          genre: data.genre || p.genre,
          label: data.label || p.label,
          tracks: Array.isArray(data.tracks) ? data.tracks.join("\n") : (data.tracks || p.tracks),
          coverPhoto: data.coverUrl || p.coverPhoto,
        }));
        setShowDiscogs(false);
        setDiscogsResults([]);
        setDiscogsQuery("");
      }
    } catch {}
    setDiscogsLoading(false);
  };

  return (
    <div style={{ padding: 18, maxWidth: 480 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontWeight: "normal", letterSpacing: 2, fontSize: 18, textTransform: "uppercase", margin: 0 }}>{title}</h2>
        <button style={{ background: "transparent", border: "1px solid #333", color: "#777", borderRadius: 3, padding: "7px 16px", cursor: "pointer", fontSize: 14, fontFamily: "monospace" }} onClick={onCancel}>✕ Cancelar</button>
      </div>

      {/* Discogs search block */}
      <div style={{ marginBottom: 20, background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, overflow: "hidden" }}>
        <button
          style={{ width: "100%", background: showDiscogs ? "#1a1a1a" : "transparent", border: "none", color: "#4db8ff", padding: "12px 16px", cursor: "pointer", fontSize: 14, fontFamily: "monospace", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
          onClick={() => setShowDiscogs(s => !s)}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <span>Buscar no Discogs para preencher automaticamente</span>
          <span style={{ marginLeft: "auto" }}>{showDiscogs ? "▲" : "▼"}</span>
        </button>
        {showDiscogs && (
          <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1a1a1a" }}>
            <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: discogsResults.length ? 12 : 0 }}>
              <input
                style={{ flex: 1, background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, padding: "10px 14px", color: "#f0ece4", fontSize: 15, fontFamily: "monospace", outline: "none" }}
                placeholder="Nome do disco ou artista…"
                value={discogsQuery}
                onChange={e => setDiscogsQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchDiscogs()}
                autoFocus
              />
              <button
                style={{ background: "#c0392b", border: "none", color: "#fff", borderRadius: 4, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontFamily: "monospace", opacity: discogsLoading ? 0.6 : 1 }}
                onClick={searchDiscogs} disabled={discogsLoading}>
                {discogsLoading ? "…" : "Buscar"}
              </button>
            </div>
            {discogsResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 13, fontFamily: "monospace", color: "#5EEDED", margin: "0 0 8px" }}>
                  {discogsResults.length} resultado{discogsResults.length!==1?"s":""} — toque para selecionar:
                </p>
                {discogsResults.map((r, i) => (
                  <div key={r.id||i}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#111", border: "1px solid #252525", borderRadius: 8, cursor: "pointer" }}
                    onClick={() => pickDiscogsResult(r)}>
                    {r.cover
                      ? <img src={r.cover} alt="" style={{ width:52, height:52, objectFit:"cover", borderRadius:6, flexShrink:0 }}/>
                      : <div style={{ width:52, height:52, background:"#1a1a1a", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>💿</div>
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, color:"#f0ece4", fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.title}</div>
                      <div style={{ fontSize:12, color:"#666", fontFamily:"monospace" }}>
                        {[r.year, r.label, r.country].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span style={{ color:"#c0392b", fontSize:22, flexShrink:0 }}>›</span>
                  </div>
                ))}
                <button
                  style={{ background:"transparent", border:"1px solid #333", color:"#666", borderRadius:4, padding:"8px", cursor:"pointer", fontSize:12, fontFamily:"monospace", marginTop:4 }}
                  onClick={() => { setDiscogsResults([]); setDiscogsQuery(""); }}>
                  ✕ Limpar resultados
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tipo de disco */}
      <div style={{ marginBottom: 18 }}>
        <label style={lStyle}>Tipo de disco</label>
        <div style={{ display:"flex", gap:8 }}>
          {[["banda","🎸 Banda / Artista"],["novela","📺 Novela"],["coletanea","🎵 Coletânea"],["outros","📦 Outros"]].map(([val, lbl]) => (
            <button key={val} type="button"
              style={{ flex:1, background: form.tipo===val ? "#c0392b" : "#0e0e0e", border:`1px solid ${form.tipo===val?"#c0392b":"#2a2a2a"}`, color: form.tipo===val ? "#fff" : "#888", borderRadius:6, padding:"10px 4px", cursor:"pointer", fontSize:12, fontFamily:"monospace", textAlign:"center" }}
              onClick={() => set("tipo", val)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={lStyle}>Foto da capa</label>
        <PhotoPicker value={form.coverPhoto} onChange={v => set("coverPhoto", v)} />
      </div>

      {[["artist","Artista / Banda"],["album","Nome do Álbum"],["year","Ano"],["genre","Gênero musical"],["label","Gravadora"]].map(([f,l]) => (
        <div key={f} style={{ marginBottom: 14 }}>
          <label style={lStyle}>{l}</label>
          <input style={fStyle} value={form[f]} onChange={e => set(f, e.target.value)} />
        </div>
      ))}

      <div style={{ marginBottom: 16 }}>
        <label style={lStyle}>Faixas (uma por linha)</label>
        <textarea style={{ ...fStyle, height: 140, resize: "vertical" }} placeholder={"Faixa 1\nFaixa 2\nFaixa 3"} value={form.tracks} onChange={e => set("tracks", e.target.value)} />
      </div>

      {/* Location field */}
      <div style={{ marginBottom: 16 }}>
        <label style={lStyle}>📍 Localização (onde está o disco)</label>
        <input
          style={fStyle}
          placeholder="Ex: Armário 1, Estante porta, Nacionais, Sala..."
          value={form.location||""}
          onChange={e => set("location", e.target.value)}
        />
      </div>

      {/* Wash status selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={lStyle}>Status de lavagem</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { key: "green", label: "Lavado recentemente (menos de 1 ano)", color: "#2ecc71" },
            { key: "yellow", label: "Lavado há mais de 1 ano", color: "#f39c12" },
            { key: "red", label: "Nunca lavado / sem registro", color: "#e74c3c" },
          ].map(opt => {
            const m = monthsAgo(form.washedDate);
            const isSelected = opt.key === "green" ? (form.washed && m <= 12) : opt.key === "yellow" ? (form.washed && m > 12) : !form.washed;
            return (
              <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "12px 14px", background: isSelected ? `${opt.color}11` : "#0e0e0e", border: `1px solid ${isSelected ? opt.color+"55" : "#1e1e1e"}`, borderRadius: 6 }}>
                <input type="radio" name="washStatus" checked={isSelected} onChange={() => {
                  if (opt.key === "green") { set("washed", true); set("washedDate", new Date().toISOString().split("T")[0]); }
                  else if (opt.key === "yellow") { set("washed", true); const d = new Date(); d.setFullYear(d.getFullYear() - 2); set("washedDate", d.toISOString().split("T")[0]); }
                  else { set("washed", false); set("washedDate", ""); }
                }} style={{ accentColor: opt.color }} />
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: opt.color, boxShadow: `0 0 6px ${opt.color}`, display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 15, color: "#ddd", fontFamily: "monospace" }}>{opt.label}</span>
              </label>
            );
          })}
        </div>
        {form.washed && (
          <div style={{ marginTop: 12 }}>
            <label style={lStyle}>Data exata da lavagem (opcional)</label>
            <input type="date" style={fStyle} value={form.washedDate} onChange={e => set("washedDate", e.target.value)} />
          </div>
        )}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, fontFamily: "monospace", color: "#aaa", marginBottom: 22 }}>
        <input type="checkbox" checked={form.scratches} onChange={e => set("scratches", e.target.checked)} style={{ width: 18, height: 18 }} />
        Disco tem riscos
      </label>

      <button style={{ background: "#c0392b", border: "none", color: "#fff", borderRadius: 4, padding: "14px 32px", cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }} onClick={async () => {
        const tracks = typeof form.tracks === "string" ? form.tracks.split("\n").map(t => t.trim()).filter(Boolean) : form.tracks;
        // Compress only data URLs (not http URLs from Discogs)
        const coverPhoto = form.coverPhoto && !form.coverPhoto.startsWith("http")
          ? await compressImage(form.coverPhoto)
          : (form.coverPhoto || null);
        onSave({ ...form, tracks, year: parseInt(form.year) || new Date().getFullYear(), coverPhoto });
      }}>SALVAR</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [records, setRecords] = useState(() => loadRecords() || DEMO_DATA);
  const { playing, loading, searchAndPlay, stop } = useDeezerPreview();
  const [coversLoaded, setCoversLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filterArtist, setFilterArtist] = useState("");
  const [filterTrack, setFilterTrack] = useState("");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("catalog"); // catalog | add | edit | detail
  const [viewMode, setViewMode] = useState("grid");
  const [scanning, setScanning] = useState(false);
  const [hovCard, setHovCard] = useState(null);
  const [toast, setToast] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // Load covers from IndexedDB on startup and merge into records
  useEffect(() => {
    dbGetAllCovers().then(covers => {
      if (Object.keys(covers).length > 0) {
        setRecords(prev => prev.map(r => ({
          ...r,
          coverPhoto: covers[String(r.id)] || r.coverPhoto || null
        })));
      }
      setCoversLoaded(true);
    });
  }, []);

  // Save catalog (text only) whenever records change
  useEffect(() => { saveRecords(records); }, [records]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const results = useMemo(() => {
    const q  = query.toLowerCase().trim();
    const fa = filterArtist.toLowerCase().trim();
    const ft = filterTrack.toLowerCase().trim();
    const tipoOrder = { banda: 0, novela: 1, coletanea: 2, outros: 3 };
    return records.filter(r => {
      // 1) Cantor/Banda filter: disc artist OR album name OR inside track list
      if (fa) {
        const inArtist = r.artist.toLowerCase().includes(fa);
        const inAlbum  = r.album.toLowerCase().includes(fa);
        const inTracks = r.tracks.some(t => t.toLowerCase().includes(fa));
        if (!inArtist && !inAlbum && !inTracks) return false;
      }
      // 2) Música filter: any track matches
      if (ft) {
        if (!r.tracks.some(t => t.toLowerCase().includes(ft))) return false;
      }
      // 3) General search bar (only applied when typed)
      if (!q) return true;
      return (
        r.artist.toLowerCase().includes(q) ||
        r.album.toLowerCase().includes(q) ||
        r.label?.toLowerCase().includes(q) ||
        r.tracks.some(t => t.toLowerCase().includes(q))
      );
    }).sort((a, b) => {
      const ta = tipoOrder[a.tipo||"banda"] ?? 0;
      const tb = tipoOrder[b.tipo||"banda"] ?? 0;
      if (ta !== tb) return ta - tb;
      const artistCmp = (a.artist||"").localeCompare(b.artist||"", "pt-BR", {sensitivity:"base"});
      if (artistCmp !== 0) return artistCmp;
      return (a.album||"").localeCompare(b.album||"", "pt-BR", {sensitivity:"base"});
    });
  }, [query, records, filterArtist, filterTrack]);

  const matchedTracks = (r) => {
    // Priority: if music filter active, show tracks matching music term
    // If only artist filter, show tracks matching artist (for compilations)
    // If general search, show tracks matching query
    const term = filterTrack || (filterArtist && !filterTrack ? filterArtist : "") || query;
    if (!term.trim()) return [];
    return r.tracks.filter(t => t.toLowerCase().includes(term.toLowerCase()));
  };

  // The highlight term: prefer music filter, then general query, then artist
  const hlTerm = filterTrack || query || filterArtist;

  const Hl = ({ text }) => {
    const q = hlTerm.toLowerCase();
    if (!q) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return <span>{text.slice(0,idx)}<mark style={{ background:"#c0392b33", color:"#ff8080", padding:"0 2px", borderRadius:2, fontStyle:"normal" }}>{text.slice(idx,idx+q.length)}</mark>{text.slice(idx+q.length)}</span>;
  };

  const addRecord = async (data) => {
    const id = Date.now();
    let coverPhoto = data.coverPhoto || null;
    if (coverPhoto) {
      if (coverPhoto.startsWith("http")) {
        // Convert Discogs URL to permanent base64
        coverPhoto = await fetchAndCompressUrl(coverPhoto);
      } else {
        coverPhoto = await compressImage(coverPhoto);
      }
    }
    const rec = { ...data, id, coverPhoto };
    if (coverPhoto) await saveSingleCover(id, coverPhoto);
    setRecords(p => [rec, ...p]);
    showToast(`"${data.album}" adicionado! 🎵`);
    setView("catalog");
  };


  const updateRecord = async (data) => {
    let coverPhoto = data.coverPhoto || null;
    if (coverPhoto) {
      if (coverPhoto.startsWith("http")) {
        coverPhoto = await fetchAndCompressUrl(coverPhoto);
      } else if (coverPhoto.startsWith("data:")) {
        coverPhoto = await compressImage(coverPhoto);
      }
    }
    const updated = { ...data, coverPhoto };
    await saveSingleCover(updated.id, coverPhoto || null);
    setRecords(p => p.map(r => r.id === data.id ? updated : r));
    setSelected(updated);
    showToast("Disco atualizado! ✓");
    setView("detail");
  };

  const handleScanDetected = (data) => {
    setScanning(false);
    const tracks = Array.isArray(data.tracks) ? data.tracks.join("\n") : (data.tracks || "");
    setEditForm({ artist: data.artist||"", album: data.album||"", year: String(data.year||""), genre: data.genre||"", label: data.label||"", washed: false, washedDate: new Date().toISOString().split("T")[0], scratches: false, tracks, coverPhoto: data.coverUrl || null, coverEmoji: "💿" });
    setView("add");
    showToast("Disco identificado! Confira e salve ✓");
  };

  const washNow = (id) => {
    const today = new Date().toISOString().split("T")[0];
    const updated = records.map(r => r.id === id ? { ...r, washed: true, washedDate: today } : r);
    setRecords(updated);
    const upd = updated.find(r => r.id === id);
    if (selected?.id === id) setSelected(upd);
    showToast("Lavagem registrada! 💧");
  };

  const deleteRecord = (id) => {
    if (!window.confirm("Remover este disco?")) return;
    setRecords(p => p.filter(r => r.id !== id));
    setSelected(null); setView("catalog"); showToast("Disco removido.");
  };

  const nb = (active) => ({ background: active ? "#c0392b" : "transparent", border: `1px solid ${active ? "#c0392b" : "#222"}`, color: active ? "#fff" : "#777", borderRadius: 4, padding: "7px 18px", cursor: "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1 });

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", color: "#f0ece4", fontFamily: "'Georgia','Times New Roman',serif", overflowX: "hidden" }}>
      <style>{`
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        input::placeholder,textarea::placeholder{color:#2a8080}
        input:focus,textarea:focus{border-color:#c0392b!important}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#080808}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:3px}
        *{-webkit-tap-highlight-color:transparent}
      `}</style>

      {scanning && <ScanOverlay onClose={() => setScanning(false)} onDetected={handleScanDetected} />}
      {toast && <div style={{ position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)", background:"#111", border:"1px solid #c0392b55", color:"#f0ece4", padding:"12px 24px", borderRadius:8, fontFamily:"monospace", fontSize:14, zIndex:500, whiteSpace:"nowrap", boxShadow:"0 4px 20px #000" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#130707 0%,#0a0a0a 100%)", borderBottom:"1px solid #1a1a1a", padding:"18px 18px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:14 }}>
          <img src="/icon-192.png" alt="JR Collection" style={{ width:64, height:64, borderRadius:12, flexShrink:0 }} />
          <div>
            <h1 style={{ fontSize:32, fontWeight:"normal", letterSpacing:3, color:"#f0ece4", margin:"0 0 3px" }}>Jr Collection</h1>
            <div style={{ fontSize:12, color:"#c0392b", fontFamily:"monospace", letterSpacing:3, textTransform:"uppercase" }}>Discos-LP</div>
            <div style={{ fontSize:13, color:"#555", letterSpacing:1, fontFamily:"monospace", marginTop:2 }}>{records.length} disco{records.length!==1?"s":""} no catálogo</div>
          </div>
        </div>
        {view==="catalog" && !selected && (
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"#444", fontSize:18 }}>🔍</span>
            <input style={{ width:"100%", background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:6, padding:"13px 14px 13px 44px", color:"#5EEDED", fontSize:16, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} placeholder="Busca geral: artista, disco, música…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={{ display:"flex", gap:8, padding:"10px 18px", borderBottom:"1px solid #141414", flexWrap:"wrap", alignItems:"center", background:"#080808" }}>
        <button style={nb(view==="catalog"&&!selected)} onClick={() => { setView("catalog"); setSelected(null); }}>▤ CATÁLOGO</button>
        <button style={nb(view==="add")} onClick={() => { setEditForm(null); setView("add"); }}>+ MANUAL</button>
        <button style={{ background:"#4a4a4a", border:"1px solid #666", color:"#f0f0f0", borderRadius:4, padding:"7px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace", letterSpacing:1, display:"flex", alignItems:"center", gap:6 }} onClick={() => setScanning(true)}>📷 ESCANEAR</button>
        {view==="catalog"&&!selected&&<span style={{ marginLeft:"auto", fontSize:12, fontFamily:"monospace", color:"#444" }}>{results.length} disco{results.length!==1?"s":""}</span>}
        <button style={{ background:"transparent", border:"1px solid #2a2a2a", color:"#666", borderRadius:4, padding:"6px 12px", cursor:"pointer", fontSize:12, fontFamily:"monospace", marginLeft: view==="catalog"&&!selected?"4px":"auto" }}
          onClick={() => exportCatalog(records)} title="Exportar backup">
          💾
        </button>
        <label style={{ background:"transparent", border:"1px solid #2a2a2a", color:"#666", borderRadius:4, padding:"6px 12px", cursor:"pointer", fontSize:12, fontFamily:"monospace" }} title="Importar backup">
          📂
          <input type="file" accept=".json" style={{ display:"none" }} onChange={async e => {
            const file = e.target.files[0]; if (!file) return;
            try {
              const imported = await importCatalog(file);
              if (window.confirm(`Importar ${imported.length} discos? Isso VAI SUBSTITUIR seu catálogo atual.`)) {
                // Convert any URL covers to base64 on import
                showToast("Importando... aguarde");
                const fixed = await Promise.all(imported.map(async r => {
                  if (r.coverPhoto && r.coverPhoto.startsWith("http")) {
                    const b64 = await fetchAndCompressUrl(r.coverPhoto);
                    if (r.id) await saveSingleCover(r.id, b64);
                    return { ...r, coverPhoto: b64 };
                  }
                  if (r.coverPhoto && r.coverPhoto.startsWith("data:") && r.coverPhoto.length > 200000) {
                    const b64 = await compressImage(r.coverPhoto);
                    if (r.id) await saveSingleCover(r.id, b64);
                    return { ...r, coverPhoto: b64 };
                  }
                  if (r.id && r.coverPhoto) await saveSingleCover(r.id, r.coverPhoto);
                  return r;
                }));
                setRecords(fixed);
                showToast(`${fixed.length} discos importados! ✓`);
              }
            } catch(err) { showToast("Erro ao importar: " + err.message); }
            e.target.value = "";
          }} />
        </label>
      </div>

      {/* ── Catalog ── */}
      {view==="catalog" && !selected && (<>
        <div style={{ display:"flex", gap:8, padding:"12px 18px", borderBottom:"1px solid #111", flexWrap:"wrap", alignItems:"center" }}>
          <input style={{ background:"#0e0e0e", border:"1px solid #2a2a2a", color:"#5EEDED", borderRadius:4, padding:"9px 12px", fontSize:15, fontFamily:"monospace", outline:"none", flex:1, minWidth:100 }} placeholder="🎤 Cantor / Banda" value={filterArtist} onChange={e => setFilterArtist(e.target.value)} />
          <input style={{ background:"#0e0e0e", border:"1px solid #2a2a2a", color:"#5EEDED", borderRadius:4, padding:"9px 12px", fontSize:15, fontFamily:"monospace", outline:"none", flex:1, minWidth:100 }} placeholder="🎵 Música" value={filterTrack} onChange={e => setFilterTrack(e.target.value)} />
          <div style={{ display:"flex", border:"1px solid #222", borderRadius:4, overflow:"hidden" }}>
            <button style={{ background:viewMode==="grid"?"#c0392b":"transparent", border:"none", color:viewMode==="grid"?"#fff":"#666", padding:"8px 14px", cursor:"pointer", fontSize:18 }} onClick={() => setViewMode("grid")}>⊞</button>
            <button style={{ background:viewMode==="list"?"#c0392b":"transparent", border:"none", color:viewMode==="list"?"#fff":"#666", padding:"8px 14px", cursor:"pointer", fontSize:18 }} onClick={() => setViewMode("list")}>≡</button>
          </div>
        </div>

        {results.length===0
          ? <div style={{ textAlign:"center", padding:"60px 18px", color:"#2a2a2a" }}><VinylSVG size={56}/><p style={{ marginTop:16, fontFamily:"monospace", fontSize:15 }}>Nenhum disco encontrado</p></div>
          : viewMode==="grid"
            ? <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14, padding:16 }}>
                {results.map(r => {
                  const mt = matchedTracks(r);
                  return (
                    <div key={r.id} style={{ background:hovCard===r.id?"#141414":"#0c0c0c", border:`1px solid ${hovCard===r.id?"#2a2a2a":"#141414"}`, borderRadius:10, cursor:"pointer", overflow:"hidden", transition:"all 0.15s" }}
                      onMouseEnter={()=>setHovCard(r.id)} onMouseLeave={()=>setHovCard(null)} onClick={()=>{ setSelected(r); setView("detail"); }}>
                      {r.coverPhoto
                        ? <img src={r.coverPhoto} alt="capa" style={{ width:"100%", aspectRatio:"1", objectFit:"cover" }} />
                        : <div style={{ width:"100%", aspectRatio:"1", background:"#111", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>{r.coverEmoji||"💿"}</div>
                      }
                      <div style={{ padding:"12px 12px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                          <div style={{ fontSize:12, color:"#c0392b", fontFamily:"monospace", letterSpacing:1, textTransform:"uppercase", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><Hl text={r.artist}/></div>
                          {r.tipo==="novela" && <span style={{ fontSize:9, background:"#9b59b622", color:"#9b59b6", border:"1px solid #9b59b644", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>NOVELA</span>}
                          {r.tipo==="coletanea" && <span style={{ fontSize:9, background:"#27ae6022", color:"#27ae60", border:"1px solid #27ae6044", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>COLET.</span>}
                          {r.tipo==="outros" && <span style={{ fontSize:9, background:"#e67e2222", color:"#e67e22", border:"1px solid #e67e2244", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>OUTROS</span>}
                        </div>
                        <div style={{ fontSize:16, color:"#f0ece4", lineHeight:1.3, marginBottom:6 }}><Hl text={r.album}/></div>
                        <div style={{ fontSize:12, color:"#3a3a3a", fontFamily:"monospace", marginBottom:10 }}>{r.year} · {r.genre}</div>
                        <WashDot washed={r.washed} washedDate={r.washedDate} />
                        {mt.length>0 && <div style={{ marginTop:8, borderTop:"1px solid #1e1e1e", paddingTop:8 }}>
                          {mt.slice(0,3).map((t,i)=>{
                            const q=hlTerm.toLowerCase();
                            const idx=t.toLowerCase().indexOf(q);
                            const before=idx>=0?t.slice(0,idx):"";
                            const match=idx>=0?t.slice(idx,idx+q.length):"";
                            const after=idx>=0?t.slice(idx+q.length):"";
                            return <div key={i} style={{ fontSize:12, fontFamily:"monospace", color:"#aaa", padding:"3px 0", display:"flex", alignItems:"flex-start", gap:6 }}>
                              <span style={{ color:"#c0392b", flexShrink:0 }}>♪</span>
                              <span>{before}<span style={{ background:"#c0392b33", color:"#ff8080", padding:"0 2px", borderRadius:2 }}>{match}</span>{after}</span>
                            </div>;
                          })}
                          {mt.length>3&&<div style={{ fontSize:11, color:"#444", fontFamily:"monospace", marginTop:2 }}>+{mt.length-3} músicas com "{filterArtist||filterTrack||query}"</div>}
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            : <div style={{ padding:"8px 16px", display:"flex", flexDirection:"column", gap:2 }}>
                {results.map(r=>{
                  const mt = matchedTracks(r);
                  const hq = hlTerm.toLowerCase();
                  return (
                    <div key={r.id}>
                      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 14px", background:hovCard===r.id?"#111":"transparent", borderRadius:8, cursor:"pointer", transition:"background 0.1s", borderBottom:"1px solid #111" }}
                        onMouseEnter={()=>setHovCard(r.id)} onMouseLeave={()=>setHovCard(null)} onClick={()=>{ setSelected(r); setView("detail"); }}>
                        {r.coverPhoto
                          ? <img src={r.coverPhoto} alt="capa" style={{ width:56, height:56, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
                          : <div style={{ width:56, height:56, background:"#111", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{r.coverEmoji||"💿"}</div>
                        }
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ fontSize:14, color:"#c0392b", fontFamily:"monospace", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.artist}</div>
                            {r.tipo==="novela" && <span style={{ fontSize:9, background:"#9b59b622", color:"#9b59b6", border:"1px solid #9b59b644", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>NOVELA</span>}
                            {r.tipo==="coletanea" && <span style={{ fontSize:9, background:"#27ae6022", color:"#27ae60", border:"1px solid #27ae6044", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>COLET.</span>}
                            {r.tipo==="outros" && <span style={{ fontSize:9, background:"#e67e2222", color:"#e67e22", border:"1px solid #e67e2244", borderRadius:3, padding:"1px 5px", fontFamily:"monospace", flexShrink:0 }}>OUTROS</span>}
                          </div>
                          <div style={{ fontSize:17, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.album}</div>
                          <div style={{ fontSize:12, color:"#444", fontFamily:"monospace" }}>{r.year}{r.location ? <span style={{ color:"#5EEDED", marginLeft:8 }}>📍 {r.location}</span> : ""}</div>
                        </div>
                        <WashDot washed={r.washed} washedDate={r.washedDate} />
                      </div>
                      {mt.length>0 && (
                        <div style={{ padding:"4px 14px 10px 80px", borderBottom:"1px solid #0e0e0e" }}>
                          {mt.slice(0,2).map((t,i)=>{
                            const idx=t.toLowerCase().indexOf(hq);
                            const before=idx>=0?t.slice(0,idx):"";
                            const match=idx>=0?t.slice(idx,idx+hq.length):"";
                            const after=idx>=0?t.slice(idx+hq.length):"";
                            return <div key={i} style={{ fontSize:12, fontFamily:"monospace", color:"#aaa", display:"flex", alignItems:"flex-start", gap:6 }}>
                              <span style={{ color:"#c0392b", flexShrink:0 }}>♪</span>
                              <span>{before}<span style={{ background:"#c0392b33", color:"#ff8080", padding:"0 2px", borderRadius:2 }}>{match}</span>{after}</span>
                            </div>;
                          })}
                          {mt.length>2&&<div style={{ fontSize:11, color:"#444", fontFamily:"monospace" }}>+{mt.length-2} músicas</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
        }
      </>)}

      {/* ── Detail ── */}
      {view==="detail" && selected && (
        <div style={{ padding:18, maxWidth:680 }}>
          <div style={{ display:"flex", gap:10, marginBottom:20, alignItems:"center" }}>
            <button style={{ background:"transparent", border:"1px solid #1e1e1e", color:"#666", borderRadius:4, padding:"8px 16px", cursor:"pointer", fontSize:14, fontFamily:"monospace" }} onClick={()=>{ setView("catalog"); setSelected(null); }}>← VOLTAR</button>
            <button style={{ background:"#c0392b22", border:"1px solid #c0392b55", color:"#f0ece4", borderRadius:4, padding:"8px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace", display:"flex", alignItems:"center", gap:6, marginLeft:"auto" }}
              onClick={() => { setEditForm({ ...selected, tracks: selected.tracks.join("\n") }); setView("edit"); }}>
              ✏️ Editar disco
            </button>
          </div>

          <div style={{ display:"flex", gap:18, marginBottom:22, alignItems:"flex-start" }}>
            {selected.coverPhoto
              ? <img src={selected.coverPhoto} alt="capa" style={{ width:120, height:120, objectFit:"cover", borderRadius:10, flexShrink:0 }} />
              : <div style={{ width:120, height:120, background:"#111", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:50, flexShrink:0 }}>{selected.coverEmoji||"💿"}</div>
            }
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:"#c0392b", fontFamily:"monospace", letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>{selected.artist}</div>
              <h2 style={{ margin:"0 0 6px", fontSize:24, fontWeight:"normal", lineHeight:1.2 }}>{selected.album}</h2>
              <div style={{ fontSize:14, color:"#555", fontFamily:"monospace", marginBottom:14 }}>{selected.year} · {selected.label} · {selected.genre}</div>
              <WashBadge washed={selected.washed} washedDate={selected.washedDate} />
              {selected.scratches && <div style={{ marginTop:10 }}><span style={{ fontSize:13, background:"#c0392b14", color:"#e74c3c", border:"1px solid #c0392b33", borderRadius:4, padding:"3px 10px", fontFamily:"monospace" }}>⚠ tem riscos</span></div>}
              <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
                {(!selected.tipo||selected.tipo==="banda") && <span style={{ fontSize:12, background:"#c0392b22", color:"#c0392b", border:"1px solid #c0392b44", borderRadius:4, padding:"3px 10px", fontFamily:"monospace" }}>🎸 Banda / Artista</span>}
                {selected.tipo==="novela" && <span style={{ fontSize:12, background:"#9b59b622", color:"#9b59b6", border:"1px solid #9b59b644", borderRadius:4, padding:"3px 10px", fontFamily:"monospace" }}>📺 Novela</span>}
                {selected.tipo==="coletanea" && <span style={{ fontSize:12, background:"#27ae6022", color:"#27ae60", border:"1px solid #27ae6044", borderRadius:4, padding:"3px 10px", fontFamily:"monospace" }}>🎵 Coletânea</span>}
                {selected.tipo==="outros" && <span style={{ fontSize:12, background:"#e67e2222", color:"#e67e22", border:"1px solid #e67e2244", borderRadius:4, padding:"3px 10px", fontFamily:"monospace" }}>📦 Outros</span>}
              </div>
              {selected.location && (
                <div style={{ marginTop:10, marginBottom:4, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:14, color:"#5EEDED", fontFamily:"monospace", background:"#5EEDED11", border:"1px solid #5EEDED33", borderRadius:6, padding:"4px 12px" }}>📍 {selected.location}</span>
                </div>
              )}
              <div style={{ marginTop:14, display:"flex", gap:10, flexWrap:"wrap" }}>
                <button style={{ background:"#e74c3c11", border:"1px solid #e74c3c33", color:"#e74c3c", borderRadius:4, padding:"9px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace" }} onClick={()=>deleteRecord(selected.id)}>🗑 Remover disco</button>
              </div>
            </div>
          </div>

          <div style={{ fontSize:13, fontFamily:"monospace", color:"#444", letterSpacing:1, marginBottom:8 }}>FAIXAS — {selected.tracks.length} <span style={{ color:"#3a3a3a", fontSize:11 }}>▶ toque para ouvir 30s</span></div>
          <div style={{ background:"#0c0c0c", border:"1px solid #141414", borderRadius:8, padding:"6px 0" }}>
            {selected.tracks.map((t,i)=>{
              const q = filterTrack||query;
              const m = q && t.toLowerCase().includes(q.toLowerCase());
              const isPlaying = playing === t;
              const isLoading = loading === t;
              return (
                <div key={i} style={{ padding:"8px 14px", fontSize:14, fontFamily:"monospace", color:m?"#ff8080":isPlaying?"#5EEDED":"#777", background:isPlaying?"#5EEDED0d":m?"#c0392b0c":"transparent", borderLeft:`3px solid ${m?"#c0392b":isPlaying?"#5EEDED":"transparent"}`, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ color:"#2a2a2a", flexShrink:0, fontSize:12, minWidth:20 }}>{String(i+1).padStart(2,"0")}</span>
                  <span style={{ flex:1, lineHeight:1.3 }}>{t}</span>
                  <button
                    onClick={() => searchAndPlay(t, selected.artist)}
                    title={isPlaying?"Pausar":"Ouvir prévia de 30s"}
                    style={{ background:isPlaying?"#5EEDED22":"#111", border:`1px solid ${isPlaying?"#5EEDED66":"#222"}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:isPlaying?"#5EEDED":"#555", transition:"all 0.15s" }}>
                    {isLoading?"⏳":isPlaying?"⏸":"▶"}
                  </button>
                </div>
              );
            })}
          </div>
          {playing && (
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"#5EEDED11", border:"1px solid #5EEDED33", borderRadius:8 }}>
              <span style={{ fontSize:18 }}>🎵</span>
              <span style={{ fontSize:12, fontFamily:"monospace", color:"#5EEDED", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{playing}</span>
              <button onClick={stop} style={{ background:"transparent", border:"1px solid #5EEDED44", color:"#5EEDED", borderRadius:4, padding:"4px 12px", cursor:"pointer", fontSize:12, fontFamily:"monospace" }}>■ parar</button>
            </div>
          )}
        </div>
      )}

      {/* ── Add ── */}
      {view==="add" && (
        <RecordForm
          initial={editForm || EMPTY_FORM}
          title="Adicionar disco"
          onSave={addRecord}
          onCancel={() => setView("catalog")}
        />
      )}

      {/* ── Edit ── */}
      {view==="edit" && selected && editForm && (
        <RecordForm
          initial={editForm}
          title="Editar disco"
          onSave={(data) => updateRecord({ ...selected, ...data })}
          onCancel={() => setView("detail")}
        />
      )}
    </div>
  );
}
