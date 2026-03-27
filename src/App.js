import { useState, useRef, useCallback, useMemo, useEffect } from "react";

// ── Storage helpers (localStorage) ────────────────────────────────────────
const STORAGE_KEY = "jr-collection-records";

const loadRecords = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

const saveRecords = (records) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
};

// ── Demo data (used only on first load) ───────────────────────────────────
const DEMO_DATA = [
  {
    id: 1, artist: "Pink Floyd", album: "The Wall", year: 1979,
    genre: "Rock Progressivo", label: "Harvest",
    washed: true, washedDate: "2024-10-15", scratches: false,
    tracks: ["In the Flesh?","The Thin Ice","Another Brick in the Wall Pt.1","Mother","Goodbye Blue Sky","Comfortably Numb","Run Like Hell","The Trial","Outside the Wall"],
    cover: "🎸"
  },
  {
    id: 2, artist: "Pink Floyd", album: "Dark Side of the Moon", year: 1973,
    genre: "Rock Progressivo", label: "Harvest",
    washed: false, washedDate: "2023-03-01", scratches: false,
    tracks: ["Speak to Me","Breathe","On the Run","Time","The Great Gig in the Sky","Money","Us and Them","Brain Damage","Eclipse"],
    cover: "🌑"
  },
  {
    id: 3, artist: "Vários Artistas", album: "Rock in Rio Vol. 1", year: 1985,
    genre: "Coletânea", label: "CBS",
    washed: true, washedDate: "2025-01-20", scratches: true,
    tracks: ["Queen - Bohemian Rhapsody","AC/DC - Back in Black","Rod Stewart - Do Ya Think I'm Sexy","Ozzy Osbourne - Crazy Train","Iron Maiden - The Trooper"],
    cover: "🎪"
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────
const monthsAgo = (d) => (new Date() - new Date(d)) / (1000 * 60 * 60 * 24 * 30);

const washStatus = (washed, washedDate) => {
  const m = monthsAgo(washedDate);
  if (!washed || m > 12) return { color: "#e74c3c", glow: "#e74c3c44", label: "Precisa lavar" };
  if (m > 6)             return { color: "#f39c12", glow: "#f39c1244", label: "Lavar em breve" };
  return                        { color: "#2ecc71", glow: "#2ecc7144", label: "Lavado ✓" };
};

const WashDot = ({ washed, washedDate, showLabel = false }) => {
  const { color, glow, label } = washStatus(washed, washedDate);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{
        display: "inline-block", width: 10, height: 10, borderRadius: "50%",
        background: color, boxShadow: `0 0 0 3px ${glow}`, flexShrink: 0
      }} title={label} />
      {showLabel && <span style={{ fontSize: 11, color: "#777", fontFamily: "monospace" }}>{label}</span>}
    </span>
  );
};

