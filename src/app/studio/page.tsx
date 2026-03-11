"use client";

import React, { useState, useEffect } from "react";
import {
    Upload, Plus, Trash2, Lock, Film, Edit, Save, X,
    Heart, ArrowLeft, Crown, Zap, AlertTriangle, RefreshCw, Eye, EyeOff,
    Camera, Radio, Copy, Check, Loader2, Play, Square,
    Image as ImageIcon, Video, Wifi
} from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";

// ─── Constants ────────────────────────────────────────────────────
const MAX_VIDEOS = 5;
const MAX_VIDEO_SIZE_GB = 5;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_GB * 1024 * 1024 * 1024;
const MAX_PHOTOS = 50;

// ─── Types ────────────────────────────────────────────────────────
interface Wedding {
    id: string; name: string; access_code: string; videoCount: number;
    is_live?: boolean; live_stream_url?: string;
}
interface VideoItem {
    id: string; wedding_id: string; wedding_name?: string; title: string;
    description: string; r2_key: string; thumbnail_key?: string;
    file_size_bytes?: number; created_at: string;
    processing_status?: string;
}
interface Photo {
    id: string; wedding_id: string; r2_key: string; description?: string; url?: string;
}
interface LiveEvent {
    id: string; wedding_id: string; title: string; stream_url: string;
    is_live: boolean; stream_key?: string; rtmp_url?: string;
    status?: string; hls_path?: string;
}

