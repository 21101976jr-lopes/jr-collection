import { useState, useRef, useCallback, useMemo, useEffect } from "react";

const STORAGE_KEY = "jr-collection-records";
const loadRecords = () => { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const saveRecords = (r) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} };

const DEMO_DATA = [
  { id: 1, artist: "Pink Floyd", album: "The Wall - Disco 1", year: 1979, genre: "Rock Progressivo", label: "Harvest", washed: true, washedDate: "2024-10-15", scratches: false, coverPhoto: null, coverEmoji: "🎸", tracks: ["In the Flesh?","The Thin Ice","Another Brick in the Wall Pt.1","The Happiest Days","Another Brick in the Wall Pt.2","Mother","Goodbye Blue Sky","Empty Spaces","Young Lust","One of My Turns"] },
  { id: 2, artist: "Pink Floyd", album: "The Wall - Disco 2", year: 1979, genre: "Rock Progressivo", label: "Harvest", washed: false, washedDate: "2023-03-01", scratches: false, coverPhoto: null, coverEmoji: "🎸", tracks: ["Don't Leave Me Now","Another Brick in the Wall Pt.3","Goodbye Cruel World","Hey You","Is There Anybody Out There?","Nobody Home","Vera","Bring the Boys Back Home","Comfortably Numb","The Show Must Go On","In the Flesh","Run Like Hell","Waiting for the Worms","Stop","The Trial","Outside the Wall"] },
  { id: 3, artist: "Pink Floyd", album: "Dark Side of the Moon", year: 1973, genre: "Rock Progressivo", label: "Harvest", washed: false, washedDate: "2022-01-01", scratches: false, coverPhoto: null, coverEmoji: "🌑", tracks: ["Speak to Me","Breathe","On the Run","Time","The Great Gig in the Sky","Money","Us and Them","Brain Damage","Eclipse"] },
  { id: 4, artist: "Vários Artistas", album: "Rock in Rio Vol. 1", year: 1985, genre: "Coletânea", label: "CBS", washed: true, washedDate: "2025-01-20", scratches: true, coverPhoto: null, coverEmoji: "🎪", tracks: ["Queen - Bohemian Rhapsody","AC/DC - Back in Black","Rod Stewart - Do Ya Think I'm Sexy","Ozzy Osbourne - Crazy Train","Iron Maiden - The Trooper"] },
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
  const btn = (p) => ({ background: p ? "#c0392b" : "transparent", border: `1px solid ${p ? "#c0392b" : "#444"}`, color: p ? "#fff" : "#999", borderRadius: 4, padding: "12px 28px", cursor: "pointer", fontSize: 15, fontFamily: "monospace" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: "'Georgia',serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><VinylSVG size={24} /><span style={{ fontSize: 14, fontFamily: "monospace", letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Escanear capa</span></div>
        <button style={{ background: "transparent", border: "1px solid #333", color: "#777", borderRadius: 3, padding: "7px 16px", cursor: "pointer", fontSize: 14, fontFamily: "monospace" }} onClick={() => { stopCam(); onClose(); }}>✕ Fechar</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 22, overflowY: "auto" }}>
        {phase === "camera" && !camErr && (<>
          <p style={{ fontSize: 15, fontFamily: "monospace", color: "#666", textAlign: "center" }}>Aponte para a capa do disco e fotografe</p>
          <div style={{ position: "relative", width: "100%", maxWidth: 460 }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8, border: "2px solid #1e1e1e", background: "#111", display: "block" }} />
            {[{top:8,left:8,borderTop:rb,borderLeft:rb},{top:8,right:8,borderTop:rb,borderRight:rb},{bottom:8,left:8,borderBottom:rb,borderLeft:rb},{bottom:8,right:8,borderBottom:rb,borderRight:rb}].map((s,i) => <div key={i} style={{ position:"absolute", width:24, height:24, ...s }} />)}
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <button style={{ width: 80, height: 80, borderRadius: "50%", background: "#c0392b", border: "4px solid #fff", cursor: "pointer", fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={snap}>📷</button>
          <button style={btn(false)} onClick={() => fileRef.current.click()}>📁 Usar foto da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}
        {phase === "camera" && camErr && (<>
          <div style={{ fontSize: 52, marginBottom: 8 }}>📷</div>
          <p style={{ fontFamily: "monospace", fontSize: 15, color: "#666", lineHeight: 1.7, textAlign: "center" }}>Câmera não disponível.<br />Use uma foto da galeria.</p>
          <button style={btn(true)} onClick={() => fileRef.current.click()}>📁 Escolher da galeria</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        </>)}
        {phase === "preview" && (<>
          <p style={{ fontSize: 15, fontFamily: "monospace", color: "#666", textAlign: "center" }}>A foto ficou boa?</p>
          <img src={preview} alt="preview" style={{ width: "100%", maxWidth: 380, borderRadius: 8, border: "2px solid #1e1e1e" }} />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={btn(false)} onClick={retry}>↩ Tirar outra</button>
            <button style={btn(true)} onClick={analyze}>🔍 Identificar disco</button>
          </div>
        </>)}
        {phase === "analyzing" && (<>
          <div style={{ width: 50, height: 50, borderRadius: "50%", border: "3px solid #1e1e1e", borderTop: "3px solid #c0392b", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: 15, fontFamily: "monospace", color: "#666" }}>Analisando capa com IA…</p>
          <VinylSVG size={48} spin />
        </>)}
        {phase === "result" && result && (<>
          <p style={{ fontFamily: "monospace", color: "#2ecc71", fontSize: 15, textAlign: "center" }}>✓ Disco identificado!</p>
          <div style={{ width: "100%", maxWidth: 460, background: "#0e0e0e", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#c0392b", padding: "12px 18px", fontSize: 12, fontFamily: "monospace", letterSpacing: 2, color: "#fff", textTransform: "uppercase" }}>📀 Resultado — confira abaixo e salve</div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "#c0392b", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{result.artist}</div>
              <div style={{ fontSize: 22, color: "#f0ece4", marginBottom: 4 }}>{result.album}</div>
              <div style={{ fontSize: 13, color: "#555", fontFamily: "monospace", marginBottom: 10 }}>{result.year} · {result.label} · {result.genre}</div>
              <div style={{ maxHeight: 150, overflowY: "auto", borderTop: "1px solid #1a1a1a", paddingTop: 10 }}>
                {result.tracks?.map((t, i) => <div key={i} style={{ fontSize: 13, fontFamily: "monospace", color: "#777", padding: "4px 0" }}><span style={{ color: "#2a2a2a", marginRight: 10 }}>{String(i+1).padStart(2,"0")}</span>{t}</div>)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={btn(false)} onClick={retry}>↩ Escanear outro</button>
            <button style={btn(true)} onClick={() => onDetected(result)}>+ Adicionar ao catálogo</button>
          </div>
        </>)}
        {phase === "error" && (<>
          <div style={{ fontSize: 48, textAlign: "center" }}>🔍</div>
          <p style={{ fontFamily: "monospace", color: "#e74c3c", fontSize: 15, textAlign: "center", maxWidth: 340 }}>{errMsg}</p>
          <button style={btn(true)} onClick={retry}>↩ Tentar novamente</button>
        </>)}
      </div>
    </div>
  );
}

// ── Form fields helper ────────────────────────────────────────────────────
const EMPTY_FORM = { artist: "", album: "", year: "", genre: "", label: "", washed: false, washedDate: new Date().toISOString().split("T")[0], scratches: false, tracks: "", coverPhoto: null, coverEmoji: "💿" };

const fStyle = { width: "100%", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 4, padding: "11px 14px", color: "#f0ece4", fontSize: 16, fontFamily: "monospace", outline: "none", boxSizing: "border-box" };
const lStyle = { display: "block", fontSize: 12, fontFamily: "monospace", color: "#666", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" };

function RecordForm({ initial, onSave, onCancel, title }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{ padding: 18, maxWidth: 480 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontWeight: "normal", letterSpacing: 2, fontSize: 18, textTransform: "uppercase", margin: 0 }}>{title}</h2>
        <button style={{ background: "transparent", border: "1px solid #333", color: "#777", borderRadius: 3, padding: "7px 16px", cursor: "pointer", fontSize: 14, fontFamily: "monospace" }} onClick={onCancel}>✕ Cancelar</button>
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

      <button style={{ background: "#c0392b", border: "none", color: "#fff", borderRadius: 4, padding: "14px 32px", cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }} onClick={() => {
        const tracks = typeof form.tracks === "string" ? form.tracks.split("\n").map(t => t.trim()).filter(Boolean) : form.tracks;
        onSave({ ...form, tracks, year: parseInt(form.year) || new Date().getFullYear() });
      }}>SALVAR</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [records, setRecords] = useState(() => loadRecords() || DEMO_DATA);
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

  useEffect(() => saveRecords(records), [records]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const fa = filterArtist.toLowerCase().trim();
    const ft = filterTrack.toLowerCase().trim();
    return records.filter(r => {
      if (fa && !r.artist.toLowerCase().includes(fa) && !r.album.toLowerCase().includes(fa)) return false;
      if (ft && !r.tracks.some(t => t.toLowerCase().includes(ft))) return false;
      if (!q) return true;
      return (
        r.artist.toLowerCase().includes(q) ||
        r.album.toLowerCase().includes(q) ||
        r.label?.toLowerCase().includes(q) ||
        r.tracks.some(t => t.toLowerCase().includes(q))
      );
    });
  }, [query, records, filterArtist, filterTrack]);

  const matchedTracks = (r) => {
    const q = filterTrack || query;
    if (!q.trim()) return [];
    return r.tracks.filter(t => t.toLowerCase().includes(q.toLowerCase()));
  };

  const Hl = ({ text }) => {
    const q = (filterTrack || filterArtist || query).toLowerCase();
    if (!q) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return <span>{text.slice(0,idx)}<mark style={{ background:"#c0392b33", color:"#ff8080", padding:"0 2px", borderRadius:2, fontStyle:"normal" }}>{text.slice(idx,idx+q.length)}</mark>{text.slice(idx+q.length)}</span>;
  };

  const addRecord = (data) => {
    setRecords(p => [{ ...data, id: Date.now() }, ...p]);
    showToast(`"${data.album}" adicionado! 🎵`);
    setView("catalog");
  };

  const updateRecord = (data) => {
    setRecords(p => p.map(r => r.id === data.id ? data : r));
    setSelected(data);
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
        input::placeholder,textarea::placeholder{color:#2a2a2a}
        input:focus,textarea:focus{border-color:#c0392b!important}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#080808}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:3px}
        *{-webkit-tap-highlight-color:transparent}
      `}</style>

      {scanning && <ScanOverlay onClose={() => setScanning(false)} onDetected={handleScanDetected} />}
      {toast && <div style={{ position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)", background:"#111", border:"1px solid #c0392b55", color:"#f0ece4", padding:"12px 24px", borderRadius:8, fontFamily:"monospace", fontSize:14, zIndex:500, whiteSpace:"nowrap", boxShadow:"0 4px 20px #000" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#130707 0%,#0a0a0a 100%)", borderBottom:"1px solid #1a1a1a", padding:"18px 18px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:14 }}>
          <VinylSVG size={48} spin={query.length>0||filterArtist.length>0||filterTrack.length>0} />
          <div>
            <h1 style={{ fontSize:32, fontWeight:"normal", letterSpacing:3, color:"#f0ece4", margin:"0 0 3px" }}>Jr Collection</h1>
            <div style={{ fontSize:12, color:"#c0392b", fontFamily:"monospace", letterSpacing:3, textTransform:"uppercase" }}>Discos-LP</div>
            <div style={{ fontSize:13, color:"#555", letterSpacing:1, fontFamily:"monospace", marginTop:2 }}>{records.length} disco{records.length!==1?"s":""} no catálogo</div>
          </div>
        </div>
        {view==="catalog" && !selected && (
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"#444", fontSize:18 }}>🔍</span>
            <input style={{ width:"100%", background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:6, padding:"13px 14px 13px 44px", color:"#f0ece4", fontSize:16, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} placeholder="Busca geral: artista, disco, música…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={{ display:"flex", gap:8, padding:"10px 18px", borderBottom:"1px solid #141414", flexWrap:"wrap", alignItems:"center", background:"#080808" }}>
        <button style={nb(view==="catalog"&&!selected)} onClick={() => { setView("catalog"); setSelected(null); }}>▤ CATÁLOGO</button>
        <button style={nb(view==="add")} onClick={() => { setEditForm(null); setView("add"); }}>+ MANUAL</button>
        <button style={{ background:"linear-gradient(135deg,#c0392b,#96281b)", border:"none", color:"#fff", borderRadius:4, padding:"7px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace", letterSpacing:1, display:"flex", alignItems:"center", gap:6 }} onClick={() => setScanning(true)}>📷 ESCANEAR</button>
        {view==="catalog"&&!selected&&<span style={{ marginLeft:"auto", fontSize:12, fontFamily:"monospace", color:"#444" }}>{results.length} disco{results.length!==1?"s":""}</span>}
      </div>

      {/* ── Catalog ── */}
      {view==="catalog" && !selected && (<>
        <div style={{ display:"flex", gap:8, padding:"12px 18px", borderBottom:"1px solid #111", flexWrap:"wrap", alignItems:"center" }}>
          <input style={{ background:"#0e0e0e", border:"1px solid #1a1a1a", color:"#ddd", borderRadius:4, padding:"9px 12px", fontSize:15, fontFamily:"monospace", outline:"none", flex:1, minWidth:100 }} placeholder="🎤 Cantor / Banda" value={filterArtist} onChange={e => setFilterArtist(e.target.value)} />
          <input style={{ background:"#0e0e0e", border:"1px solid #1a1a1a", color:"#ddd", borderRadius:4, padding:"9px 12px", fontSize:15, fontFamily:"monospace", outline:"none", flex:1, minWidth:100 }} placeholder="🎵 Música" value={filterTrack} onChange={e => setFilterTrack(e.target.value)} />
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
                        <div style={{ fontSize:12, color:"#c0392b", fontFamily:"monospace", letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}><Hl text={r.artist}/></div>
                        <div style={{ fontSize:16, color:"#f0ece4", lineHeight:1.3, marginBottom:6 }}><Hl text={r.album}/></div>
                        <div style={{ fontSize:12, color:"#3a3a3a", fontFamily:"monospace", marginBottom:10 }}>{r.year} · {r.genre}</div>
                        <WashDot washed={r.washed} washedDate={r.washedDate} />
                        {mt.length>0 && <div style={{ marginTop:8, borderTop:"1px solid #141414", paddingTop:8 }}>
                          {mt.slice(0,2).map((t,i)=><div key={i} style={{ fontSize:12, fontFamily:"monospace", color:"#ff8080", padding:"2px 0" }}>♪ {t}</div>)}
                          {mt.length>2&&<div style={{ fontSize:11, color:"#333", fontFamily:"monospace" }}>+{mt.length-2} músicas</div>}
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            : <div style={{ padding:"8px 16px", display:"flex", flexDirection:"column", gap:2 }}>
                {results.map(r=>(
                  <div key={r.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 14px", background:hovCard===r.id?"#111":"transparent", borderRadius:8, cursor:"pointer", transition:"background 0.1s", borderBottom:"1px solid #111" }}
                    onMouseEnter={()=>setHovCard(r.id)} onMouseLeave={()=>setHovCard(null)} onClick={()=>{ setSelected(r); setView("detail"); }}>
                    {r.coverPhoto
                      ? <img src={r.coverPhoto} alt="capa" style={{ width:56, height:56, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
                      : <div style={{ width:56, height:56, background:"#111", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{r.coverEmoji||"💿"}</div>
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, color:"#c0392b", fontFamily:"monospace", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.artist}</div>
                      <div style={{ fontSize:17, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.album}</div>
                      <div style={{ fontSize:12, color:"#444", fontFamily:"monospace" }}>{r.year}</div>
                    </div>
                    <WashDot washed={r.washed} washedDate={r.washedDate} />
                  </div>
                ))}
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
              <div style={{ marginTop:14, display:"flex", gap:10, flexWrap:"wrap" }}>
                <button style={{ background:"#1a6fa022", border:"1px solid #1a6fa066", color:"#4db8ff", borderRadius:4, padding:"9px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace", display:"flex", alignItems:"center", gap:8 }} onClick={()=>washNow(selected.id)}><span style={{fontSize:18}}>💧</span> Lavei agora</button>
                <button style={{ background:"#e74c3c11", border:"1px solid #e74c3c33", color:"#e74c3c", borderRadius:4, padding:"9px 18px", cursor:"pointer", fontSize:14, fontFamily:"monospace" }} onClick={()=>deleteRecord(selected.id)}>🗑 Remover</button>
              </div>
            </div>
          </div>

          <div style={{ fontSize:13, fontFamily:"monospace", color:"#444", letterSpacing:1, marginBottom:8 }}>FAIXAS — {selected.tracks.length}</div>
          <div style={{ background:"#0c0c0c", border:"1px solid #141414", borderRadius:8, padding:"6px 0" }}>
            {selected.tracks.map((t,i)=>{
              const q = filterTrack||query;
              const m = q && t.toLowerCase().includes(q.toLowerCase());
              return <div key={i} style={{ padding:"8px 16px", fontSize:15, fontFamily:"monospace", color:m?"#ff8080":"#777", background:m?"#c0392b0c":"transparent", borderLeft:`3px solid ${m?"#c0392b":"transparent"}` }}>
                <span style={{ color:"#2a2a2a", marginRight:12 }}>{String(i+1).padStart(2,"0")}</span>{t}
              </div>;
            })}
          </div>
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