const VinylSVG = ({ size = 36, spin = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100"
    style={spin ? { animation: "spin 2.5s linear infinite" } : {}}>
    <circle cx="50" cy="50" r="48" fill="#111" stroke="#2a2a2a" strokeWidth="2" />
    {[40, 32, 24, 16].map(r => (
      <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#1e1e1e" strokeWidth="1.5" />
    ))}
    <circle cx="50" cy="50" r="10" fill="#c0392b" />
    <circle cx="50" cy="50" r="4" fill="#0a0a0a" />
  </svg>
);

// ── Scanner overlay ────────────────────────────────────────────────────────
function ScanOverlay({ onClose, onDetected }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef   = useRef(null);
  const [phase,   setPhase]   = useState("camera");
  const [preview, setPreview] = useState(null);
  const [result,  setResult]  = useState(null);
  const [errMsg,  setErrMsg]  = useState("");
  const [camErr,  setCamErr]  = useState(false);

  const startCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
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
    stopCam();
    setPreview(c.toDataURL("image/jpeg", 0.85));
    setPhase("preview");
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { stopCam(); setPreview(ev.target.result); setPhase("preview"); };
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    setPhase("analyzing");
    try {
      const b64 = preview.split(",")[1];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
              { type: "text", text: `Você está vendo a capa de um disco de vinil (LP). Identifique o álbum e retorne SOMENTE um objeto JSON válido, sem markdown, sem explicação. Formato exato:
{"artist":"Nome do artista","album":"Nome do álbum","year":1979,"genre":"Gênero","label":"Gravadora","tracks":["Faixa 1","Faixa 2"],"confidence":"high|medium|low"}
Se não conseguir identificar, retorne: {"error":"não identificado"}` }
            ]
          }]
        })
      });
      const data = await res.json();
      const raw = data.content?.map(b => b.text || "").join("").trim();
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (parsed.error) { setErrMsg("Não consegui identificar. Tente uma foto mais nítida da capa."); setPhase("error"); }
      else { setResult(parsed); setPhase("result"); }
    } catch { setErrMsg("Erro ao analisar. Verifique sua conexão e tente novamente."); setPhase("error"); }
  };

  const retry = () => { setPreview(null); setResult(null); setErrMsg(""); setPhase("camera"); startCam(); };

  const O = {
    overlay: { position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: "'Georgia', serif" },
    bar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1a1a1a" },
    body: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 20, overflowY: "auto" },
    hint: { fontSize: 12, fontFamily: "monospace", color: "#555", textAlign: "center" },
    videoBox: { position: "relative", width: "100%", maxWidth: 460 },
    video: { width: "100%", borderRadius: 8, border: "2px solid #1e1e1e", background: "#111", display: "block" },
    snapBtn: { width: 66, height: 66, borderRadius: "50%", background: "#fff", border: "5px solid #c0392b", cursor: "pointer" },
    previewImg: { width: "100%", maxWidth: 360, borderRadius: 8, border: "2px solid #1e1e1e" },
    btn: (p) => ({ background: p ? "#c0392b" : "transparent", border: `1px solid ${p ? "#c0392b" : "#333"}`, color: p ? "#fff" : "#888", borderRadius: 4, padding: "10px 26px", cursor: "pointer", fontSize: 13, fontFamily: "monospace", letterSpacing: 1 }),
    spinner: { width: 44, height: 44, borderRadius: "50%", border: "3px solid #1e1e1e", borderTop: "3px solid #c0392b", animation: "spin 0.8s linear infinite" },
    card: { width: "100%", maxWidth: 440, background: "#0e0e0e", border: "1px solid #222", borderRadius: 8, overflow: "hidden" },
    cardHead: { background: "#c0392b", padding: "10px 16px", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, color: "#fff", textTransform: "uppercase" },
    cardBody: { padding: 16 },
    trackScroll: { maxHeight: 130, overflowY: "auto", borderTop: "1px solid #1a1a1a", paddingTop: 8, marginTop: 4 },
    row: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" },
    closeBtn: { background: "transparent", border: "1px solid #2a2a2a", color: "#777", borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: "monospace" },
  };

  const Corner = ({ style }) => <div style={{ position: "absolute", width: 22, height: 22, ...style }} />;
  const redBorder = "2px solid #c0392b";

  return (
    <div style={O.overlay}>
      <div style={O.bar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <VinylSVG size={22} />
          <span style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Escanear capa</span>
        </div>
        <button style={O.closeBtn} onClick={() => { stopCam(); onClose(); }}>✕ Fechar</button>
      </div>

      <div style={O.body}>
        {phase === "camera" && !camErr && (<>
          <p style={O.hint}>Aponte para a capa do disco e fotografe</p>
          <div style={O.videoBox}>
            <video ref={videoRef} autoPlay playsInline muted style={O.video} />
            <Corner style={{ top: 8, left: 8, borderTop: redBorder, borderLeft: redBorder }} />
            <Corner style={{ top: 8, right: 8, borderTop: redBorder, borderRight: redBorder }} />
            <Corner style={{ bottom: 8, left: 8, borderBottom: redBorder, borderLeft: redBorder }} />
            <Corner style={{ bottom: 8, right: 8, borderBottom: redBorder, borderRight: redBorder }} />
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <button style={O.snapBtn} onClick={snap} title="Fotografar" />
          <button style={{ ...O.btn(false), fontSize: 11 }} onClick={() => fileRef.current.click()}>📁 Usar foto da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}

        {phase === "camera" && camErr && (<>
          <div style={{ textAlign: "center", color: "#555" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <p style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7 }}>Câmera não disponível.<br />Use uma foto da galeria.</p>
          </div>
          <button style={O.btn(true)} onClick={() => fileRef.current.click()}>📁 Escolher da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}

        {phase === "preview" && (<>
          <p style={O.hint}>A foto ficou boa?</p>
          <img src={preview} alt="preview" style={O.previewImg} />
          <div style={O.row}>
            <button style={O.btn(false)} onClick={retry}>↩ Tirar outra</button>
            <button style={O.btn(true)} onClick={analyze}>🔍 Identificar disco</button>
          </div>
        </>)}

        {phase === "analyzing" && (<>
          <div style={O.spinner} />
          <p style={O.hint}>Analisando capa com IA…</p>
          <VinylSVG size={42} spin />
        </>)}

        {phase === "result" && result && (<>
          <p style={{ fontFamily: "monospace", color: "#2ecc71", fontSize: 12, textAlign: "center" }}>✓ Disco identificado!</p>
          <div style={O.card}>
            <div style={O.cardHead}>📀 Resultado</div>
            <div style={O.cardBody}>
              <div style={{ fontSize: 10, color: "#c0392b", fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{result.artist}</div>
              <div style={{ fontSize: 19, color: "#f0ece4", marginBottom: 3 }}>{result.album}</div>
              <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", marginBottom: 8 }}>{result.year} · {result.label} · {result.genre}</div>
              {result.tracks?.length > 0 && (
                <div style={O.trackScroll}>
                  {result.tracks.map((t, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: "monospace", color: "#777", padding: "3px 0" }}>
                      <span style={{ color: "#2a2a2a", marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>{t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={O.row}>
            <button style={O.btn(false)} onClick={retry}>↩ Escanear outro</button>
            <button style={O.btn(true)} onClick={() => { onDetected(result); }}>+ Adicionar ao catálogo</button>
          </div>
        </>)}

        {phase === "error" && (<>
          <div style={{ fontSize: 42, textAlign: "center" }}>🔍</div>
          <p style={{ fontFamily: "monospace", color: "#e74c3c", fontSize: 13, textAlign: "center", maxWidth: 320 }}>{errMsg}</p>
          <button style={O.btn(true)} onClick={retry}>↩ Tentar novamente</button>
        </>)}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  artist: "", album: "", year: "", genre: "", label: "",
  washed: false, washedDate: new Date().toISOString().split("T")[0],
  scratches: false, tracks: "", cover: "💿"
};

export default function App() {
  const [records,     setRecords]     = useState(() => loadRecords() || DEMO_DATA);
  const [query,       setQuery]       = useState("");
  const [selected,    setSelected]    = useState(null);
  const [view,        setView]        = useState("catalog");
  const [filterGenre, setFilterGenre] = useState("Todos");
  const [filterWash,  setFilterWash]  = useState("Todos");
  const [scanning,    setScanning]    = useState(false);
  const [hovCard,     setHovCard]     = useState(null);
  const [toast,       setToast]       = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fromScan,    setFromScan]    = useState(false);

  // Persist to localStorage on every change
  useEffect(() => saveRecords(records), [records]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const genres = ["Todos", ...new Set(records.map(r => r.genre))];

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    let f = records;
    if (filterGenre !== "Todos") f = f.filter(r => r.genre === filterGenre);
    if (filterWash === "Precisa lavar") f = f.filter(r => !r.washed || monthsAgo(r.washedDate) > 12);
    if (filterWash === "OK") f = f.filter(r => r.washed && monthsAgo(r.washedDate) <= 12);
    if (!q) return f;
    return f.filter(r =>
      r.artist.toLowerCase().includes(q) ||
      r.album.toLowerCase().includes(q) ||
      r.label?.toLowerCase().includes(q) ||
      r.tracks.some(t => t.toLowerCase().includes(q))
    );
  }, [query, records, filterGenre, filterWash]);

  const matchedTracks = (r) => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return r.tracks.filter(t => t.toLowerCase().includes(q));
  };

  const Hl = ({ text }) => {
    if (!query.trim()) return <span>{text}</span>;
    const q = query.toLowerCase(), idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return <span>
      {text.slice(0, idx)}
      <mark style={{ background: "#c0392b33", color: "#ff8080", padding: "0 2px", borderRadius: 2, fontStyle: "normal" }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </span>;
  };

  const saveRecord = () => {
    const rec = {
      ...form,
      id: Date.now(),
      year: parseInt(form.year) || new Date().getFullYear(),
      tracks: typeof form.tracks === "string"
        ? form.tracks.split("\n").map(t => t.trim()).filter(Boolean)
        : form.tracks,
    };
    setRecords(p => [rec, ...p]);
    showToast(`"${rec.album}" adicionado! 🎵`);
    setForm(EMPTY_FORM);
    setFromScan(false);
    setView("catalog");
  };

  const handleScanDetected = (data) => {
    setScanning(false);
    setForm({
      artist: data.artist || "", album: data.album || "",
      year: String(data.year || ""), genre: data.genre || "",
      label: data.label || "", washed: false,
      washedDate: new Date().toISOString().split("T")[0],
      scratches: false,
      tracks: Array.isArray(data.tracks) ? data.tracks.join("\n") : (data.tracks || ""),
      cover: "💿"
    });
    setFromScan(true);
    setView("add");
    showToast("Disco identificado! Confira e salve ✓");
  };

  const washNow = (id) => {
    const today = new Date().toISOString().split("T")[0];
    setRecords(p => p.map(r => r.id === id ? { ...r, washed: true, washedDate: today } : r));
    if (selected?.id === id) setSelected(p => ({ ...p, washed: true, washedDate: today }));
    showToast("Lavagem registrada! 💧");
  };

  const deleteRecord = (id) => {
    setRecords(p => p.filter(r => r.id !== id));
    setSelected(null);
    setView("catalog");
    showToast("Disco removido.");
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const S = {
    app: { minHeight: "100vh", minHeight: "100dvh", background: "#0a0a0a", color: "#f0ece4", fontFamily: "'Georgia','Times New Roman',serif", overflowX: "hidden" },
    header: { background: "linear-gradient(180deg,#130707 0%,#0a0a0a 100%)", borderBottom: "1px solid #1a1a1a", padding: "18px 18px 14px" },
    logoRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 },
    appName: { fontSize: 10, color: "#c0392b", fontFamily: "monospace", letterSpacing: 3, textTransform: "uppercase", marginBottom: 2 },
    appTitle: { fontSize: 21, fontWeight: "normal", letterSpacing: 3, color: "#f0ece4", margin: 0 },
    appSub: { fontSize: 10, color: "#444", letterSpacing: 1, fontFamily: "monospace", marginTop: 2 },
    searchWrap: { position: "relative" },
    search: { width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 4, padding: "10px 14px 10px 38px", color: "#f0ece4", fontSize: 14, fontFamily: "monospace", outline: "none", boxSizing: "border-box", letterSpacing: 0.3 },
    searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#333", fontSize: 15, pointerEvents: "none" },
    nav: { display: "flex", gap: 6, padding: "10px 18px", borderBottom: "1px solid #141414", flexWrap: "wrap", alignItems: "center", background: "#080808" },
    nb: (a) => ({ background: a ? "#c0392b" : "transparent", border: `1px solid ${a ? "#c0392b" : "#222"}`, color: a ? "#fff" : "#666", borderRadius: 3, padding: "5px 14px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }),
    scanBtn: { background: "linear-gradient(135deg,#c0392b,#96281b)", border: "none", color: "#fff", borderRadius: 3, padding: "5px 16px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px #c0392b44" },
    filterBar: { display: "flex", gap: 8, padding: "8px 18px", borderBottom: "1px solid #111", flexWrap: "wrap", alignItems: "center" },
    sel: { background: "#0e0e0e", border: "1px solid #1a1a1a", color: "#777", borderRadius: 3, padding: "4px 10px", fontSize: 11, fontFamily: "monospace", outline: "none", cursor: "pointer" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(165px,1fr))", gap: 12, padding: 18 },
    card: (h) => ({ background: h ? "#111" : "#0c0c0c", border: `1px solid ${h ? "#222" : "#141414"}`, borderRadius: 6, padding: 14, cursor: "pointer", transition: "all 0.15s", transform: h ? "translateY(-2px)" : "none", boxShadow: h ? "0 6px 18px #00000088" : "none" }),
    detail: { padding: 20, maxWidth: 660 },
    backBtn: { background: "transparent", border: "1px solid #1e1e1e", color: "#666", borderRadius: 3, padding: "5px 14px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", marginBottom: 18 },
    trackList: { background: "#0c0c0c", border: "1px solid #141414", borderRadius: 6, padding: "6px 0", marginTop: 14 },
    trackRow: (m) => ({ padding: "6px 14px", fontSize: 12, fontFamily: "monospace", color: m ? "#ff8080" : "#666", background: m ? "#c0392b0c" : "transparent", borderLeft: `2px solid ${m ? "#c0392b" : "transparent"}` }),
    form: { padding: 20, maxWidth: 460 },
    fLabel: { display: "block", fontSize: 10, fontFamily: "monospace", color: "#555", letterSpacing: 1, marginBottom: 5, textTransform: "uppercase" },
    fInput: { width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 3, padding: "8px 12px", color: "#f0ece4", fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" },
    fTextarea: { width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 3, padding: "8px 12px", color: "#f0ece4", fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box", height: 120, resize: "vertical" },
    saveBtn: { background: "#c0392b", border: "none", color: "#fff", borderRadius: 4, padding: "11px 28px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", border: "1px solid #c0392b55", color: "#f0ece4", padding: "10px 20px", borderRadius: 6, fontFamily: "monospace", fontSize: 12, zIndex: 500, whiteSpace: "nowrap", boxShadow: "0 4px 20px #00000099", animation: "fadeIn 0.2s ease" },
    empty: { textAlign: "center", padding: "60px 18px", color: "#2a2a2a" },
  };

  return (
    <div style={S.app}>
      <style>{`
        @keyframes spin { from { transform:rotate(0) } to { transform:rotate(360deg) } }
        @keyframes fadeIn { from { opacity:0; transform:translateX(-50%) translateY(8px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }
        input::placeholder, textarea::placeholder { color:#2a2a2a }
        input:focus, textarea:focus, select:focus { border-color:#c0392b !important }
        select option { background:#0e0e0e }
        ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-track { background:#080808 } ::-webkit-scrollbar-thumb { background:#1e1e1e; border-radius:2px }
        * { -webkit-tap-highlight-color: transparent }
      `}</style>

      {scanning && <ScanOverlay onClose={() => setScanning(false)} onDetected={handleScanDetected} />}
      {toast && <div style={S.toast}>{toast}</div>}

      {/* Header */}
      <div style={S.header}>
        <div style={S.logoRow}>
          <VinylSVG size={42} spin={query.length > 0} />
          <div>
            <div style={S.appName}>Jr Collection</div>
            <h1 style={S.appTitle}>Vitrola</h1>
            <div style={S.appSub}>{records.length} disco{records.length !== 1 ? "s" : ""} no catálogo</div>
          </div>
        </div>
        {view === "catalog" && !selected && (
          <div style={S.searchWrap}>
            <span style={S.searchIcon}>🔍</span>
            <input style={S.search} placeholder="Artista, disco, música, gravadora…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={S.nav}>
        <button style={S.nb(view === "catalog" && !selected)} onClick={() => { setView("catalog"); setSelected(null); }}>▤ CATÁLOGO</button>
        <button style={S.nb(view === "add" && !fromScan)} onClick={() => { setFromScan(false); setForm(EMPTY_FORM); setView("add"); }}>+ MANUAL</button>
        <button style={S.scanBtn} onClick={() => setScanning(true)}>📷 ESCANEAR</button>
        {view === "catalog" && !selected && results.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "monospace", color: "#333" }}>
            {results.length} result{results.length !== 1 ? "ados" : "ado"}
          </span>
        )}
      </div>

      {/* ── Catalog ── */}
      {view === "catalog" && !selected && (<>
        <div style={S.filterBar}>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "#333" }}>FILTRAR:</span>
          <select style={S.sel} value={filterGenre} onChange={e => setFilterGenre(e.target.value)}>
            {genres.map(g => <option key={g}>{g}</option>)}
          </select>
          <select style={S.sel} value={filterWash} onChange={e => setFilterWash(e.target.value)}>
            {["Todos", "Precisa lavar", "OK"].map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
        {results.length === 0
          ? <div style={S.empty}><VinylSVG size={50} /><p style={{ marginTop: 14, fontFamily: "monospace", fontSize: 12 }}>Nenhum disco encontrado</p></div>
          : <div style={S.grid}>
            {results.map(r => {
              const mt = matchedTracks(r);
              return (
                <div key={r.id} style={S.card(hovCard === r.id)}
                  onMouseEnter={() => setHovCard(r.id)} onMouseLeave={() => setHovCard(null)}
                  onClick={() => { setSelected(r); setView("detail"); }}>
                  <div style={{ textAlign: "center", fontSize: 30, marginBottom: 8 }}>{r.cover}</div>
                  <div style={{ fontSize: 10, color: "#c0392b", fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}><Hl text={r.artist} /></div>
                  <div style={{ fontSize: 13, color: "#f0ece4", margin: "2px 0 4px", lineHeight: 1.3 }}><Hl text={r.album} /></div>
                  <div style={{ fontSize: 10, color: "#3a3a3a", fontFamily: "monospace", marginBottom: 8 }}>{r.year} · {r.genre}</div>
                  <WashDot washed={r.washed} washedDate={r.washedDate} showLabel />
                  {mt.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: "1px solid #141414", paddingTop: 6 }}>
                      {mt.slice(0, 2).map((t, i) => <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: "#ff8080", padding: "2px 0" }}>♪ <Hl text={t} /></div>)}
                      {mt.length > 2 && <div style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>+{mt.length - 2} músicas</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        }
      </>)}

      {/* ── Detail ── */}
      {view === "detail" && selected && (
        <div style={S.detail}>
          <button style={S.backBtn} onClick={() => { setView("catalog"); setSelected(null); }}>← VOLTAR</button>
          <div style={{ display: "flex", gap: 18, marginBottom: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontSize: 52 }}>{selected.cover}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 10, color: "#c0392b", fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{selected.artist}</div>
              <h2 style={{ margin: "0 0 4px", fontSize: 21, fontWeight: "normal", lineHeight: 1.2 }}>{selected.album}</h2>
              <div style={{ fontSize: 11, color: "#444", fontFamily: "monospace", marginBottom: 10 }}>{selected.year} · {selected.label} · {selected.genre}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <WashDot washed={selected.washed} washedDate={selected.washedDate} showLabel />
                {selected.scratches && <span style={{ fontSize: 10, background: "#c0392b14", color: "#e74c3c", border: "1px solid #c0392b33", borderRadius: 3, padding: "1px 6px", fontFamily: "monospace" }}>riscos</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={{ ...S.backBtn, borderColor: "#2ecc7133", color: "#2ecc71", marginBottom: 0 }} onClick={() => washNow(selected.id)}>💧 Lavei agora</button>
                <button style={{ ...S.backBtn, borderColor: "#e74c3c33", color: "#e74c3c", marginBottom: 0 }} onClick={() => { if (window.confirm(`Remover "${selected.album}"?`)) deleteRecord(selected.id); }}>🗑 Remover</button>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "#333", letterSpacing: 1, marginBottom: 6 }}>FAIXAS — {selected.tracks.length}</div>
          <div style={S.trackList}>
            {selected.tracks.map((t, i) => {
              const m = query && t.toLowerCase().includes(query.toLowerCase());
              return (
                <div key={i} style={S.trackRow(m)}>
                  <span style={{ color: "#222", marginRight: 10 }}>{String(i + 1).padStart(2, "0")}</span>
                  <Hl text={t} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add/Edit form ── */}
      {view === "add" && (
        <div style={S.form}>
          <h2 style={{ fontWeight: "normal", letterSpacing: 2, marginBottom: 6, fontSize: 15, textTransform: "uppercase", color: "#f0ece4" }}>
            {fromScan ? "Confirmar disco" : "Adicionar disco"}
          </h2>
          {fromScan && <p style={{ fontSize: 11, fontFamily: "monospace", color: "#c0392b", marginBottom: 18, lineHeight: 1.6 }}>✓ Preenchido pela IA — confira e salve</p>}

          {[["artist", "Artista / Banda"], ["album", "Nome do Álbum"], ["year", "Ano"], ["genre", "Gênero musical"], ["label", "Gravadora"]].map(([f, l]) => (
            <div key={f} style={{ marginBottom: 12 }}>
              <label style={S.fLabel}>{l}</label>
              <input style={S.fInput} value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} />
            </div>
          ))}

          <div style={{ marginBottom: 12 }}>
            <label style={S.fLabel}>Emoji da capa</label>
            <input style={{ ...S.fInput, width: 70, fontSize: 22, textAlign: "center" }} value={form.cover} onChange={e => setForm(p => ({ ...p, cover: e.target.value }))} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={S.fLabel}>Faixas (uma por linha)</label>
            <textarea style={S.fTextarea} placeholder={"Faixa 1\nFaixa 2\nFaixa 3"} value={form.tracks} onChange={e => setForm(p => ({ ...p, tracks: e.target.value }))} />
          </div>

          <div style={{ display: "flex", gap: 18, marginBottom: 14, flexWrap: "wrap" }}>
            {[["washed", "Disco lavado"], ["scratches", "Tem riscos"]].map(([f, l]) => (
              <label key={f} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, fontFamily: "monospace", color: "#777" }}>
                <input type="checkbox" checked={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.checked }))} />{l}
              </label>
            ))}
          </div>

          {form.washed && (
            <div style={{ marginBottom: 16 }}>
              <label style={S.fLabel}>Data da última lavagem</label>
              <input type="date" style={S.fInput} value={form.washedDate} onChange={e => setForm(p => ({ ...p, washedDate: e.target.value }))} />
            </div>
          )}

          <button style={S.saveBtn} onClick={saveRecord}>SALVAR NO CATÁLOGO</button>
        </div>
      )}
    </div>
  );
}