function formatSize(bytes: number | undefined | null): string {
    if (!bytes || bytes === 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0; let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

export default function StudioPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"weddings" | "upload" | "photos" | "live">("weddings");

    // ─── Subscription Gate ────────────────────────────────────────
    const [subStatus, setSubStatus] = useState<{ allowed: boolean; reason?: string }>({ allowed: false });
    const [subLoading, setSubLoading] = useState(true);

    // ─── Wedding (single) ─────────────────────────────────────────
    const [wedding, setWedding] = useState<Wedding | null>(null);
    const [weddingName, setWeddingName] = useState("");
    const [weddingCode, setWeddingCode] = useState("");
    const [editingWedding, setEditingWedding] = useState(false);
    const [showCode, setShowCode] = useState(false);
    const [editData, setEditData] = useState({ name: "", code: "" });

    // ─── Videos ───────────────────────────────────────────────────
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [videoTitle, setVideoTitle] = useState("");
    const [videoDescription, setVideoDescription] = useState("");
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [thumbFile, setThumbFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadStatus, setUploadStatus] = useState("");
    const [uploadSpeed, setUploadSpeed] = useState("");
    const abortRef = React.useRef<AbortController | null>(null);

    // ─── Photos ───────────────────────────────────────────────────
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

    // ─── Live Events ──────────────────────────────────────────────
    const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
    const [newLiveTitle, setNewLiveTitle] = useState("");
    const [newLiveUrl, setNewLiveUrl] = useState("");
    const [copiedField, setCopiedField] = useState<string | null>(null);

    // ─── Auth + Subscription Check ────────────────────────────────
    useEffect(() => {
        if (!authLoading && !user) { router.push("/login"); return; }
        if (user) {
            fetch("/api/user/sync", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user.uid, email: user.email, displayName: user.displayName, photoUrl: user.photoURL }),
            }).catch(console.error);

            fetch(`/api/subscription/check-upload?userId=${user.uid}`)
                .then(r => r.json())
                .then(data => { setSubStatus(data); setSubLoading(false); })
                .catch(() => setSubLoading(false));
        }
    }, [user, authLoading]);

    // Once subscription is confirmed, load wedding data
    useEffect(() => {
        if (subStatus.allowed) fetchWedding();
    }, [subStatus.allowed]);

    // When wedding is loaded, fetch all related data
    useEffect(() => {
        if (wedding) {
            fetchVideos();
            fetchPhotos();
            fetchLiveEvents();
        }
    }, [wedding?.id]);

    // ─── Data Fetchers ────────────────────────────────────────────
    const fetchWedding = async () => {
        if (!user) return;
        const res = await fetch(`/api/admin/weddings?userId=${user.uid}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            setWedding(data[0]); // User's single wedding
        } else {
            setWedding(null);
        }
    };
    const fetchVideos = async () => {
        if (!user) return;
        const res = await fetch(`/api/admin/videos?userId=${user.uid}`);
        const data = await res.json();
        if (Array.isArray(data)) setVideos(data);
    };
    const fetchPhotos = async () => {
        if (!wedding) return;
        const res = await fetch(`/api/admin/photos?weddingId=${wedding.id}`);
        const data = await res.json();
        if (Array.isArray(data)) setPhotos(data);
    };
    const fetchLiveEvents = async () => {
        if (!wedding) return;
        const res = await fetch(`/api/admin/live-events?weddingId=${wedding.id}`);
        const data = await res.json();
        if (Array.isArray(data)) setLiveEvents(data);
    };

    // ─── Wedding Actions ──────────────────────────────────────────
    const handleCreateWedding = async (e: React.FormEvent) => {
        e.preventDefault();
        if (wedding) return; // Only 1 allowed
        const res = await fetch("/api/admin/weddings", {
            method: "POST", body: JSON.stringify({ name: weddingName, accessCode: weddingCode, userId: user?.uid }),
        });
        if (res.ok) { setWeddingName(""); setWeddingCode(""); fetchWedding(); }
    };
    const handleUpdateWedding = async () => {
        if (!wedding) return;
        await fetch("/api/admin/weddings", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: wedding.id, name: editData.name, accessCode: editData.code, userId: user?.uid }),
        });
        setEditingWedding(false); fetchWedding();
    };
    const regenerateCode = () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let c = ""; for (let i = 0; i < 8; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
        setEditData({ ...editData, code: c });
    };

    // ─── Upload Logic ─────────────────────────────────────────────
    const uploadLargeFile = async (file: File, weddingId: string, label: string, signal: AbortSignal) => {
        setUploadStatus(`Creating ${label} upload...`);
        const sr = await fetch("/api/admin/presign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "startMultipart", filename: file.name, contentType: file.type, weddingId, userId: user?.uid }), signal
        });
        const sd = await sr.json();
        if (!sr.ok) throw new Error(sd.error || `Failed to start ${label}`);
        const { uploadId, key } = sd;

        const CHUNK = 20 * 1024 * 1024;
        const PARTS = Math.ceil(file.size / CHUNK);
        const completed: { partNumber: number; etag: string }[] = [];

        const allUrls: { partNumber: number; url: string }[] = [];
        for (let i = 0; i < PARTS; i += 50) {
            const batch = Array.from({ length: Math.min(50, PARTS - i) }, (_, j) => ({ partNumber: i + j + 1 }));
            const r = await fetch("/api/admin/presign", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "getPartUrls", key, uploadId, parts: batch, userId: user?.uid }), signal
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "URL gen failed");
            allUrls.push(...d.urls);
        }

        const PARALLEL = 4;
        const queue = [...allUrls];
        const t0 = Date.now();
        let activeCount = 0, successCount = 0;

        await new Promise<void>((resolve, reject) => {
            const startNext = async () => {
                if (queue.length === 0) { if (activeCount === 0) resolve(); return; }
                if (signal.aborted) return;
                const p = queue.shift()!;
                activeCount++;
                try {
                    const start = (p.partNumber - 1) * CHUNK;
                    const chunk = file.slice(start, Math.min(start + CHUNK, file.size));
                    for (let a = 1; a <= 5; a++) {
                        try {
                            const r = await fetch(p.url, { method: "PUT", body: chunk, signal, mode: "cors" });
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            let etag = r.headers.get("etag") || r.headers.get("ETag");
                            completed.push({ partNumber: p.partNumber, etag: (etag || `part${p.partNumber}`).replace(/^"|"$/g, "") });
                            break;
                        } catch (e) { if (a === 5) throw e; await new Promise(r => setTimeout(r, 2000 * Math.pow(2, a - 1))); }
                    }
                    successCount++;
                    setUploadProgress(Math.round((successCount / PARTS) * 100));
                    const elapsed = (Date.now() - t0) / 1000;
                    setUploadSpeed(`${((successCount * CHUNK / 1048576) / elapsed).toFixed(1)} MB/s`);
                    setUploadStatus(`Uploading ${label}: ${successCount}/${PARTS}`);
                    activeCount--;
                    startNext();
                } catch (err) { activeCount--; reject(err); }
            };
            for (let i = 0; i < Math.min(PARALLEL, queue.length); i++) startNext();
        });

        setUploadStatus(`Finalizing ${label}...`);
        const cr = await fetch("/api/admin/presign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "completeMultipart", uploadId, key, parts: completed, userId: user?.uid }), signal
        });
        if (!cr.ok) throw new Error(`Finalize ${label} failed`);
        return { key, size: file.size };
    };

    const handleUpload = async () => {
        if (!videoFile || !wedding || !videoTitle) return;
        if (!subStatus.allowed) { alert(subStatus.reason || "Subscription required."); router.push("/pricing"); return; }
        if (videos.length >= MAX_VIDEOS) { alert(`You can upload a maximum of ${MAX_VIDEOS} videos.`); return; }
        if (videoFile.size > MAX_VIDEO_SIZE_BYTES) { alert(`Video file exceeds the ${MAX_VIDEO_SIZE_GB}GB limit.`); return; }

        const ac = new AbortController();
        abortRef.current = ac;
        setUploading(true); setUploadProgress(0); setUploadStatus("Starting upload...");

        try {
            let thumbKey = "";
            if (thumbFile) {
                setUploadStatus("Uploading thumbnail...");
                const tk = `weddings/${wedding.id}/thumbnails/${Date.now()}-${thumbFile.name}`;
                await fetch(`/api/admin/upload-file?key=${encodeURIComponent(tk)}&contentType=${encodeURIComponent(thumbFile.type)}&userId=${user?.uid}`, { method: "POST", body: thumbFile, signal: ac.signal });
                thumbKey = tk;
            }

            const main = await uploadLargeFile(videoFile, wedding.id, "Video", ac.signal);

            setUploadStatus("Saving to database...");
            await fetch("/api/admin/videos", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    weddingId: wedding.id, title: videoTitle, description: videoDescription,
                    r2Key: main.key, thumbnailKey: thumbKey, fileSize: videoFile.size, userId: user?.uid, processingStatus: "completed"
                }),
            });

            setUploadProgress(100); setUploadStatus("✨ Video uploaded successfully!");
            setTimeout(() => { setUploading(false); setVideoFile(null); setThumbFile(null); setVideoTitle(""); setVideoDescription(""); fetchVideos(); }, 2000);
        } catch (err: any) {
            if (ac.signal.aborted) { setUploadStatus("Cancelled"); return; }
            setUploadStatus(`FAILED: ${err.message}`); alert(`Upload Error: ${err.message}`);
        } finally { setUploading(false); abortRef.current = null; }
    };

    // ─── Photo Actions ────────────────────────────────────────────
    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !wedding) return;
        if (photos.length >= MAX_PHOTOS) { alert(`Max ${MAX_PHOTOS} photos.`); return; }
        setIsUploadingPhoto(true);
        const fd = new FormData(); fd.append("file", file); fd.append("weddingId", wedding.id); fd.append("userId", user?.uid || "");
        const res = await fetch("/api/admin/photos", { method: "POST", body: fd });
        setIsUploadingPhoto(false);
        if (res.ok) fetchPhotos(); else { const err = await res.json(); alert(err.error || "Upload failed"); }
    };
    const handleDeletePhoto = async (id: string) => {
        if (!confirm("Delete this photo?")) return;
        const res = await fetch("/api/admin/photos", { method: "DELETE", body: JSON.stringify({ id, userId: user?.uid }) });
        if (res.ok) fetchPhotos();
    };

    // ─── Live Event Actions ───────────────────────────────────────
    const handleAddLiveEvent = async () => {
        if (!wedding || !newLiveTitle) return;
        const res = await fetch("/api/admin/live-events", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newLiveTitle, streamUrl: newLiveUrl, weddingId: wedding.id, userId: user?.uid })
        });
        if (res.ok) {
            const data = await res.json();
            setNewLiveTitle(""); setNewLiveUrl("");
            fetchLiveEvents();
            if (data.streamKey) alert(`✅ Live Event Created!\n\nStream Key: ${data.streamKey}\nRTMP URL: ${data.rtmpUrl}\n\nCopy these into OBS Studio.`);
        }
    };
    const handleToggleLive = async (eventId: string, currentStatus: string) => {
        const newStatus = currentStatus === "live" ? "ended" : "waiting";
        await fetch("/api/admin/live-events", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: eventId, userId: user?.uid, status: newStatus, isLive: newStatus === "waiting" })
        });
        fetchLiveEvents();
    };
    const handleDeleteLiveEvent = async (id: string) => {
        if (!confirm("Delete this live event?")) return;
        await fetch("/api/admin/live-events", { method: "DELETE", body: JSON.stringify({ id, userId: user?.uid }) });
        fetchLiveEvents();
    };
    const copyText = (text: string, field: string) => { navigator.clipboard.writeText(text); setCopiedField(field); setTimeout(() => setCopiedField(null), 2000); };

    // ─── Loading ──────────────────────────────────────────────────
    if (authLoading || subLoading) {
        return (
            <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                <Loader2 size={40} color="#c1a461" style={{ animation: "spin 1s linear infinite" }} />
            </div>
        );
    }

    // ─── Subscription Gate ────────────────────────────────────────
    if (!subStatus.allowed) {
        return (
            <div className="gate-wrap">
                <div className="gate-card">
                    <Lock size={48} color="#c1a461" />
                    <h1>Studio Access Required</h1>
                    <p>Purchase a subscription to unlock the Studio and start uploading your wedding content.</p>
                    {subStatus.reason && <div className="gate-reason">{subStatus.reason}</div>}
                    <button className="gate-btn primary" onClick={() => router.push("/pricing")}><Crown size={18} /> Explore Plans</button>
                    <button className="gate-btn secondary" onClick={() => router.push("/")}><ArrowLeft size={18} /> Back to Home</button>
                </div>
                <style jsx>{`
                    .gate-wrap { height:100vh; display:flex; align-items:center; justify-content:center; background:#000; padding:2rem; }
                    .gate-card { max-width:480px; width:100%; text-align:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:2rem; padding:3.5rem 2.5rem; }
                    .gate-card h1 { color:#fff; font-size:1.8rem; margin:1.5rem 0 0.5rem; }
                    .gate-card p { color:rgba(255,255,255,0.5); margin-bottom:2rem; line-height:1.6; }
                    .gate-reason { padding:0.75rem; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.15); border-radius:0.75rem; color:#f87171; font-size:0.85rem; margin-bottom:1.5rem; }
                    .gate-btn { width:100%; padding:1rem; border-radius:0.75rem; font-weight:700; font-size:0.95rem; display:flex; align-items:center; justify-content:center; gap:0.5rem; transition:0.2s; cursor:pointer; border:none; }
                    .gate-btn:hover { transform:translateY(-2px); }
                    .gate-btn.primary { background:#c1a461; color:#000; }
                    .gate-btn.secondary { background:rgba(255,255,255,0.05); color:#fff; margin-top:0.75rem; }
                `}</style>
            </div>
        );
    }

    const tabs = [
        { id: "weddings" as const, label: "My Wedding", icon: <Film size={18} /> },
        { id: "upload" as const, label: "Upload", icon: <Upload size={18} /> },
        { id: "photos" as const, label: "Photos", icon: <Camera size={18} /> },
        { id: "live" as const, label: "Live Stream", icon: <Radio size={18} /> },
    ];

    const videosRemaining = MAX_VIDEOS - videos.length;
    const photosRemaining = MAX_PHOTOS - photos.length;

    return (
        <div className="studio-root">
            {/* ─── Nav ─── */}
            <nav className="studio-nav">
                <button onClick={() => router.push("/dashboard")} className="nav-back"><ArrowLeft size={20} /></button>
                <div className="nav-brand"><Heart size={18} fill="#c1a461" color="#c1a461" /><span>Studio</span></div>
                <div className="nav-user">
                    <Crown size={14} color="#4ade80" />
                    <span>{user?.displayName?.split(" ")[0] || "Creator"}</span>
                </div>
            </nav>

            {/* ─── Tabs ─── */}
            <div className="tab-bar">
                {tabs.map(t => (
                    <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
                        {t.icon}<span>{t.label}</span>
                    </button>
                ))}
            </div>

            <main className="studio-main">
                {/* ═══ TAB: MY WEDDING ═══ */}
                {activeTab === "weddings" && (
                    <div className="tab-content">
                        {!wedding ? (
                            /* No wedding yet — show creation form */
                            <div className="create-section">
                                <div className="create-header">
                                    <Film size={32} color="#c1a461" />
                                    <h2>Create Your Wedding Project</h2>
                                    <p>Set up your wedding to start uploading videos, photos, and live streams.</p>
                                </div>
                                <form onSubmit={handleCreateWedding} className="create-form">
                                    <label className="field-label">Wedding Name</label>
                                    <input placeholder="e.g. Priya & Rahul" value={weddingName} onChange={e => setWeddingName(e.target.value)} required />
                                    <label className="field-label">Access Code</label>
                                    <input placeholder="e.g. PRIYA2025 (guests use this to view)" value={weddingCode} onChange={e => setWeddingCode(e.target.value.toUpperCase())} required />
                                    <button type="submit" className="btn-primary large"><Plus size={18} /> Create Wedding</button>
                                </form>
                            </div>
                        ) : editingWedding ? (
                            /* Editing wedding */
                            <div className="wedding-detail">
                                <h2><Edit size={20} /> Edit Wedding</h2>
                                <label className="field-label">Wedding Name</label>
                                <input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                                <label className="field-label">Access Code</label>
                                <div className="code-edit-row">
                                    <input value={editData.code} onChange={e => setEditData({ ...editData, code: e.target.value.toUpperCase() })} />
                                    <button onClick={regenerateCode} className="btn-ghost" title="Generate random code"><RefreshCw size={16} /></button>
                                </div>
                                <div className="edit-actions">
                                    <button onClick={handleUpdateWedding} className="btn-primary"><Save size={16} /> Save Changes</button>
                                    <button onClick={() => setEditingWedding(false)} className="btn-secondary"><X size={16} /> Cancel</button>
                                </div>
                            </div>
                        ) : (
                            /* View wedding */
                            <div className="wedding-detail">
                                <div className="wedding-header">
                                    <div className="wedding-icon"><Heart size={28} fill="#c1a461" color="#c1a461" /></div>
                                    <div>
                                        <h2 className="wedding-name">{wedding.name}</h2>
                                        <span className="wedding-sub">Your Wedding Project</span>
                                    </div>
                                    <button onClick={() => { setEditingWedding(true); setEditData({ name: wedding.name, code: wedding.access_code }); }} className="btn-icon-label"><Edit size={14} /> Edit</button>
                                </div>

                                <div className="stats-grid">
                                    <div className="stat-card">
                                        <Video size={20} color="#c1a461" />
                                        <div className="stat-value">{videos.length}<span className="stat-max">/{MAX_VIDEOS}</span></div>
                                        <div className="stat-label">Videos</div>
                                    </div>
                                    <div className="stat-card">
                                        <Camera size={20} color="#c1a461" />
                                        <div className="stat-value">{photos.length}<span className="stat-max">/{MAX_PHOTOS}</span></div>
                                        <div className="stat-label">Photos</div>
                                    </div>
                                    <div className="stat-card">
                                        <Radio size={20} color="#c1a461" />
                                        <div className="stat-value">{liveEvents.length}</div>
                                        <div className="stat-label">Live Events</div>
                                    </div>
                                </div>

                                <div className="info-row">
                                    <span className="info-label">Access Code</span>
                                    <code className="info-code">{showCode ? wedding.access_code : "••••••••"}</code>
                                    <button onClick={() => setShowCode(!showCode)} className="btn-icon">
                                        {showCode ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                    <button onClick={() => copyText(wedding.access_code, "code")} className="btn-icon">
                                        {copiedField === "code" ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                                    </button>
                                </div>

                                {/* Video list */}
                                <div className="section-title"><Video size={18} /> Videos ({videos.length}/{MAX_VIDEOS})</div>
                                <div className="video-list">
                                    {videos.map(v => (
                                        <div key={v.id} className="video-row">
                                            <div className="video-info">
                                                <strong>{v.title}</strong>
                                                <span className="video-meta">{formatSize(v.file_size_bytes)} · {v.processing_status || "completed"}</span>
                                            </div>
                                            <button onClick={() => { if (confirm(`Delete "${v.title}"?`)) fetch("/api/admin/videos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id, userId: user?.uid }) }).then(() => fetchVideos()); }} className="btn-icon danger"><Trash2 size={14} /></button>
                                        </div>
                                    ))}
                                    {videos.length === 0 && <div className="empty-state">No videos yet. Go to the Upload tab to add your first video!</div>}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ═══ TAB: UPLOAD ═══ */}
                {activeTab === "upload" && (
                    <div className="tab-content">
                        {!wedding ? (
                            <div className="empty-state-full">
                                <AlertTriangle size={32} color="#c1a461" />
                                <h3>No Wedding Project</h3>
                                <p>Create your wedding project first in the "My Wedding" tab.</p>
                                <button onClick={() => setActiveTab("weddings")} className="btn-primary">Go to My Wedding</button>
                            </div>
                        ) : (
                            <>
                                <h2><Upload size={20} /> Upload Video</h2>
                                <div className="upload-wedding-badge">
                                    <Heart size={14} fill="#c1a461" color="#c1a461" />
                                    <span>{wedding.name}</span>
                                    <span className="upload-quota">{videosRemaining} upload{videosRemaining !== 1 ? "s" : ""} remaining</span>
                                </div>

                                {videosRemaining <= 0 ? (
                                    <div className="limit-banner">
                                        <AlertTriangle size={18} />
                                        <span>You&apos;ve reached the maximum of {MAX_VIDEOS} videos. Delete an existing video to upload a new one.</span>
                                    </div>
                                ) : (
                                    <div className="upload-form">
                                        <label className="field-label">Video Title</label>
                                        <input placeholder="e.g. Ceremony Highlights" value={videoTitle} onChange={e => setVideoTitle(e.target.value)} />

                                        <label className="field-label">Description (optional)</label>
                                        <textarea placeholder="Brief description..." value={videoDescription} onChange={e => setVideoDescription(e.target.value)} rows={3} />

                                        <label className="field-label">Video File (max {MAX_VIDEO_SIZE_GB}GB)</label>
                                        <div className="file-drop" onClick={() => document.getElementById("vid-input")?.click()}>
                                            {videoFile ? (
                                                <>
                                                    <Film size={20} />
                                                    <span>{videoFile.name}</span>
                                                    <span className="file-size">{formatSize(videoFile.size)}</span>
                                                    {videoFile.size > MAX_VIDEO_SIZE_BYTES && <span className="file-error">⚠️ Exceeds {MAX_VIDEO_SIZE_GB}GB limit</span>}
                                                </>
                                            ) : (
                                                <><Upload size={24} /><span>Click to select video file</span><span className="file-hint">Max {MAX_VIDEO_SIZE_GB}GB per video</span></>
                                            )}
                                        </div>
                                        <input id="vid-input" type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] || null)} hidden />

                                        <label className="field-label">Thumbnail (optional)</label>
                                        <div className="file-drop small" onClick={() => document.getElementById("thumb-input")?.click()}>
                                            {thumbFile ? <><ImageIcon size={16} /> {thumbFile.name}</> : <><ImageIcon size={18} /><span>Select thumbnail</span></>}
                                        </div>
                                        <input id="thumb-input" type="file" accept="image/*" onChange={e => setThumbFile(e.target.files?.[0] || null)} hidden />

                                        {uploading && (
                                            <div className="progress-section">
                                                <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
                                                <div className="progress-info">
                                                    <span>{uploadStatus}</span>
                                                    <span>{uploadProgress}% {uploadSpeed && `· ${uploadSpeed}`}</span>
                                                </div>
                                            </div>
                                        )}

                                        <div className="upload-actions">
                                            <button onClick={handleUpload} disabled={uploading || !videoFile || !videoTitle || (videoFile?.size || 0) > MAX_VIDEO_SIZE_BYTES} className="btn-primary large">
                                                {uploading ? <><Loader2 size={18} className="spin" /> Uploading...</> : <><Upload size={18} /> Start Upload</>}
                                            </button>
                                            {uploading && <button onClick={() => { abortRef.current?.abort(); setUploading(false); setUploadStatus("Cancelled"); }} className="btn-danger">Cancel</button>}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ═══ TAB: PHOTOS ═══ */}
                {activeTab === "photos" && (
                    <div className="tab-content">
                        {!wedding ? (
                            <div className="empty-state-full">
                                <AlertTriangle size={32} color="#c1a461" />
                                <h3>No Wedding Project</h3>
                                <p>Create your wedding project first in the "My Wedding" tab.</p>
                                <button onClick={() => setActiveTab("weddings")} className="btn-primary">Go to My Wedding</button>
                            </div>
                        ) : (
                            <>
                                <h2><Camera size={20} /> Photo Gallery</h2>
                                <div className="upload-wedding-badge">
                                    <Heart size={14} fill="#c1a461" color="#c1a461" />
                                    <span>{wedding.name}</span>
                                    <span className="upload-quota">{photosRemaining} photo{photosRemaining !== 1 ? "s" : ""} remaining</span>
                                </div>

                                <div className="photo-upload-row">
                                    <label className="btn-primary" style={{ cursor: "pointer" }}>
                                        {isUploadingPhoto ? <><Loader2 size={16} className="spin" /> Uploading...</> : <><Plus size={16} /> Add Photo</>}
                                        <input type="file" accept="image/*" onChange={handlePhotoUpload} hidden disabled={isUploadingPhoto || photos.length >= MAX_PHOTOS} />
                                    </label>
                                    <span className="photo-count">{photos.length}/{MAX_PHOTOS} photos</span>
                                </div>

                                <div className="photo-grid">
                                    {photos.map(p => (
                                        <div key={p.id} className="photo-card">
                                            <div className="photo-img" style={{ backgroundImage: p.url ? `url(${p.url})` : "none" }}>
                                                {!p.url && <ImageIcon size={24} color="rgba(255,255,255,0.2)" />}
                                            </div>
                                            <button onClick={() => handleDeletePhoto(p.id)} className="photo-delete"><Trash2 size={12} /></button>
                                        </div>
                                    ))}
                                    {photos.length === 0 && <div className="empty-state">No photos yet. Upload your first one!</div>}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ═══ TAB: LIVE STREAM ═══ */}
                {activeTab === "live" && (
                    <div className="tab-content">
                        {!wedding ? (
                            <div className="empty-state-full">
                                <AlertTriangle size={32} color="#c1a461" />
                                <h3>No Wedding Project</h3>
                                <p>Create your wedding project first in the "My Wedding" tab.</p>
                                <button onClick={() => setActiveTab("weddings")} className="btn-primary">Go to My Wedding</button>
                            </div>
                        ) : (
                            <>
                                <h2><Radio size={20} /> Live Streaming</h2>
                                <div className="upload-wedding-badge">
                                    <Heart size={14} fill="#c1a461" color="#c1a461" />
                                    <span>{wedding.name}</span>
                                </div>

                                <div className="create-live">
                                    <h3><Plus size={16} /> New Live Event</h3>
                                    <input placeholder="Event title (e.g. Ceremony)" value={newLiveTitle} onChange={e => setNewLiveTitle(e.target.value)} />
                                    <input placeholder="Stream URL (optional)" value={newLiveUrl} onChange={e => setNewLiveUrl(e.target.value)} />
                                    <button onClick={handleAddLiveEvent} disabled={!newLiveTitle} className="btn-primary"><Radio size={16} /> Create Event</button>
                                </div>

                                <div className="section-title"><Wifi size={18} /> Events ({liveEvents.length})</div>
                                {liveEvents.map(ev => (
                                    <div key={ev.id} className="live-card">
                                        <div className="live-top">
                                            <div className={`live-dot ${ev.status === "live" ? "on" : ""}`} />
                                            <strong>{ev.title}</strong>
                                            <span className={`live-status ${ev.status}`}>{ev.status || "idle"}</span>
                                        </div>
                                        {ev.stream_key && (
                                            <div className="live-keys">
                                                <div className="key-row">
                                                    <span className="key-label">Stream Key</span>
                                                    <code>{ev.stream_key}</code>
                                                    <button onClick={() => copyText(ev.stream_key!, `sk-${ev.id}`)} className="btn-icon">
                                                        {copiedField === `sk-${ev.id}` ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                                                    </button>
                                                </div>
                                                {ev.rtmp_url && (
                                                    <div className="key-row">
                                                        <span className="key-label">RTMP URL</span>
                                                        <code>{ev.rtmp_url}</code>
                                                        <button onClick={() => copyText(ev.rtmp_url!, `rtmp-${ev.id}`)} className="btn-icon">
                                                            {copiedField === `rtmp-${ev.id}` ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="live-actions">
                                            <button onClick={() => handleToggleLive(ev.id, ev.status || "idle")} className={`btn-live ${ev.status === "live" ? "stop" : "start"}`}>
                                                {ev.status === "live" ? <><Square size={14} /> End</> : <><Play size={14} /> Go Live</>}
                                            </button>
                                            <button onClick={() => handleDeleteLiveEvent(ev.id)} className="btn-icon danger"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                ))}
                                {liveEvents.length === 0 && <div className="empty-state">No live events. Create one to get started!</div>}
                            </>
                        )}
                    </div>
                )}
            </main>

            <style jsx>{`
                .studio-root { min-height:100vh; background:#000; color:#fff; font-family:'Outfit',sans-serif; }

                /* Nav */
                .studio-nav { position:fixed; top:0; left:0; right:0; z-index:100; height:60px; padding:0 1.5rem; display:flex; align-items:center; gap:1rem; background:rgba(0,0,0,0.9); backdrop-filter:blur(16px); border-bottom:1px solid rgba(255,255,255,0.06); }
                .nav-back { color:rgba(255,255,255,0.5); transition:0.2s; } .nav-back:hover { color:#fff; }
                .nav-brand { display:flex; align-items:center; gap:0.5rem; font-weight:800; font-size:1.1rem; }
                .nav-user { margin-left:auto; display:flex; align-items:center; gap:0.4rem; font-size:0.8rem; color:rgba(255,255,255,0.5); background:rgba(255,255,255,0.04); padding:0.4rem 0.8rem; border-radius:100px; border:1px solid rgba(255,255,255,0.06); }

                /* Tab Bar */
                .tab-bar { position:fixed; top:60px; left:0; right:0; z-index:99; display:flex; background:rgba(0,0,0,0.85); backdrop-filter:blur(12px); border-bottom:1px solid rgba(255,255,255,0.06); padding:0 1.5rem; overflow-x:auto; }
                .tab-btn { display:flex; align-items:center; gap:0.45rem; padding:1rem 1.25rem; font-size:0.85rem; font-weight:600; color:rgba(255,255,255,0.4); transition:0.2s; border-bottom:2px solid transparent; white-space:nowrap; cursor:pointer; background:none; border-top:none; border-left:none; border-right:none; }
                .tab-btn:hover { color:rgba(255,255,255,0.7); }
                .tab-btn.active { color:#c1a461; border-bottom-color:#c1a461; }

                /* Main */
                .studio-main { max-width:800px; margin:0 auto; padding:130px 1.5rem 4rem; }
                .tab-content { animation:fadeIn 0.3s ease; }
                @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }

                /* Typography */
                h2 { display:flex; align-items:center; gap:0.5rem; font-size:1.4rem; margin-bottom:1.5rem; color:#fff; }
                h2 :global(svg) { color:#c1a461; }
                .section-title { display:flex; align-items:center; gap:0.5rem; font-weight:700; font-size:0.95rem; color:#c1a461; margin:1.5rem 0 0.75rem; }
                .field-label { display:block; font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.05em; margin:1rem 0 0.4rem; }

                /* Forms */
                input, select, textarea { width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.75rem; padding:0.8rem 1rem; color:#fff; font-size:0.9rem; font-family:inherit; transition:0.2s; }
                input:focus, select:focus, textarea:focus { outline:none; border-color:#c1a461; background:rgba(255,255,255,0.06); }
                textarea { resize:vertical; }

                /* Buttons */
                .btn-primary { display:inline-flex; align-items:center; gap:0.4rem; background:#c1a461; color:#000; padding:0.7rem 1.2rem; border-radius:0.75rem; font-weight:700; font-size:0.85rem; border:none; cursor:pointer; transition:0.2s; white-space:nowrap; }
                .btn-primary:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(193,164,97,0.3); }
                .btn-primary:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }
                .btn-primary.large { width:100%; justify-content:center; padding:1rem; font-size:0.95rem; }
                .btn-secondary { display:inline-flex; align-items:center; gap:0.4rem; background:rgba(255,255,255,0.05); color:#fff; padding:0.7rem 1.2rem; border-radius:0.75rem; font-weight:600; font-size:0.85rem; border:none; cursor:pointer; transition:0.2s; }
                .btn-danger { display:flex; align-items:center; gap:0.4rem; background:rgba(239,68,68,0.1); color:#f87171; padding:0.6rem 1rem; border-radius:0.6rem; font-weight:700; font-size:0.8rem; border:none; cursor:pointer; transition:0.2s; }
                .btn-danger:hover { background:rgba(239,68,68,0.2); }
                .btn-ghost { color:rgba(255,255,255,0.4); transition:0.2s; cursor:pointer; background:none; border:none; padding:0.5rem; border-radius:0.5rem; }
                .btn-ghost:hover { color:#fff; background:rgba(255,255,255,0.06); }
                .btn-icon { padding:0.4rem; border-radius:0.4rem; color:rgba(255,255,255,0.3); transition:0.2s; cursor:pointer; background:none; border:none; }
                .btn-icon:hover { color:#fff; background:rgba(255,255,255,0.06); }
                .btn-icon.danger:hover { color:#f87171; background:rgba(239,68,68,0.1); }
                .btn-icon-label { display:flex; align-items:center; gap:0.3rem; font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.4); transition:0.2s; cursor:pointer; background:none; border:none; }
                .btn-icon-label:hover { color:#c1a461; }

                /* Create Wedding */
                .create-section { text-align:center; padding:3rem 0; }
                .create-header { margin-bottom:2rem; }
                .create-header h2 { justify-content:center; }
                .create-header p { color:rgba(255,255,255,0.4); font-size:0.9rem; }
                .create-form { max-width:400px; margin:0 auto; text-align:left; }

                /* Wedding Detail */
                .wedding-detail { }
                .wedding-header { display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem; }
                .wedding-icon { width:56px; height:56px; border-radius:1rem; background:rgba(193,164,97,0.08); display:flex; align-items:center; justify-content:center; }
                .wedding-name { font-size:1.5rem; margin:0; }
                .wedding-sub { font-size:0.8rem; color:rgba(255,255,255,0.35); }
                .wedding-header .btn-icon-label { margin-left:auto; }

                /* Stats Grid */
                .stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem; margin-bottom:1.5rem; }
                .stat-card { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:1rem; padding:1.25rem; text-align:center; }
                .stat-card :global(svg) { margin-bottom:0.5rem; }
                .stat-value { font-size:1.5rem; font-weight:800; }
                .stat-max { font-size:0.85rem; font-weight:400; color:rgba(255,255,255,0.3); }
                .stat-label { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.3); margin-top:0.25rem; }

                /* Info Row */
                .info-row { display:flex; align-items:center; gap:0.6rem; padding:0.8rem 1rem; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:0.75rem; margin-bottom:1rem; }
                .info-label { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.3); }
                .info-code { flex:1; font-size:0.9rem; letter-spacing:0.15em; color:rgba(255,255,255,0.7); }

                .code-edit-row { display:flex; gap:0.5rem; align-items:center; }
                .code-edit-row input { flex:1; }
                .edit-actions { display:flex; gap:0.75rem; margin-top:1.5rem; }

                /* Upload Wedding Badge */
                .upload-wedding-badge { display:flex; align-items:center; gap:0.5rem; padding:0.7rem 1rem; background:rgba(193,164,97,0.05); border:1px solid rgba(193,164,97,0.12); border-radius:0.75rem; margin-bottom:1.5rem; font-weight:600; font-size:0.9rem; }
                .upload-quota { margin-left:auto; font-size:0.75rem; font-weight:400; color:rgba(255,255,255,0.35); }

                /* Limit Banner */
                .limit-banner { display:flex; align-items:center; gap:0.75rem; padding:1.25rem; background:rgba(251,191,36,0.06); border:1px solid rgba(251,191,36,0.15); border-radius:1rem; color:#fbbf24; font-size:0.9rem; }

                /* Upload Form */
                .upload-form { display:flex; flex-direction:column; }
                .file-drop { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.5rem; padding:2rem; border:2px dashed rgba(255,255,255,0.1); border-radius:1rem; cursor:pointer; transition:0.2s; color:rgba(255,255,255,0.4); text-align:center; }
                .file-drop:hover { border-color:#c1a461; color:#c1a461; background:rgba(193,164,97,0.03); }
                .file-drop.small { padding:1rem; flex-direction:row; }
                .file-size { font-size:0.8rem; color:rgba(255,255,255,0.3); }
                .file-hint { font-size:0.75rem; color:rgba(255,255,255,0.2); }
                .file-error { font-size:0.8rem; color:#f87171; font-weight:600; }
                .progress-section { margin-top:1.5rem; }
                .progress-bar { height:6px; background:rgba(255,255,255,0.06); border-radius:100px; overflow:hidden; }
                .progress-fill { height:100%; background:linear-gradient(90deg,#c1a461,#e2c07a); border-radius:100px; transition:width 0.3s; }
                .progress-info { display:flex; justify-content:space-between; margin-top:0.5rem; font-size:0.8rem; color:rgba(255,255,255,0.4); }
                .upload-actions { display:flex; gap:0.75rem; margin-top:1.5rem; }

                /* Videos List */
                .video-list { display:flex; flex-direction:column; gap:0.5rem; }
                .video-row { display:flex; align-items:center; gap:1rem; padding:0.9rem 1rem; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:0.75rem; transition:0.2s; }
                .video-row:hover { background:rgba(255,255,255,0.04); }
                .video-info { flex:1; min-width:0; }
                .video-info strong { display:block; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
                .video-meta { font-size:0.75rem; color:rgba(255,255,255,0.3); }

                /* Photos */
                .photo-upload-row { display:flex; align-items:center; gap:1rem; margin:1rem 0; }
                .photo-count { font-size:0.8rem; color:rgba(255,255,255,0.35); }
                .photo-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:0.5rem; }
                .photo-card { position:relative; border-radius:0.75rem; overflow:hidden; aspect-ratio:1; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); }
                .photo-img { width:100%; height:100%; background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; }
                .photo-delete { position:absolute; top:0.4rem; right:0.4rem; padding:0.3rem; border-radius:0.4rem; background:rgba(0,0,0,0.7); color:#f87171; border:none; cursor:pointer; opacity:0; transition:0.2s; }
                .photo-card:hover .photo-delete { opacity:1; }

                /* Live Stream */
                .create-live { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:1rem; padding:1.25rem; margin:1rem 0; display:flex; flex-direction:column; gap:0.6rem; }
                .create-live h3 { display:flex; align-items:center; gap:0.4rem; font-size:0.95rem; color:#c1a461; }
                .live-card { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:1rem; padding:1.25rem; margin-bottom:0.75rem; transition:0.2s; }
                .live-card:hover { border-color:rgba(193,164,97,0.15); }
                .live-top { display:flex; align-items:center; gap:0.6rem; margin-bottom:0.75rem; }
                .live-dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.15); }
                .live-dot.on { background:#4ade80; box-shadow:0 0 8px #4ade80; animation:pulse 2s infinite; }
                @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
                .live-status { margin-left:auto; font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; padding:0.2rem 0.6rem; border-radius:100px; }
                .live-status.idle { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.3); }
                .live-status.waiting { background:rgba(251,191,36,0.1); color:#fbbf24; }
                .live-status.live { background:rgba(74,222,128,0.1); color:#4ade80; }
                .live-status.ended { background:rgba(239,68,68,0.1); color:#f87171; }
                .live-keys { display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.75rem; }
                .key-row { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.6rem; background:rgba(0,0,0,0.3); border-radius:0.5rem; }
                .key-label { font-size:0.65rem; color:rgba(255,255,255,0.3); text-transform:uppercase; min-width:70px; }
                .key-row code { flex:1; font-size:0.75rem; color:rgba(255,255,255,0.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .live-actions { display:flex; gap:0.5rem; }
                .btn-live { display:flex; align-items:center; gap:0.3rem; padding:0.5rem 0.9rem; border-radius:0.5rem; font-weight:700; font-size:0.8rem; border:none; cursor:pointer; transition:0.2s; }
                .btn-live.start { background:rgba(74,222,128,0.1); color:#4ade80; }
                .btn-live.start:hover { background:rgba(74,222,128,0.2); }
                .btn-live.stop { background:rgba(239,68,68,0.1); color:#f87171; }
                .btn-live.stop:hover { background:rgba(239,68,68,0.2); }

                /* Empty States */
                .empty-state { text-align:center; padding:2rem; color:rgba(255,255,255,0.2); font-size:0.9rem; grid-column:1/-1; }
                .empty-state-full { text-align:center; padding:4rem 2rem; }
                .empty-state-full h3 { color:#fff; margin:1rem 0 0.5rem; }
                .empty-state-full p { color:rgba(255,255,255,0.4); margin-bottom:1.5rem; }
                .empty-state-full .btn-primary { margin:0 auto; }

                /* Utils */
                .spin { animation:spin 1s linear infinite; }
                @keyframes spin { to { transform:rotate(360deg); } }

                /* Responsive */
                @media (max-width:640px) {
                    .stats-grid { grid-template-columns:1fr; }
                    .photo-grid { grid-template-columns:repeat(auto-fill, minmax(90px,1fr)); }
                    .tab-btn span { display:none; }
                    .tab-btn { padding:0.8rem 1rem; }
                    .wedding-header { flex-wrap:wrap; }
                }
            `}</style>
        </div>
    );
}
