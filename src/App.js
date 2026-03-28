import { useState, useRef, useCallback, useMemo, useEffect } from "react";

const STORAGE_KEY = "jr-collection-records";
const loadRecords = () => { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const saveRecords = (r) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} };

const DEMO_DATA = [
  { id: 1, artist: "Pink Floyd", album: "The Wall", year: 1979, genre: "Rock Progressivo", label: "Harvest", washed: true, washedDate: "2024-10-15", scratches: false, coverPhoto: null, coverEmoji: "🎸", tracks: ["In the Flesh?","The Thin Ice","Another Brick in the Wall Pt.1","Mother","Comfortably Numb","Run Like Hell","The Trial","Outside the Wall"] },
  { id: 2, artist: "Pink Floyd", album: "Dark Side of the Moon", year: 1973, genre: "Rock Progressivo", label: "Harvest", washed: false, washedDate: "2023-03-01", scratches: false, coverPhoto: null, coverEmoji: "🌑", tracks: ["Speak to Me","Breathe","On the Run","Time","The Great Gig in the Sky","Money","Us and Them","Brain Damage","Eclipse"] },
  { id: 3, artist: "Vários Artistas", album: "Rock in Rio Vol. 1", year: 1985, genre: "Coletânea", label: "CBS", washed: true, washedDate: "2025-01-20", scratches: true, coverPhoto: null, coverEmoji: "🎪", tracks: ["Queen - Bohemian Rhapsody","AC/DC - Back in Black","Rod Stewart - Do Ya Think I'm Sexy","Ozzy Osbourne - Crazy Train","Iron Maiden - The Trooper"] },
];

const monthsAgo = (d) => (new Date() - new Date(d)) / (1000 * 60 * 60 * 24 * 30);
const washStatus = (washed, washedDate) => {
  const m = monthsAgo(washedDate);
  if (!washed || m > 12) return { color: "#e74c3c", glow: "#e74c3c44", label: "Precisa lavar" };
  if (m > 6) return { color: "#f39c12", glow: "#f39c1244", label: "Lavar em breve" };
  return { color: "#2ecc71", glow: "#2ecc7144", label: "Lavado" };
};

const WashDot = ({ washed, washedDate, showLabel = false }) => {
  const { color, glow, label } = washStatus(washed, washedDate);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%", background: color, boxShadow: `0 0 0 3px ${glow}`, flexShrink: 0 }} title={label} />
      {showLabel && <span style={{ fontSize: 12, color: "#888", fontFamily: "monospace" }}>{label}</span>}
    </span>
  );
};

const VinylSVG = ({ size = 36, spin = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={spin ? { animation: "spin 2.5s linear infinite" } : {}}>
    <circle cx="50" cy="50" r="48" fill="#111" stroke="#2a2a2a" strokeWidth="2" />
    {[40, 32, 24, 16].map(r => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#1e1e1e" strokeWidth="1.5" />)}
    <circle cx="50" cy="50" r="10" fill="#c0392b" />
    <circle cx="50" cy="50" r="4" fill="#0a0a0a" />
  </svg>
);

const picBtn = { background: "transparent", border: "1px solid #2a2a2a", color: "#aaa", borderRadius: 4, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontFamily: "monospace" };

const PhotoPicker = ({ value, onChange }) => {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      {value
        ? <img src={value} alt="capa" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "2px solid #c0392b" }} />
        : <div style={{ width: 90, height: 90, background: "#111", borderRadius: 6, border: "2px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>💿</div>
      }
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" style={picBtn} onClick={() => camRef.current.click()}>📷 Câmera</button>
        <button type="button" style={picBtn} onClick={() => fileRef.current.click()}>🖼 Galeria</button>
        {value && <button type="button" style={{ ...picBtn, color: "#e74c3c", borderColor: "#e74c3c44" }} onClick={() => onChange(null)}>✕ Remover foto</button>}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f); }} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f); }} />
    </div>
  );
};

function ScanOverlay({ onClose, onDetected }) {
  const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null), fileRef = useRef(null);
  const [phase, setPhase] = useState("camera");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [camErr, setCamErr] = useState(false);

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
  const analyze = async () => {
    setPhase("analyzing");
    try {
      const b64 = preview.split(",")[1];
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: b64 }) });
      const parsed = await res.json();
      if (parsed.error) { setErrMsg("Não consegui identificar. Tente uma foto mais nítida."); setPhase("error"); }
      else { setResult(parsed); setPhase("result"); }
    } catch { setErrMsg("Erro ao analisar. Verifique sua conexão."); setPhase("error"); }
  };
  const retry = () => { setPreview(null); setResult(null); setErrMsg(""); setPhase("camera"); startCam(); };

  const rb = "2px solid #c0392b";
  const btn = (p) => ({ background: p ? "#c0392b" : "transparent", border: `1px solid ${p ? "#c0392b" : "#333"}`, color: p ? "#fff" : "#888", borderRadius: 4, padding: "11px 26px", cursor: "pointer", fontSize: 14, fontFamily: "monospace" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: "'Georgia',serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><VinylSVG size={22} /><span style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Escanear capa</span></div>
        <button style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#777", borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontFamily: "monospace" }} onClick={() => { stopCam(); onClose(); }}>✕ Fechar</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 20, overflowY: "auto" }}>
        {phase === "camera" && !camErr && (<>
          <p style={{ fontSize: 13, fontFamily: "monospace", color: "#555", textAlign: "center" }}>Aponte para a capa do disco e fotografe</p>
          <div style={{ position: "relative", width: "100%", maxWidth: 460 }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8, border: "2px solid #1e1e1e", background: "#111", display: "block" }} />
            {[{top:8,left:8,borderTop:rb,borderLeft:rb},{top:8,right:8,borderTop:rb,borderRight:rb},{bottom:8,left:8,borderBottom:rb,borderLeft:rb},{bottom:8,right:8,borderBottom:rb,borderRight:rb}].map((s,i) => <div key={i} style={{ position:"absolute", width:22, height:22, ...s }} />)}
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <button style={{ width: 72, height: 72, borderRadius: "50%", background: "#c0392b", border: "4px solid #fff", cursor: "pointer", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={snap}>📷</button>
          <button style={btn(false)} onClick={() => fileRef.current.click()}>📁 Usar foto da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}
        {phase === "camera" && camErr && (<>
          <div style={{ textAlign: "center", color: "#555" }}><div style={{ fontSize: 48, marginBottom: 12 }}>📷</div><p style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.7 }}>Câmera não disponível.<br />Use uma foto da galeria.</p></div>
          <button style={btn(true)} onClick={() => fileRef.current.click()}>📁 Escolher da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}
        {phase === "preview" && (<>
          <p style={{ fontSize: 13, fontFamily: "monospace", color: "#555", textAlign: "center" }}>A foto ficou boa?</p>
          <img src={preview} alt="preview" style={{ width: "100%", maxWidth: 360, borderRadius: 8, border: "2px solid #1e1e1e" }} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={btn(false)} onClick={retry}>↩ Tirar outra</button>
            <button style={btn(true)} onClick={analyze}>🔍 Identificar disco</button>
          </div>
        </>)}
        {phase === "analyzing" && (<>
          <div style={{ width: 44, height: 44, borderRadius: "50%", border: "3px solid #1e1e1e", borderTop: "3px solid #c0392b", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: 13, fontFamily: "monospace", color: "#555" }}>Analisando capa com IA…</p>
          <VinylSVG size={42} spin />
        </>)}
        {phase === "result" && result && (<>
          <p style={{ fontFamily: "monospace", color: "#2ecc71", fontSize: 13, textAlign: "center" }}>✓ Disco identificado!</p>
          <div style={{ width: "100%", maxWidth: 440, background: "#0e0e0e", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#c0392b", padding: "10px 16px", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, color: "#fff", textTransform: "uppercase" }}>📀 Resultado</div>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 11, color: "#c0392b", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{result.artist}</div>
              <div style={{ fontSize: 20, color: "#f0ece4", marginBottom: 3 }}>{result.album}</div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace", marginBottom: 8 }}>{result.year} · {result.label} · {result.genre}</div>
              <div style={{ maxHeight: 130, overflowY: "auto", borderTop: "1px solid #1a1a1a", paddingTop: 8 }}>
                {result.tracks?.map((t, i) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace", color: "#777", padding: "3px 0" }}><span style={{ color: "#2a2a2a", marginRight: 8 }}>{String(i+1).padStart(2,"0")}</span>{t}</div>)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={btn(false)} onClick={retry}>↩ Escanear outro</button>
            <button style={btn(true)} onClick={() => onDetected(result, preview)}>+ Adicionar ao catálogo</button>
          </div>
        </>)}
        {phase === "error" && (<>
          <div style={{ fontSize: 42, textAlign: "center" }}>🔍</div>
          <p style={{ fontFamily: "monospace", color: "#e74c3c", fontSize: 13, textAlign: "center", maxWidth: 320 }}>{errMsg}</p>
          <button style={btn(true)} onClick={retry}>↩ Tentar novamente</button>
        </>)}
      </div>
    </div>
  );
}

const EMPTY_FORM = { artist: "", album: "", year: "", genre: "", label: "", washed: false, washedDate: new Date().toISOString().split("T")[0], scratches: false, tracks: "", coverPhoto: null, coverEmoji: "💿" };

export default function App() {
  const [records, setRecords] = useState(() => loadRecords() || DEMO_DATA);
  const [query, setQuery] = useState("");
  const [filterArtist, setFilterArtist] = useState("");
  const [filterTrack, setFilterTrack] = useState("");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("catalog");
  const [viewMode, setViewMode] = useState("grid");
  const [scanning, setScanning] = useState(false);
  const [hovCard, setHovCard] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fromScan, setFromScan] = useState(false);

  useEffect(() => saveRecords(records), [records]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const fa = filterArtist.toLowerCase().trim();
    const ft = filterTrack.toLowerCase().trim();
    return records.filter(r => {
      if (fa && !r.artist.toLowerCase().includes(fa)) return false;
      if (ft && !r.tracks.some(t => t.toLowerCase().includes(ft))) return false;
      if (!q) return true;
      return r.artist.toLowerCase().includes(q) || r.album.toLowerCase().includes(q) || r.label?.toLowerCase().includes(q) || r.tracks.some(t => t.toLowerCase().includes(q));
    });
  }, [query, records, filterArtist, filterTrack]);

  const matchedTracks = (r) => {
    const q = filterTrack || query;
    if (!q.trim()) return [];
    return r.tracks.filter(t => t.toLowerCase().includes(q.toLowerCase()));
  };

  const Hl = ({ text, term }) => {
    const q = (term || query).toLowerCase();
    if (!q) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return <span>{text.slice(0, idx)}<mark style={{ background: "#c0392b33", color: "#ff8080", padding: "0 2px", borderRadius: 2, fontStyle: "normal" }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</span>;
  };

  const saveRecord = () => {
    const rec = { ...form, id: Date.now(), year: parseInt(form.year) || new Date().getFullYear(), tracks: typeof form.tracks === "string" ? form.tracks.split("\n").map(t => t.trim()).filter(Boolean) : form.tracks };
    setRecords(p => [rec, ...p]);
    showToast(`"${rec.album}" adicionado! 🎵`);
    setForm(EMPTY_FORM); setFromScan(false); setView("catalog");
  };

  const handleScanDetected = (data, photoDataUrl) => {
    setScanning(false);
    setForm({ artist: data.artist || "", album: data.album || "", year: String(data.year || ""), genre: data.genre || "", label: data.label || "", washed: false, washedDate: new Date().toISOString().split("T")[0], scratches: false, tracks: Array.isArray(data.tracks) ? data.tracks.join("\n") : (data.tracks || ""), coverPhoto: photoDataUrl || null, coverEmoji: "💿" });
    setFromScan(true); setView("add");
    showToast("Disco identificado! Confira e salve ✓");
  };

  const washNow = (id) => {
    const today = new Date().toISOString().split("T")[0];
    setRecords(p => p.map(r => r.id === id ? { ...r, washed: true, washedDate: today } : r));
    if (selected?.id === id) setSelected(p => ({ ...p, washed: true, washedDate: today }));
    showToast("Lavagem registrada! 💧");
  };

  const deleteRecord = (id) => {
    if (!window.confirm("Remover este disco?")) return;
    setRecords(p => p.filter(r => r.id !== id));
    setSelected(null); setView("catalog"); showToast("Disco removido.");
  };

  const fInput = { background: "#0e0e0e", border: "1px solid #1a1a1a", color: "#ddd", borderRadius: 3, padding: "8px 10px", fontSize: 14, fontFamily: "monospace", outline: "none", flex: 1, minWidth: 100 };
  const backBtn = { background: "transparent", border: "1px solid #1e1e1e", color: "#666", borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontFamily: "monospace" };

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", color: "#f0ece4", fontFamily: "'Georgia','Times New Roman',serif", overflowX: "hidden" }}>
      <style>{`
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        input::placeholder,textarea::placeholder{color:#2a2a2a}
        input:focus,textarea:focus{border-color:#c0392b!important}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#080808}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:2px}
        *{-webkit-tap-highlight-color:transparent}
      `}</style>

      {scanning && <ScanOverlay onClose={() => setScanning(false)} onDetected={handleScanDetected} />}
      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", border: "1px solid #c0392b55", color: "#f0ece4", padding: "10px 20px", borderRadius: 6, fontFamily: "monospace", fontSize: 13, zIndex: 500, whiteSpace: "nowrap", boxShadow: "0 4px 20px #00000099" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background: "linear-gradient(180deg,#130707 0%,#0a0a0a 100%)", borderBottom: "1px solid #1a1a1a", padding: "18px 18px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <VinylSVG size={44} spin={query.length > 0 || filterArtist.length > 0 || filterTrack.length > 0} />
          <div>
            <h1 style={{ fontSize: 28, fontWeight: "normal", letterSpacing: 3, color: "#f0ece4", margin: "0 0 3px" }}>Jr Collection</h1>
            <div style={{ fontSize: 11, color: "#c0392b", fontFamily: "monospace", letterSpacing: 3, textTransform: "uppercase" }}>Discos-LP</div>
            <div style={{ fontSize: 11, color: "#444", letterSpacing: 1, fontFamily: "monospace", marginTop: 2 }}>{records.length} disco{records.length !== 1 ? "s" : ""} no catálogo</div>
          </div>
        </div>
        {view === "catalog" && !selected && (
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#333", fontSize: 15 }}>🔍</span>
            <input style={{ width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 4, padding: "11px 14px 11px 40px", color: "#f0ece4", fontSize: 15, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} placeholder="Busca geral: artista, disco, música…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 6, padding: "10px 18px", borderBottom: "1px solid #141414", flexWrap: "wrap", alignItems: "center", background: "#080808" }}>
        {[["catalog","▤ CATÁLOGO"],["add","+ MANUAL"]].map(([v,l]) => (
          <button key={v} style={{ background: view===v&&(v!=="add"||!fromScan)?"#c0392b":"transparent", border:`1px solid ${view===v&&(v!=="add"||!fromScan)?"#c0392b":"#222"}`, color: view===v&&(v!=="add"||!fromScan)?"#fff":"#666", borderRadius:3, padding:"6px 16px", cursor:"pointer", fontSize:12, fontFamily:"monospace", letterSpacing:1 }} onClick={() => { if(v==="add"){setFromScan(false);setForm(EMPTY_FORM);} setView(v); setSelected(null); }}>{l}</button>
        ))}
        <button style={{ background:"linear-gradient(135deg,#c0392b,#96281b)", border:"none", color:"#fff", borderRadius:3, padding:"6px 16px", cursor:"pointer", fontSize:12, fontFamily:"monospace", letterSpacing:1, display:"flex", alignItems:"center", gap:6 }} onClick={() => setScanning(true)}>📷 ESCANEAR</button>
        {view==="catalog"&&!selected&&<span style={{ marginLeft:"auto", fontSize:11, fontFamily:"monospace", color:"#333" }}>{results.length} disco{results.length!==1?"s":""}</span>}
      </div>

      {/* Catalog */}
      {view === "catalog" && !selected && (<>
        <div style={{ display: "flex", gap: 8, padding: "10px 18px", borderBottom: "1px solid #111", flexWrap: "wrap", alignItems: "center" }}>
          <input style={fInput} placeholder="🎤 Cantor / Banda" value={filterArtist} onChange={e => setFilterArtist(e.target.value)} />
          <input style={fInput} placeholder="🎵 Música" value={filterTrack} onChange={e => setFilterTrack(e.target.value)} />
          <div style={{ display: "flex", border: "1px solid #222", borderRadius: 3, overflow: "hidden" }}>
            <button style={{ background: viewMode==="grid"?"#c0392b":"transparent", border:"none", color: viewMode==="grid"?"#fff":"#555", padding:"6px 13px", cursor:"pointer", fontSize:16 }} onClick={() => setViewMode("grid")} title="Grid">⊞</button>
            <button style={{ background: viewMode==="list"?"#c0392b":"transparent", border:"none", color: viewMode==="list"?"#fff":"#555", padding:"6px 13px", cursor:"pointer", fontSize:16 }} onClick={() => setViewMode("list")} title="Lista">≡</button>
          </div>
        </div>

        {results.length === 0
          ? <div style={{ textAlign:"center", padding:"60px 18px", color:"#2a2a2a" }}><VinylSVG size={50}/><p style={{ marginTop:14, fontFamily:"monospace", fontSize:13 }}>Nenhum disco encontrado</p></div>
          : viewMode === "grid"
            ? <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, padding:14 }}>
                {results.map(r => {
                  const mt = matchedTracks(r);
                  return (
                    <div key={r.id} style={{ background: hovCard===r.id?"#141414":"#0c0c0c", border:`1px solid ${hovCard===r.id?"#2a2a2a":"#141414"}`, borderRadius:8, cursor:"pointer", overflow:"hidden", transition:"all 0.15s" }}
                      onMouseEnter={() => setHovCard(r.id)} onMouseLeave={() => setHovCard(null)} onClick={() => { setSelected(r); setView("detail"); }}>
                      {r.coverPhoto
                        ? <img src={r.coverPhoto} alt="capa" style={{ width:"100%", aspectRatio:"1", objectFit:"cover" }} />
                        : <div style={{ width:"100%", aspectRatio:"1", background:"#111", display:"flex", alignItems:"center", justifyContent:"center", fontSize:42 }}>{r.coverEmoji||"💿"}</div>
                      }
                      <div style={{ padding:"10px 12px 12px" }}>
                        <div style={{ fontSize:11, color:"#c0392b", fontFamily:"monospace", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>{r.artist}</div>
                        <div style={{ fontSize:15, color:"#f0ece4", lineHeight:1.3, marginBottom:4 }}>{r.album}</div>
                        <div style={{ fontSize:11, color:"#3a3a3a", fontFamily:"monospace", marginBottom:8 }}>{r.year} · {r.genre}</div>
                        <WashDot washed={r.washed} washedDate={r.washedDate} showLabel />
                        {mt.length > 0 && <div style={{ marginTop:8, borderTop:"1px solid #141414", paddingTop:6 }}>
                          {mt.slice(0,2).map((t,i) => <div key={i} style={{ fontSize:11, fontFamily:"monospace", color:"#ff8080", padding:"2px 0" }}>♪ {t}</div>)}
                          {mt.length>2 && <div style={{ fontSize:10, color:"#333", fontFamily:"monospace" }}>+{mt.length-2} músicas</div>}
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            : <div style={{ padding:"8px 14px", display:"flex", flexDirection:"column", gap:2 }}>
                {results.map(r => (
                  <div key={r.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background: hovCard===r.id?"#111":"transparent", borderRadius:6, cursor:"pointer", transition:"background 0.1s" }}
                    onMouseEnter={() => setHovCard(r.id)} onMouseLeave={() => setHovCard(null)} onClick={() => { setSelected(r); setView("detail"); }}>
                    {r.coverPhoto
                      ? <img src={r.coverPhoto} alt="capa" style={{ width:52, height:52, objectFit:"cover", borderRadius:4, flexShrink:0 }} />
                      : <div style={{ width:52, height:52, background:"#111", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{r.coverEmoji||"💿"}</div>
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, color:"#c0392b", fontFamily:"monospace", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.artist}</div>
                      <div style={{ fontSize:16, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.album}</div>
                      <div style={{ fontSize:11, color:"#444", fontFamily:"monospace" }}>{r.year}</div>
                    </div>
                    <WashDot washed={r.washed} washedDate={r.washedDate} />
                  </div>
                ))}
              </div>
        }
      </>)}

      {/* Detail */}
      {view === "detail" && selected && (
        <div style={{ padding:18, maxWidth:660 }}>
          <button style={{ ...backBtn, marginBottom:18 }} onClick={() => { setView("catalog"); setSelected(null); }}>← VOLTAR</button>
          <div style={{ display:"flex", gap:18, marginBottom:20, alignItems:"flex-start" }}>
            {selected.coverPhoto
              ? <img src={selected.coverPhoto} alt="capa" style={{ width:110, height:110, objectFit:"cover", borderRadius:8, flexShrink:0 }} />
              : <div style={{ width:110, height:110, background:"#111", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, flexShrink:0 }}>{selected.coverEmoji||"💿"}</div>
            }
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:"#c0392b", fontFamily:"monospace", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>{selected.artist}</div>
              <h2 style={{ margin:"0 0 4px", fontSize:22, fontWeight:"normal", lineHeight:1.2 }}>{selected.album}</h2>
              <div style={{ fontSize:12, color:"#444", fontFamily:"monospace", marginBottom:10 }}>{selected.year} · {selected.label} · {selected.genre}</div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <WashDot washed={selected.washed} washedDate={selected.washedDate} showLabel />
                {selected.scratches && <span style={{ fontSize:11, background:"#c0392b14", color:"#e74c3c", border:"1px solid #c0392b33", borderRadius:3, padding:"1px 6px", fontFamily:"monospace" }}>riscos</span>}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button style={{ ...backBtn, borderColor:"#2ecc7133", color:"#2ecc71" }} onClick={() => washNow(selected.id)}>💧 Lavei agora</button>
                <button style={{ ...backBtn, borderColor:"#e74c3c33", color:"#e74c3c" }} onClick={() => deleteRecord(selected.id)}>🗑 Remover</button>
              </div>
            </div>
          </div>
          <div style={{ fontSize:11, fontFamily:"monospace", color:"#333", letterSpacing:1, marginBottom:6 }}>FAIXAS — {selected.tracks.length}</div>
          <div style={{ background:"#0c0c0c", border:"1px solid #141414", borderRadius:6, padding:"6px 0" }}>
            {selected.tracks.map((t,i) => {
              const m = (filterTrack||query) && t.toLowerCase().includes((filterTrack||query).toLowerCase());
              return <div key={i} style={{ padding:"7px 14px", fontSize:13, fontFamily:"monospace", color:m?"#ff8080":"#666", background:m?"#c0392b0c":"transparent", borderLeft:`2px solid ${m?"#c0392b":"transparent"}` }}><span style={{ color:"#222", marginRight:10 }}>{String(i+1).padStart(2,"0")}</span><Hl text={t} term={filterTrack||query} /></div>;
            })}
          </div>
        </div>
      )}

      {/* Add form */}
      {view === "add" && (
        <div style={{ padding:18, maxWidth:460 }}>
          <h2 style={{ fontWeight:"normal", letterSpacing:2, marginBottom:6, fontSize:16, textTransform:"uppercase" }}>{fromScan?"Confirmar disco":"Adicionar disco"}</h2>
          {fromScan && <p style={{ fontSize:12, fontFamily:"monospace", color:"#c0392b", marginBottom:18, lineHeight:1.6 }}>✓ Preenchido pela IA — confira e salve</p>}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, fontFamily:"monospace", color:"#555", letterSpacing:1, marginBottom:8, textTransform:"uppercase" }}>Foto da capa</label>
            <PhotoPicker value={form.coverPhoto} onChange={v => setForm(p => ({ ...p, coverPhoto:v }))} />
          </div>
          {[["artist","Artista / Banda"],["album","Nome do Álbum"],["year","Ano"],["genre","Gênero musical"],["label","Gravadora"]].map(([f,l]) => (
            <div key={f} style={{ marginBottom:12 }}>
              <label style={{ display:"block", fontSize:11, fontFamily:"monospace", color:"#555", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>{l}</label>
              <input style={{ width:"100%", background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:3, padding:"9px 12px", color:"#f0ece4", fontSize:14, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} value={form[f]} onChange={e => setForm(p => ({ ...p, [f]:e.target.value }))} />
            </div>
          ))}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:11, fontFamily:"monospace", color:"#555", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Faixas (uma por linha)</label>
            <textarea style={{ width:"100%", background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:3, padding:"9px 12px", color:"#f0ece4", fontSize:13, fontFamily:"monospace", outline:"none", boxSizing:"border-box", height:130, resize:"vertical" }} placeholder={"Faixa 1\nFaixa 2\nFaixa 3"} value={form.tracks} onChange={e => setForm(p => ({ ...p, tracks:e.target.value }))} />
          </div>
          <div style={{ display:"flex", gap:18, marginBottom:14, flexWrap:"wrap" }}>
            {[["washed","Disco lavado"],["scratches","Tem riscos"]].map(([f,l]) => (
              <label key={f} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", fontSize:13, fontFamily:"monospace", color:"#777" }}>
                <input type="checkbox" checked={form[f]} onChange={e => setForm(p => ({ ...p, [f]:e.target.checked }))} />{l}
              </label>
            ))}
          </div>
          {form.washed && (
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:11, fontFamily:"monospace", color:"#555", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Data da última lavagem</label>
              <input type="date" style={{ width:"100%", background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:3, padding:"9px 12px", color:"#f0ece4", fontSize:14, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} value={form.washedDate} onChange={e => setForm(p => ({ ...p, washedDate:e.target.value }))} />
            </div>
          )}
          <button style={{ background:"#c0392b", border:"none", color:"#fff", borderRadius:4, padding:"12px 28px", cursor:"pointer", fontSize:13, fontFamily:"monospace", letterSpacing:1 }} onClick={saveRecord}>SALVAR NO CATÁLOGO</button>
        </div>
      )}
    </div>
  );
}
