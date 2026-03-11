"use client";

import React, { useState, useEffect } from "react";
import { Upload, Plus, Trash2, Lock, LayoutDashboard, Film, Settings, Edit, Save, X, ExternalLink, Info, Cpu, Sparkles, Crown, Zap, AlertTriangle, RefreshCw, Eye, EyeOff } from "lucide-react";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useAuth } from '@/components/AuthContext';
import { useRouter } from 'next/navigation';

interface Photo {
    id: string;
    wedding_id: string;
    r2_key: string;
    description?: string;
    url?: string;
}

interface LiveEvent {
    id: string;
    wedding_id: string;
    title: string;
    stream_url: string;
    is_live: boolean;
    stream_key?: string;
    rtmp_url?: string;
    status?: 'idle' | 'waiting' | 'live' | 'ended';
    hls_path?: string;
    started_at?: string;
    ended_at?: string;
}

interface Wedding {
    id: string;
    name: string;
    access_code: string;
    videoCount: number;
    is_live?: boolean;
    live_stream_url?: string;
    live_events?: LiveEvent[];
    photos?: Photo[];
}

interface Video {
    id: string;
    wedding_id: string;
    wedding_name?: string;
    title: string;
    description: string;
    r2_key: string;
    thumbnail_key?: string;
    file_size_bytes?: number;
    created_at: string;
    fast_stream_key?: string;
    low_stream_key?: string;
    chapters?: string;
    processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
    job_id?: string;
    original_key?: string;
}

function formatSize(bytes: number | undefined | null): string {
    if (!bytes || bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(i > 1 ? 2 : 0)} ${units[i]} `;
}

export default function AdminPage() {
    const { user, loading: authLoading } = useAuth();
    const adminRouter = useRouter();
    const [activeTab, setActiveTab] = useState("weddings");
    const r2PublicDomain = typeof window !== 'undefined' ? (window as any).NEXT_PUBLIC_R2_URL || "" : "";

    // ─── Subscription Gate ────────────────────────────────────────
    const [subscriptionStatus, setSubscriptionStatus] = useState<{
        allowed: boolean;
        reason?: string;
        subscription?: any;
    }>({ allowed: false });
    const [subLoading, setSubLoading] = useState(true);

    useEffect(() => {
        if (!authLoading && !user) {
            adminRouter.push('/login');
            return;
        }
        if (user) {
            // Sync user and check subscription
            fetch('/api/user/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoUrl: user.photoURL,
                }),
            }).catch(console.error);

            fetch(`/api/subscription/check-upload?userId=${user.uid}`)
                .then(r => r.json())
                .then(data => {
                    setSubscriptionStatus(data);
                    setSubLoading(false);
                })
                .catch(() => setSubLoading(false));
        }
    }, [user, authLoading]);

    const [weddings, setWeddings] = useState<Wedding[]>([]);
    const [allVideos, setAllVideos] = useState<Video[]>([]);
    const [weddingName, setWeddingName] = useState("");
    const [weddingCode, setWeddingCode] = useState("");

    const [editingWedding, setEditingWedding] = useState<string | null>(null);
    const [editingVideo, setEditingVideo] = useState<string | null>(null);
    const [deletingVideo, setDeletingVideo] = useState<string | null>(null);
    const [showCodes, setShowCodes] = useState<Record<string, boolean>>({});
    const [deletingWedding, setDeletingWedding] = useState<string | null>(null);
    const [editData, setEditData] = useState({
        name: "",
        code: "",
        title: "",
        description: "",
        chapters: "",
        isLive: false,
        liveStreamUrl: "",
        r2Key: "",
        fastStreamKey: "",
        lowStreamKey: ""
    });

    // ─── Production Pipeline (Oracle Server) ──────────────────────
    const [useOraclePipeline, setUseOraclePipeline] = useState(false);

    const [selectedWeddingId, setSelectedWeddingId] = useState("");
    const [videoTitle, setVideoTitle] = useState("");
    const [videoDescription, setVideoDescription] = useState("");
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploading, setUploading] = useState(false);

    // File states
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [midVideoFile, setMidVideoFile] = useState<File | null>(null);
    const [lowVideoFile, setLowVideoFile] = useState<File | null>(null);
    const [thumbFile, setThumbFile] = useState<File | null>(null);
    const [hlsFiles, setHlsFiles] = useState<File[]>([]);
    const [hlsWeddingId, setHlsWeddingId] = useState('');
    const [hlsTitle, setHlsTitle] = useState('');
    const [hlsUploading, setHlsUploading] = useState(false);
    const [hlsDone, setHlsDone] = useState(0);
    const [hlsFailed, setHlsFailed] = useState(0);
    const [hlsTotalFiles, setHlsTotalFiles] = useState(0);
    const [hlsStatus, setHlsStatus] = useState('');
    const [hlsKey, setHlsKey] = useState("");
    const [autoOptimize, setAutoOptimize] = useState(true);
    const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
    const [ffmpegProgress, setFfmpegProgress] = useState(0);
    const [ffmpegInstance, setFfmpegInstance] = useState<any>(null);

    // Pipeline State for more granular feedback
    const [pipeline, setPipeline] = useState<{ id: string; label: string; status: 'waiting' | 'running' | 'done' | 'error'; progress: number }[]>([]);

    const updatePipelineStep = (id: string, updates: Partial<{ status: 'waiting' | 'running' | 'done' | 'error'; progress: number }>) => {
        setPipeline(prev => prev.map(step => step.id === id ? { ...step, ...updates } : step));
    };

    // Recovery State
    const [pendingUploads, setPendingUploads] = useState<any[]>([]);
    const [managingWedding, setManagingWedding] = useState<string | null>(null);
    const [activeLiveEvents, setActiveLiveEvents] = useState<LiveEvent[]>([]);
    const [activePhotos, setActivePhotos] = useState<Photo[]>([]);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [newLiveEvent, setNewLiveEvent] = useState({ title: '', streamUrl: '', isLive: false });
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [scanningCloud, setScanningCloud] = useState(false);

    const scanCloudUploads = async () => {
        setScanningCloud(true);
        try {
            const res = await fetch("/api/admin/presign", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "listActive", userId: user?.uid })
            });
            const data = await res.json();
            if (data.uploads?.length > 0) {
                // Restore each upload's parts
                const restoredList = [];
                for (const u of data.uploads) {
                    const pr = await fetch("/api/admin/presign", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "getUploadedParts", key: u.key, uploadId: u.uploadId, userId: user?.uid })
                    });
                    const pd = await pr.json();
                    const parts = pd.parts.map((p: any) => ({ partNumber: p.partNumber, etag: p.etag }));

                    // Try to guess metadata from key (weddings/folder/videos/timestamp-name)
                    const keyParts = u.key.split('/');
                    const fileName = keyParts[keyParts.length - 1].split('-').slice(1).join('-'); // Extract original name

                    restoredList.push({
                        uploadId: u.uploadId,
                        key: u.key,
                        fileName: fileName,
                        fileSize: 0, // Unknown from R2 directly, will match when file is selected
                        completed: parts,
                        label: "Cloud Recovery",
                        weddingName: keyParts[1] || "Recovered"
                    });
                }
                const existing = JSON.parse(localStorage.getItem("pending_uploads") || "[]");
                const merged = [...existing, ...restoredList].filter((v, i, a) => a.findIndex(t => t.uploadId === v.uploadId) === i);
                localStorage.setItem("pending_uploads", JSON.stringify(merged));
                setPendingUploads(merged);
                setUploadStatus(`☁️ Found ${restoredList.length} uploads in Cloud!`);
            } else {
                setUploadStatus("☁️ No active uploads found in R2.");
            }
        } catch (e) {
            console.error("Scan Error:", e);
        } finally {
            setScanningCloud(false);
        }
    };

    useEffect(() => {
        const stored = localStorage.getItem("pending_uploads");
        if (stored) {
            try {
                setPendingUploads(JSON.parse(stored));
            } catch (e) {
                localStorage.removeItem("pending_uploads");
            }
        }
    }, []);

    // Detect file match and auto-fill
    useEffect(() => {
        if (videoFile && pendingUploads.length > 0) {
            const match = pendingUploads.find(u => u.fileName === videoFile.name && u.fileSize === videoFile.size);
            if (match && !videoTitle) {
                setVideoTitle(match.title || "");
                setVideoDescription(match.description || "");
                setSelectedWeddingId(match.weddingId || "");
                setUploadStatus(`Matching upload found! ${match.completed.length} chunks already safe in R2.`);
            }
        }
    }, [videoFile, pendingUploads, videoTitle]);

    const loadFFmpeg = async () => {
        try {
            updatePipelineStep('engine', { status: 'running' });
            if (typeof SharedArrayBuffer === 'undefined') {
                throw new Error("COOP/COEP Headers missing. SharedArrayBuffer not available.");
            }

            const ffmpeg = new FFmpeg();
            // 🚀 CDN LOADED: Loading from unpkg to avoid Cloudflare 25MB asset limit
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

            setUploadStatus("⚡ Initializing Multi-Thread Cinema Engine...");

            // Explicitly point to the Worker script to prevent browser "blocked" errors
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL} /ffmpeg-core.js`, 'application/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'application/javascript'),
            });

            setFfmpegInstance(ffmpeg);
            setFfmpegLoaded(true);
            setUploadStatus("✅ Cinema Engine Ready");
            updatePipelineStep('engine', { status: 'done', progress: 100 });
            console.log("✅ Cinema Engine Loaded Successfully");
        } catch (error: any) {
            console.error("Engine Error:", error);
            updatePipelineStep('engine', { status: 'error' });
            // Internal error - will be handled by the bypass in handleUpload
            throw error;
        }
    };

    useEffect(() => {
        if (subscriptionStatus.allowed && autoOptimize) {
            // No need to call loadFFmpeg here, it will be called by handleUpload with a watchdog
        }
    }, [subscriptionStatus.allowed, autoOptimize]);

    // Upload UI state
    const [uploadSpeed, setUploadSpeed] = useState("");
    const [uploadStatus, setUploadStatus] = useState("");
    const abortControllerRef = { current: null as AbortController | null };

    const savePendingUpload = (data: any) => {
        const stored = localStorage.getItem("pending_uploads");
        let list = stored ? JSON.parse(stored) : [];
        // Remove existing for same file/wedding if any
        list = list.filter((u: any) => !(u.fileName === data.fileName && u.weddingId === data.weddingId && u.label === data.label));
        list.push(data);
        localStorage.setItem("pending_uploads", JSON.stringify(list));
        setPendingUploads(list);
    };

    const removePendingUpload = (fileName: string, weddingId: string, label: string) => {
        const stored = localStorage.getItem("pending_uploads");
        if (stored) {
            let list = JSON.parse(stored);
            list = list.filter((u: any) => !(u.fileName === fileName && u.weddingId === weddingId && u.label === label));
            localStorage.setItem("pending_uploads", JSON.stringify(list));
            setPendingUploads(list);
        }
    };

    useEffect(() => {
        if (subscriptionStatus.allowed) {
            fetchWeddings();
            fetchAllVideos();
        }
    }, [subscriptionStatus.allowed]);

    const fetchLiveEvents = async (weddingId: string) => {
        const res = await fetch(`/api/admin/live-events?weddingId=${weddingId}`);
        const data = await res.json();
        if (Array.isArray(data)) setActiveLiveEvents(data);
    };

    const fetchPhotos = async (weddingId: string) => {
        const res = await fetch(`/api/admin/photos?weddingId=${weddingId}`);
        const data = await res.json();
        if (Array.isArray(data)) setActivePhotos(data);
    };

    const handleAddLiveEvent = async () => {
        if (!managingWedding || !newLiveEvent.title) return;
        const res = await fetch('/api/admin/live-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...newLiveEvent, weddingId: managingWedding, userId: user?.uid })
        });
        if (res.ok) {
            const data = await res.json();
            setNewLiveEvent({ title: '', streamUrl: '', isLive: false });
            fetchLiveEvents(managingWedding);
            // Show the stream key to the user
            if (data.streamKey) {
                alert(`✅ Live Event Created!\n\nStream Key: ${data.streamKey}\nRTMP URL: ${data.rtmpUrl}\n\nCopy these into OBS Studio.`);
            }
        }
    };

    const handleToggleLiveEvent = async (eventId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'live' ? 'ended' : 'waiting';
        const res = await fetch('/api/admin/live-events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: eventId,
                userId: user?.uid,
                status: newStatus,
                isLive: newStatus === 'waiting'
            })
        });
        if (res.ok && managingWedding) fetchLiveEvents(managingWedding);
    };

    const handleRegenerateStreamKey = async (eventId: string) => {
        if (!confirm('⚠️ Regenerate stream key? The old key will stop working immediately.')) return;
        const res = await fetch('/api/admin/live-events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: eventId, userId: user?.uid, regenerateKey: true })
        });
        if (res.ok && managingWedding) {
            fetchLiveEvents(managingWedding);
            const data = await res.json();
            if (data.streamKey) alert(`New Stream Key: ${data.streamKey}`);
        }
    };

    const copyToClipboard = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleDeleteLiveEvent = async (id: string) => {
        if (!confirm('Delete this live event?')) return;
        const res = await fetch('/api/admin/live-events', {
            method: 'DELETE',
            body: JSON.stringify({ id, userId: user?.uid })
        });
        if (res.ok && managingWedding) fetchLiveEvents(managingWedding);
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !managingWedding) return;

        if (activePhotos.length >= 50) {
            alert('Max 50 photos allowed.');
            return;
        }

        setIsUploadingPhoto(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('weddingId', managingWedding);
        formData.append('userId', user?.uid || '');

        const res = await fetch('/api/admin/photos', {
            method: 'POST',
            body: formData
        });

        setIsUploadingPhoto(false);
        if (res.ok) {
            fetchPhotos(managingWedding);
        } else {
            const err = await res.json();
            alert(err.error || 'Upload failed');
        }
    };

    const handleDeletePhoto = async (id: string) => {
        if (!confirm('Delete this photo?')) return;
        const res = await fetch('/api/admin/photos', {
            method: 'DELETE',
            body: JSON.stringify({ id, userId: user?.uid })
        });
        if (res.ok && managingWedding) fetchPhotos(managingWedding);
    };

    const fetchWeddings = async () => {
        if (!user) return;
        const res = await fetch(`/api/admin/weddings?userId=${user.uid}`);
        const data = await res.json();
        if (Array.isArray(data)) setWeddings(data);
    };

    const fetchAllVideos = async () => {
        if (!user) return;
        const res = await fetch(`/api/admin/videos?userId=${user.uid}`);
        const data = await res.json();
        if (Array.isArray(data)) setAllVideos(data);
    };


    const handleCreateWedding = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch("/api/admin/weddings", {
            method: "POST",
            body: JSON.stringify({ name: weddingName, accessCode: weddingCode, userId: user?.uid }),
        });
        if (res.ok) {
            setWeddingName("");
            setWeddingCode("");
            fetchWeddings();
        }
    };


    // ─── Upload: Browser → Presigned URL → R2 directly ────────────
    // Worker only generates signed URLs (lightweight, no data)
    // All file data goes: Browser → R2 (bypasses Worker completely)
    // Helper for large file upload
    const uploadLargeFile = async (file: File, weddingId: string, label: string, signal: AbortSignal, resumeData?: any, pipelineId?: string) => {
        let uploadId = resumeData?.uploadId;
        let key = resumeData?.key;
        let completed: { partNumber: number; etag: string }[] = resumeData?.completed || [];

        if (pipelineId) updatePipelineStep(pipelineId, { status: 'running', progress: 0 });

        if (!resumeData) {
            setUploadStatus(`Creating ${label} upload...`);
            const sr = await fetch("/api/admin/presign", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "startMultipart", filename: file.name,
                    contentType: file.type, weddingId, userId: user?.uid
                }), signal
            });
            const sd = await sr.json();
            if (!sr.ok) throw new Error(sd.error || `Failed to start ${label}`);
            uploadId = sd.uploadId;
            key = sd.key;

            // Initial save to recovery (including metadata)
            savePendingUpload({
                uploadId, key, fileName: file.name, fileSize: file.size,
                weddingId, weddingName, label, completed: [],
                title: videoTitle, description: videoDescription
            });
        }

        const CHUNK = 20 * 1024 * 1024;
        const PARTS = Math.ceil(file.size / CHUNK);
        const PARALLEL = 4;
        const RETRIES = 5;

        // Get URLs for all parts
        const allUrls: { partNumber: number; url: string }[] = [];
        for (let i = 0; i < PARTS; i += 50) {
            const batch = Array.from({ length: Math.min(50, PARTS - i) }, (_, j) => ({ partNumber: i + j + 1 }));
            const r = await fetch("/api/admin/presign", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "getPartUrls", key, uploadId, parts: batch, userId: user?.uid }),
                signal
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || `Failed to get URLs for ${label}`);
            allUrls.push(...d.urls);
        }

        // Filter out already completed parts
        const completedPartNums = new Set(completed.map(c => c.partNumber));
        const queue = allUrls.filter(u => !completedPartNums.has(u.partNumber));

        const t0 = Date.now();
        let activeCount = 0;
        let successCount = completed.length;

        // UI Initial Update
        const initialPct = Math.round((successCount / PARTS) * 100);
        setUploadProgress(initialPct);
        setUploadStatus(`Uploading ${label}: ${successCount}/${PARTS}`);

        const runPool = new Promise<void>((resolve, reject) => {
            const startNext = async () => {
                if (queue.length === 0) {
                    if (activeCount === 0) resolve();
                    return;
                }
                if (signal.aborted) return;

                const p = queue.shift()!;
                activeCount++;

                try {
                    const start = (p.partNumber - 1) * CHUNK;
                    const end = Math.min(start + CHUNK, file.size);
                    const chunk = file.slice(start, end);

                    let partEtag = "";
                    for (let a = 1; a <= RETRIES; a++) {
                        try {
                            if (a > 1) setUploadStatus(`Retrying ${label} (Attempt ${a}/${RETRIES})...`);
                            const r = await fetch(p.url, { method: "PUT", body: chunk, signal, mode: 'cors' });
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            let etag = r.headers.get("etag") || r.headers.get("ETag");
                            partEtag = (etag || `part${p.partNumber}`).replace(/^"|"$/g, "");
                            break;
                        } catch (e) {
                            if (a === RETRIES) throw e;
                            await new Promise(res => setTimeout(res, 2000 * Math.pow(2, a - 1)));
                        }
                    }

                    completed.push({ partNumber: p.partNumber, etag: partEtag });
                    successCount++;

                    // Persist progress INCLUDING current form state
                    savePendingUpload({
                        uploadId, key, fileName: file.name, fileSize: file.size,
                        weddingId, weddingName, label, completed: [...completed],
                        title: videoTitle, description: videoDescription
                    });

                    // UI Update
                    if (pipelineId) {
                        const totalProgress = Math.round((successCount / PARTS) * 100);
                        updatePipelineStep(pipelineId, { progress: totalProgress });
                    }
                    setUploadProgress(Math.round((successCount / PARTS) * 100));
                    const elapsed = (Date.now() - t0) / 1000;
                    const mb = ((successCount - completed.length + 1) * CHUNK) / 1048576; // Approximation of progress since resume
                    const speed = (mb / elapsed).toFixed(1);
                    setUploadSpeed(`${speed} MB/s · ${label}`);
                    setUploadStatus(`Uploading ${label}: ${successCount}/${PARTS}`);

                    activeCount--;
                    startNext();
                } catch (err) {
                    activeCount--;
                    reject(err);
                }
            };

            for (let i = 0; i < Math.min(PARALLEL, queue.length); i++) startNext();
        });

        await runPool;

        // Finalize
        setUploadStatus(`Finalizing ${label}...`);
        const cr = await fetch("/api/admin/presign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "completeMultipart", uploadId, key, parts: completed, userId: user?.uid }),
            signal
        });
        if (!cr.ok) throw new Error(`Finalize ${label} failed`);

        // Success! Clean up
        removePendingUpload(file.name, weddingId, label);
        return { key, size: file.size };
    };

    const handleTranscode = async (file: File, scale: string, name: string, pipelineId: string) => {
        if (!ffmpegInstance) return null;
        updatePipelineStep(pipelineId, { status: 'running', progress: 0 });
        setUploadStatus(`🎬 Engine: Generating ${name} version...`);
        const ffmpeg = ffmpegInstance;
        await ffmpeg.writeFile('input.mp4', await fetchFile(file));

        ffmpeg.on('progress', ({ progress }: { progress: number }) => {
            const p = Math.round(progress * 100);
            setFfmpegProgress(p);
            updatePipelineStep(pipelineId, { progress: p });
        });

        // Professional compression settings: Industry standard bitrates for streaming
        const bitrate = name === '1080p' ? '5000k' : '2800k';

        await ffmpeg.exec([
            '-i', 'input.mp4',
            '-vf', `scale=${scale}`,
            '-c:v', 'libx264',
            '-b:v', bitrate,        // Limit bitrate for smooth streaming (Fix 3)
            '-maxrate', bitrate,
            '-bufsize', `${parseInt(bitrate) * 2}k`,
            '-crf', '23',
            '-preset', 'veryfast',  // Faster browser transcoding
            '-c:a', 'aac',          // Ensure audio compatibility
            '-b:a', '128k',
            '-movflags', '+faststart', // Enable progressive download
            'output.mp4'
        ]);

        const data = await ffmpeg.readFile('output.mp4');
        return new File([data], `${name.toLowerCase()}-${file.name}`, { type: 'video/mp4' });
    };

    const handleUpload = async () => {
        if ((!videoFile && !hlsKey) || !selectedWeddingId || !videoTitle) return;

        // ─── SUBSCRIPTION GATE: Production-level entitlement check ──
        if (!subscriptionStatus.allowed) {
            alert(subscriptionStatus.reason || 'Subscription required to upload videos.');
            adminRouter.push('/pricing');
            return;
        }

        const selectedWedding = weddings.find(w => w.id === selectedWeddingId);
        const ac = new AbortController();
        abortControllerRef.current = ac;
        setUploading(true);
        setUploadProgress(0);
        setUploadStatus("Initializing upload engine...");

        const newPipeline = [
            { id: 'engine', label: useOraclePipeline ? 'Oracle Pipeline Handshake' : 'Cinema Engine Initialization', status: 'waiting' as any, progress: 0 },
            ...(autoOptimize && !useOraclePipeline && videoFile && !hlsKey ? [
                { id: 'transcode1080', label: 'Rendering 1080p HD', status: 'waiting' as any, progress: 0 },
                { id: 'transcode720', label: 'Rendering 720p SD', status: 'waiting' as any, progress: 0 }
            ] : []),
            { id: 'uploadMain', label: `Uploading ${hlsKey ? 'HLS Assets' : '4K Original'}`, status: 'waiting' as any, progress: 0 },
            ...(autoOptimize && !useOraclePipeline && videoFile && !hlsKey ? [
                { id: 'upload1080', label: 'Uploading 1080p HD', status: 'waiting' as any, progress: 0 },
                { id: 'upload720', label: 'Uploading 720p SD', status: 'waiting' as any, progress: 0 }
            ] : []),
            { id: 'db', label: 'Finalizing Database', status: 'waiting' as any, progress: 0 }
        ];
        setPipeline(newPipeline);

        try {
            let final1080p = midVideoFile;
            let final720p = lowVideoFile;

            // ─── Browser-Based Professional Transcoder ───────────────
            if (autoOptimize && videoFile && !hlsKey && !useOraclePipeline) {
                try {
                    if (!ffmpegLoaded) {
                        setUploadStatus("⏳ Waiting for Cinema Engine (15s Watchdog)...");
                        // ⚡ WATCHDOG: If engine doesn't load in 15s, skip it
                        await Promise.race([
                            loadFFmpeg(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Initialization Timeout")), 15000))
                        ]);
                    }

                    if (!final1080p) {
                        final1080p = await handleTranscode(videoFile, '1920:1080', '1080p', 'transcode1080');
                        updatePipelineStep('transcode1080', { status: 'done', progress: 100 });
                        setFfmpegProgress(0);
                    }
                    if (!final720p) {
                        final720p = await handleTranscode(videoFile, '1280:720', '720p', 'transcode720');
                        updatePipelineStep('transcode720', { status: 'done', progress: 100 });
                        setFfmpegProgress(0);
                    }
                } catch (e: any) {
                    console.warn("Cinema Engine Bypassed:", e);
                    setUploadStatus(`⚠️ System Bypassed Rendering: ${e.message || "Stalled"}. Uploading 4K only.`);
                    updatePipelineStep('engine', { status: 'error' });
                    updatePipelineStep('transcode1080', { status: 'waiting' });
                    updatePipelineStep('transcode720', { status: 'waiting' });
                    // Continue with main upload
                }
            } else if (useOraclePipeline) {
                updatePipelineStep('engine', { status: 'done', progress: 100 });
                setUploadStatus("⚡ Oracle Pipeline Handshake Complete. Offloading Transcode.");
            }

            let thumbKey = "";
            let mainKey = "";
            let midKey = "";
            let midSize = 0;
            let lowKey = "";
            let lowSize = 0;

            // 1. Thumbnail
            if (thumbFile) {
                setUploadStatus("Uploading thumbnail...");
                const tk = `weddings/${selectedWeddingId}/thumbnails/${Date.now()}-${thumbFile.name}`;
                await fetch(`/api/admin/upload-file?key=${encodeURIComponent(tk)}&contentType=${encodeURIComponent(thumbFile.type)}&userId=${user?.uid}`, { method: "POST", body: thumbFile, signal: ac.signal });
                thumbKey = tk;
            }

            // 2. Main 4K Video
            if (videoFile) {
                const pendingMain = pendingUploads.find(u => u.fileName === videoFile.name && u.fileSize === videoFile.size && u.weddingId === selectedWeddingId && u.label === "Original 4K");
                const main = await uploadLargeFile(videoFile, selectedWeddingId, "Original 4K", ac.signal, pendingMain, 'uploadMain');
                mainKey = main.key;
                updatePipelineStep('uploadMain', { status: 'done', progress: 100 });
            }

            // 3. 1080p Video
            if (final1080p) {
                const pendingMid = pendingUploads.find(u => u.fileName === final1080p.name && u.fileSize === final1080p.size && u.weddingId === selectedWeddingId && u.label === "1080p HD");
                const mid = await uploadLargeFile(final1080p, selectedWeddingId, "1080p HD", ac.signal, pendingMid, 'upload1080');
                midKey = mid.key;
                midSize = mid.size;
                updatePipelineStep('upload1080', { status: 'done', progress: 100 });
            }

            // 4. 720p Video
            if (final720p) {
                const pendingLow = pendingUploads.find(u => u.fileName === final720p.name && u.fileSize === final720p.size && u.weddingId === selectedWeddingId && u.label === "720p SD");
                const low = await uploadLargeFile(final720p, selectedWeddingId, "720p SD", ac.signal, pendingLow, 'upload720');
                lowKey = low.key;
                lowSize = low.size;
                updatePipelineStep('upload720', { status: 'done', progress: 100 });
            }

            // 5. Save to DB
            updatePipelineStep('db', { status: 'running' });
            setUploadStatus("Saving to database...");
            const dbRes = await fetch("/api/admin/videos", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    weddingId: selectedWeddingId,
                    title: videoTitle,
                    description: videoDescription,
                    r2Key: hlsKey || mainKey,
                    thumbnailKey: thumbKey,
                    fileSize: videoFile?.size || 0,
                    fastStreamKey: midKey || null,
                    fastStreamSize: midSize || null,
                    lowStreamKey: lowKey || null,
                    lowStreamSize: lowSize || null,
                    userId: user?.uid,
                    processingStatus: useOraclePipeline ? 'pending' : 'completed',
                    originalKey: useOraclePipeline ? mainKey : null
                }),
            });

            const dbData = await dbRes.json();
            const realVideoId = dbData.id;

            // 6. Trigger Oracle Server (The "Push Method")
            if (useOraclePipeline && realVideoId) {
                console.log("🚀 TRIGGERING ORACLE SERVER WEBHOOK...");
                setUploadStatus("Notifying Oracle Transcoder...");

                // --- CUSTOMIZATION POINT ---
                // Replace this URL with your Oracle VM Public IP
                const ORACLE_SERVER_IP = "http://YOUR_ORACLE_IP:5000";

                fetch(`${ORACLE_SERVER_IP}/process`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        videoId: realVideoId,
                        originalKey: mainKey
                    })
                }).catch(err => {
                    console.error("Oracle Trigger Error:", err);
                    setUploadStatus("⚠️ Video uploaded, but Oracle Server was unreachable.");
                });
            }

            setUploadProgress(100);
            updatePipelineStep('db', { status: 'done', progress: 100 });
            setUploadStatus("✨ Cinematic Video Successfully Deployed!");
            setTimeout(() => {
                setUploading(false);
                setVideoFile(null);
                setMidVideoFile(null);
                setLowVideoFile(null);
                setThumbFile(null);
                setVideoTitle("");
                setVideoDescription("");
                fetchAllVideos();
            }, 2000);

        } catch (err: any) {
            if (ac.signal.aborted) { setUploadStatus("Cancelled"); return; }
            console.error("❌ Upload Error:", err);
            setUploadStatus(`FAILED: ${err.message}`);
            alert(`Upload Error: ${err.message}`);
        } finally {
            setUploading(false);
            abortControllerRef.current = null;
        }
    };

    const handleHlsFolderUpload = async () => {
        if (!hlsFiles.length || !hlsWeddingId || !hlsTitle) {
            setHlsStatus('⚠️ Missing wedding selection or title!');
            return;
        }

        setHlsUploading(true);
        setHlsDone(0);
        setHlsFailed(0);
        setHlsStatus('⚡ Scanning folder structure...');

        const timestamp = Date.now();
        const r2Prefix = `weddings/${hlsWeddingId}/hls/${timestamp}`;
        let masterPath = '';
        let done = 0;
        let failed = 0;

        // Verify we actually have a master.m3u8 or similar
        const hasMaster = hlsFiles.some(f => (f as any).webkitRelativePath?.toLowerCase().endsWith('master.m3u8'));
        if (!hasMaster) {
            const confirmAnyway = window.confirm("Warning: No 'master.m3u8' found in this folder. The video player might not work. Continue anyway?");
            if (!confirmAnyway) {
                setHlsUploading(false);
                return;
            }
        }

        const getMime = (name: string) => {
            if (name.endsWith('.m3u8')) return 'application/x-mpegURL';
            if (name.endsWith('.m4s')) return 'video/iso.segment';
            if (name.endsWith('.mp4')) return 'video/mp4';
            if (name.endsWith('.ts')) return 'video/MP2T';
            return 'application/octet-stream';
        };

        // 1. Prepare file mapping
        let fileMap = hlsFiles.map(file => {
            const parts = (file as any).webkitRelativePath.split('/');
            const subPath = parts.slice(1).join('/');
            const r2Key = `${r2Prefix}/${subPath}`;
            if (subPath.toLowerCase() === 'master.m3u8') masterPath = r2Key;
            return { file, r2Key, contentType: getMime(file.name) as string };
        });

        // 3️⃣ Upload the Manifest LAST (Crucial for playback consistency)
        // Sort: Non-m3u8 files first, .m3u8 files last
        fileMap.sort((a, b) => {
            const aIsM3u8 = a.r2Key.toLowerCase().endsWith('.m3u8');
            const bIsM3u8 = b.r2Key.toLowerCase().endsWith('.m3u8');
            if (aIsM3u8 && !bIsM3u8) return 1;
            if (!aIsM3u8 && bIsM3u8) return -1;
            return 0;
        });

        setHlsStatus('🔗 Generating secure upload links...');
        const BATCH_SIZE = 100;
        const urlMap: Record<string, string> = {};
        for (let i = 0; i < fileMap.length; i += BATCH_SIZE) {
            const batch = fileMap.slice(i, i + BATCH_SIZE);
            const res = await fetch('/api/admin/presign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getSingleUrls', keys: batch.map(b => b.r2Key), userId: user?.uid })
            });
            if (!res.ok) throw new Error("Failed to generate upload links");
            const { urls } = await res.json();
            urls.forEach((u: any) => urlMap[u.key] = u.url);
            setHlsStatus(`🔗 Prepared ${Math.min(i + BATCH_SIZE, fileMap.length)} / ${fileMap.length} links...`);
        }

        // 2️⃣ Limit Upload Concurrency (Robust Queue System)
        const CONCURRENT = 8; // Optimal balance for R2 direct uploads
        const iter = fileMap[Symbol.iterator]();
        await Promise.all(Array.from({ length: CONCURRENT }, async () => {
            for (const item of iter) {
                const url = urlMap[item.r2Key];
                let success = false;

                // 1️⃣ Add Retry System (5 Attempts with Exponential Backoff)
                const MAX_RETRIES = 5;
                for (let retry = 1; retry <= MAX_RETRIES; retry++) {
                    try {
                        const res = await fetch(url, {
                            method: 'PUT',
                            body: item.file,
                            headers: { 'Content-Type': item.contentType },
                        });
                        if (res.ok) { success = true; break; }

                        console.warn(`[Retry ${retry}/${MAX_RETRIES}] Failed to upload ${item.file.name}: HTTP ${res.status}`);
                    } catch (e) {
                        console.error(`[Retry ${retry}/${MAX_RETRIES}] Network error for ${item.file.name}:`, e);
                    }
                    // Wait before retrying: 1s, 2s, 4s, 8s...
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retry - 1)));
                }

                if (success) {
                    done++;
                    setHlsDone(done);
                    setHlsStatus(`📤 Uploading... ${done} / ${hlsFiles.length} files`);
                } else {
                    failed++;
                    setHlsFailed(failed);
                    console.error(`❌ FINAL FAILURE: Could not upload ${item.file.name} after ${MAX_RETRIES} attempts.`);
                }
            }
        }));

        // Register in D1
        setHlsStatus('💾 Saving to database...');
        try {
            // If master.m3u8 wasn't found in current paths, fallback to prefix/master.m3u8
            const finalR2Key = masterPath || `${r2Prefix}/master.m3u8`;

            const dbRes = await fetch('/api/admin/videos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    weddingId: hlsWeddingId,
                    title: hlsTitle,
                    description: `ABR HLS — ${new Date().toLocaleDateString()}`,
                    r2Key: finalR2Key, // Use playlist as primary key so player detects HLS
                    fastStreamKey: finalR2Key,
                    fileSize: 0,
                    userId: user?.uid
                }),
            });

            if (!dbRes.ok) {
                const errorData = await dbRes.json();
                throw new Error(errorData.error || "Database registration failed");
            }

            setHlsStatus(`✅ Done! ${done} uploaded, ${failed} failed.`);
            setHlsFiles([]);
            setHlsTitle('');
            fetchAllVideos();
        } catch (dbErr: any) {
            console.error("Database error:", dbErr);
            setHlsStatus(`❌ Error saving to database: ${dbErr.message}`);
        } finally {
            setHlsUploading(false);
        }
    };

    const handleAbortUpload = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setUploading(false);
            setUploadProgress(0);
            setUploadStatus("");
            setUploadSpeed("");
        }
    };

    const handleDeleteWedding = async (id: string) => {
        try {
            const res = await fetch("/api/admin/weddings", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, userId: user?.uid }),
            });
            setDeletingWedding(null);
            if (res.ok) {
                fetchWeddings();
            } else {
                const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                alert(`Delete failed: ${err.error}`);
            }
        } catch (e: any) {
            alert(`Network error: ${e.message}`);
        }
    };

    const regenerateCode = () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let newCode = "";
        for (let i = 0; i < 8; i++) newCode += chars.charAt(Math.floor(Math.random() * chars.length));
        setEditData({ ...editData, code: newCode });
    };

    const handleUpdateWedding = async (id: string) => {
        await fetch("/api/admin/weddings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id,
                name: editData.name,
                accessCode: editData.code,
                isLive: editData.isLive,
                liveStreamUrl: editData.liveStreamUrl,
                userId: user?.uid
            }),
        });
        setEditingWedding(null);
        fetchWeddings();
    };

    const handleDeleteVideo = async (id: string) => {
        const res = await fetch("/api/admin/videos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, userId: user?.uid }),
        });
        setDeletingVideo(null);
        if (res.ok) {
            fetchAllVideos();
        } else {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            alert(`Delete failed: ${err.error}`);
        }
    };


    const handleUpdateVideo = async (id: string) => {
        await fetch("/api/admin/videos", {
            method: "PATCH",
            body: JSON.stringify({
                id,
                title: editData.title,
                description: editData.description,
                chapters: editData.chapters,
                r2Key: editData.r2Key,
                fastStreamKey: editData.fastStreamKey,
                lowStreamKey: editData.lowStreamKey,
                userId: user?.uid
            }),
        });
        setEditingVideo(null);
        fetchAllVideos();
    };

    if (authLoading || subLoading) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050505', color: 'white' }}>
                <div className="dot-pulse"></div>
                <p style={{ marginLeft: '1rem', opacity: 0.5 }}>Syncing Studio Credentials...</p>
            </div>
        );
    }

    if (!subscriptionStatus.allowed) {
        return (
            <div className="admin-login">
                <div className="login-card glass-panel" style={{ borderColor: 'var(--primary)' }}>
                    <div className="header">
                        <Lock size={40} className="lock-icon" />
                        <h1 style={{ color: 'var(--primary)' }}>Studio Version Required</h1>
                        <p>Purchase a subscription to access the Cinematic Studio Dashboard and manage your weddings.</p>
                        {subscriptionStatus.reason && (
                            <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem', marginBottom: '1.5rem', border: '1px solid rgba(239,68,68,0.2)' }}>
                                {subscriptionStatus.reason}
                            </div>
                        )}
                    </div>
                    <button onClick={() => adminRouter.push('/pricing')} style={{ background: 'var(--primary)', color: 'black', fontWeight: 800 }}>Explore Studio Plans</button>
                    <button onClick={() => adminRouter.push('/')} style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.05)', color: 'white' }}>Back to Home</button>
                </div>
                <style jsx>{`
          .admin-login { height: 100vh; display: flex; align-items: center; justify-content: center; background: #050505; color: white; padding: 20px; }
          .login-card { width: 100%; max-width: 500px; padding: 3rem; text-align: center; }
          .lock-icon { margin-bottom: 1.5rem; color: var(--primary); }
          h1 { margin-bottom: 0.5rem; font-size: 2rem; font-weight: 800; letter-spacing: -1px; }
          p { color: rgba(255,255,255,0.6); margin-bottom: 2rem; line-height: 1.6; }
          button { width: 100%; padding: 1rem; border-radius: 0.75rem; cursor: pointer; border: none; transition: 0.2s; }
          button:hover { transform: translateY(-2px); opacity: 0.9; }
        `}</style>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            <aside className="admin-sidebar glass-panel">
                <div className="logo" style={{ color: 'var(--primary)', fontWeight: 900, letterSpacing: '-1px' }}>STUDIO v2</div>
                <nav>
                    <button className={activeTab === 'weddings' ? 'active' : ''} onClick={() => setActiveTab('weddings')}>
                        <LayoutDashboard size={20} /> Weddings
                    </button>
                    <button className={activeTab === 'videos' ? 'active' : ''} onClick={() => setActiveTab('videos')}>
                        <Film size={20} /> All Videos
                    </button>
                    <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => setActiveTab('upload')}>
                        <Upload size={20} /> Upload New
                    </button>
                    <button
                        className={activeTab === 'hls' ? 'active' : ''}
                        onClick={() => setActiveTab('hls')}
                        style={activeTab === 'hls' ? {} : { borderLeft: '2px solid rgba(193,164,97,0.4)' }}
                    >
                        <Film size={20} /> Professional HLS
                    </button>
                    <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => {
                        setActiveTab('settings');
                        fetchAllVideos();
                        fetchWeddings();
                    }}>
                        <Settings size={20} /> Refresh Data
                    </button>
                </nav>
            </aside>

            <main className="admin-content">
                <header>
                    <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h2>
                </header>

                {activeTab === 'weddings' && (
                    <div className="view">
                        <div className="create-card glass-panel">
                            <h3>Register New Wedding</h3>
                            <form onSubmit={handleCreateWedding} className="grid-form">
                                <input
                                    placeholder="Client Name (e.g. John & Jane)"
                                    value={weddingName}
                                    onChange={e => setWeddingName(e.target.value)}
                                    required
                                />
                                <input
                                    placeholder="Access Code (e.g. JJ2024)"
                                    value={weddingCode}
                                    onChange={e => setWeddingCode(e.target.value)}
                                    required
                                />
                                <button type="submit"><Plus size={18} /> Create Wedding</button>
                            </form>
                        </div>

                        <div className="engine-card glass-panel" style={{ padding: '2.5rem', marginBottom: '2rem', border: '1px solid var(--primary)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, padding: '1rem', opacity: 0.1 }}><Cpu size={120} /></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '1rem' }}>
                                <Sparkles color="var(--primary)" size={28} />
                                <h3 style={{ margin: 0, color: 'var(--primary)' }}>One-Click Cinematic AI Automator</h3>
                            </div>
                            <p style={{ fontSize: '0.9rem', opacity: 0.7, maxWidth: '600px', marginBottom: '2rem' }}>
                                This active engine uses your browser to automatically generate Professional <strong>1080p and 720p</strong> variants of your 4K film. No more manual terminal commands.
                            </p>

                            <label className="checkbox-control" style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                                <div className={`toggle ${autoOptimize ? 'active' : ''}`} onClick={() => setAutoOptimize(!autoOptimize)}>
                                    <div className="handle"></div>
                                </div>
                                <div>
                                    <span style={{ fontWeight: 700, display: 'block' }}>Auto-Optimize 4K to Standard Multi-Bitrate</span>
                                    <small style={{ opacity: 0.5 }}>Industrial standard ABR logic. (Uses your CPU power)</small>
                                </div>
                            </label>

                            {!ffmpegLoaded && autoOptimize && (
                                <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div className="dot-pulse"></div> Heating cinematic engine...
                                </div>
                            )}
                        </div>

                        <div className="list-section">
                            <h3>Active Weddings</h3>
                            <div className="data-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Code</th>
                                            <th>Videos</th>
                                            <th>Live Status</th>
                                            <th>Storage Used</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {weddings.map(w => (
                                            <React.Fragment key={w.id}>
                                                <tr>
                                                    <td>
                                                        {editingWedding === w.id ? (
                                                            <input
                                                                className="table-input"
                                                                value={editData.name}
                                                                onChange={e => setEditData({ ...editData, name: e.target.value })}
                                                            />
                                                        ) : w.name}
                                                    </td>
                                                    <td>
                                                        {editingWedding === w.id ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <input
                                                                    className="table-input"
                                                                    value={editData.code}
                                                                    onChange={e => setEditData({ ...editData, code: e.target.value.toUpperCase() })}
                                                                    style={{ textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '1px' }}
                                                                />
                                                                <button
                                                                    onClick={regenerateCode}
                                                                    style={{ padding: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer' }}
                                                                    title="Regenerate random code"
                                                                >
                                                                    <RefreshCw size={14} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <code style={{ filter: showCodes[w.id] ? 'none' : 'blur(4px)', transition: '0.3s' }}>
                                                                    {showCodes[w.id] ? w.access_code : '••••••••'}
                                                                </code>
                                                                <button
                                                                    onClick={() => setShowCodes(prev => ({ ...prev, [w.id]: !prev[w.id] }))}
                                                                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '4px' }}
                                                                >
                                                                    {showCodes[w.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>{w.videoCount}</td>
                                                    <td>
                                                        {editingWedding === w.id ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', cursor: 'pointer' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={editData.isLive}
                                                                        onChange={e => setEditData({ ...editData, isLive: e.target.checked })}
                                                                    />
                                                                    Go Live
                                                                </label>
                                                                <input
                                                                    className="table-input"
                                                                    placeholder="Stream URL (.m3u8)"
                                                                    value={editData.liveStreamUrl}
                                                                    onChange={e => setEditData({ ...editData, liveStreamUrl: e.target.value })}
                                                                    style={{ fontSize: '0.7rem' }}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <div className={`status-dot ${w.is_live ? 'live' : 'offline'}`} />
                                                                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                                                    {w.is_live ? 'LIVE' : 'Offline'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#a78bfa' }}>
                                                            {formatSize(allVideos.filter(v => v.wedding_id === w.id).reduce((acc, v) => acc + (v.file_size_bytes || 0), 0))}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="action-row">
                                                            {editingWedding === w.id ? (
                                                                <>
                                                                    <button onClick={() => handleUpdateWedding(w.id)} className="save-btn"><Save size={16} /></button>
                                                                    <button onClick={() => setEditingWedding(null)} className="cancel-btn"><X size={16} /></button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button onClick={() => {
                                                                        setEditingWedding(w.id);
                                                                        setEditData({
                                                                            ...editData,
                                                                            name: w.name,
                                                                            code: w.access_code,
                                                                            isLive: !!w.is_live,
                                                                            liveStreamUrl: w.live_stream_url || ""
                                                                        });
                                                                    }} className="edit-btn" title="Edit wedding info"><Edit size={16} /></button>
                                                                    <button
                                                                        onClick={() => {
                                                                            if (managingWedding === w.id) {
                                                                                setManagingWedding(null);
                                                                            } else {
                                                                                setManagingWedding(w.id);
                                                                                fetchLiveEvents(w.id);
                                                                                fetchPhotos(w.id);
                                                                            }
                                                                        }}
                                                                        className={`edit-btn ${managingWedding === w.id ? 'active' : ''}`}
                                                                        title="Manage live events & photos"
                                                                        style={{ color: '#a78bfa' }}
                                                                    ><Zap size={16} /></button>
                                                                    <button onClick={() => window.open(`/watch/${w.id}`, '_blank')} className="view-btn"><ExternalLink size={16} /></button>
                                                                    <button
                                                                        onClick={() => setDeletingWedding(deletingWedding === w.id ? null : w.id)}
                                                                        className="delete-btn"
                                                                        title="Delete wedding"
                                                                    ><Trash2 size={16} /></button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {managingWedding === w.id && (
                                                    <tr>
                                                        <td colSpan={6} className="manage-section-cell">
                                                            <div className="manage-container">
                                                                <div className="manage-header">
                                                                    <h4>Manage Content: {w.name}</h4>
                                                                    <button onClick={() => setManagingWedding(null)} className="close-btn"><X size={16} /></button>
                                                                </div>

                                                                <div className="manage-grid">
                                                                    <div className="manage-live">
                                                                        <h5>🎥 Live Streaming ({activeLiveEvents.length})</h5>
                                                                        <div className="live-list">
                                                                            {activeLiveEvents.map(le => (
                                                                                <div key={le.id} className="live-event-card">
                                                                                    <div className="live-event-header">
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                                            <div className={`status-indicator ${le.status || (le.is_live ? 'live' : 'idle')}`} />
                                                                                            <div>
                                                                                                <strong>{le.title}</strong>
                                                                                                <span className={`stream-status-tag ${le.status || 'idle'}`}>
                                                                                                    {le.status === 'live' ? '🔴 LIVE' : le.status === 'waiting' ? '⏳ Waiting for OBS...' : le.status === 'ended' ? '⬛ Ended' : '⚪ Idle'}
                                                                                                </span>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div style={{ display: 'flex', gap: '6px' }}>
                                                                                            <button
                                                                                                onClick={() => handleToggleLiveEvent(le.id, le.status || 'idle')}
                                                                                                className={`stream-toggle-btn ${le.status === 'live' || le.status === 'waiting' ? 'stop' : 'start'}`}
                                                                                                title={le.status === 'live' || le.status === 'waiting' ? 'End Stream' : 'Enable Stream'}
                                                                                            >
                                                                                                {le.status === 'live' || le.status === 'waiting' ? '⬛ End' : '▶ Enable'}
                                                                                            </button>
                                                                                            <button onClick={() => handleDeleteLiveEvent(le.id)} className="delete-btn" style={{ padding: '4px 8px' }}><Trash2 size={12} /></button>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* OBS Configuration */}
                                                                                    {le.stream_key && (
                                                                                        <div className="obs-config-panel">
                                                                                            <div className="obs-config-label">OBS Studio Configuration</div>
                                                                                            <div className="obs-config-row">
                                                                                                <span className="obs-label">Server URL</span>
                                                                                                <div className="obs-value-row">
                                                                                                    <code className="obs-value">{le.rtmp_url || 'rtmp://YOUR_ORACLE_IP:1935/live'}</code>
                                                                                                    <button
                                                                                                        className={`copy-btn ${copiedField === `rtmp-${le.id}` ? 'copied' : ''}`}
                                                                                                        onClick={() => copyToClipboard(le.rtmp_url || 'rtmp://YOUR_ORACLE_IP:1935/live', `rtmp-${le.id}`)}
                                                                                                    >
                                                                                                        {copiedField === `rtmp-${le.id}` ? '✓' : '📋'}
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="obs-config-row">
                                                                                                <span className="obs-label">Stream Key</span>
                                                                                                <div className="obs-value-row">
                                                                                                    <code className="obs-value stream-key">{le.stream_key}</code>
                                                                                                    <button
                                                                                                        className={`copy-btn ${copiedField === `key-${le.id}` ? 'copied' : ''}`}
                                                                                                        onClick={() => copyToClipboard(le.stream_key!, `key-${le.id}`)}
                                                                                                    >
                                                                                                        {copiedField === `key-${le.id}` ? '✓' : '📋'}
                                                                                                    </button>
                                                                                                    <button
                                                                                                        className="regen-btn"
                                                                                                        onClick={() => handleRegenerateStreamKey(le.id)}
                                                                                                        title="Regenerate stream key"
                                                                                                    >
                                                                                                        <RefreshCw size={12} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                            {le.stream_url && le.is_live && (
                                                                                                <div className="obs-config-row">
                                                                                                    <span className="obs-label">HLS Output</span>
                                                                                                    <div className="obs-value-row">
                                                                                                        <code className="obs-value" style={{ color: '#4ade80' }}>{le.stream_url}</code>
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            ))}

                                                                            {/* Add New Live Event */}
                                                                            <div className="add-live-form-v2">
                                                                                <input
                                                                                    placeholder="Event Title (e.g. Main Ceremony, Reception)"
                                                                                    value={newLiveEvent.title}
                                                                                    onChange={e => setNewLiveEvent({ ...newLiveEvent, title: e.target.value })}
                                                                                    style={{ flex: 1 }}
                                                                                />
                                                                                <button onClick={handleAddLiveEvent} disabled={!newLiveEvent.title} className="create-stream-btn">
                                                                                    <Plus size={14} /> Create Stream
                                                                                </button>
                                                                            </div>
                                                                            <p style={{ fontSize: '0.7rem', opacity: 0.4, marginTop: '8px' }}>
                                                                                Stream key is auto-generated. Copy it into OBS → Settings → Stream.
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    <div className="manage-photos">
                                                                        <h5>Photos ({activePhotos.length}/50)</h5>
                                                                        <div className="photo-grid-admin">
                                                                            {activePhotos.map(p => (
                                                                                <div key={p.id} className="photo-thumb">
                                                                                    <img src={r2PublicDomain ? `https://${r2PublicDomain.replace(/^https?:\/\//, "")}/${p.r2_key}` : `/api/r2/${p.r2_key}`} />
                                                                                    <button onClick={() => handleDeletePhoto(p.id)} className="del-p"><X size={10} /></button>
                                                                                </div>
                                                                            ))}
                                                                            {activePhotos.length < 50 && (
                                                                                <label className="upload-photo-btn">
                                                                                    <input type="file" hidden accept="image/*" onChange={handlePhotoUpload} disabled={isUploadingPhoto} />
                                                                                    {isUploadingPhoto ? <RefreshCw className="spin" size={20} /> : <Plus size={20} />}
                                                                                </label>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                {deletingWedding === w.id && (
                                                    <tr>
                                                        <td colSpan={5} style={{ padding: '0.5rem 1rem 1rem' }}>
                                                            <div style={{
                                                                background: 'rgba(239,68,68,0.1)',
                                                                border: '1px solid rgba(239,68,68,0.4)',
                                                                borderRadius: '10px',
                                                                padding: '1rem 1.25rem',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '1rem',
                                                                flexWrap: 'wrap'
                                                            }}>
                                                                <Trash2 size={18} color="#f87171" />
                                                                <div style={{ flex: 1, fontSize: '0.85rem' }}>
                                                                    <strong style={{ color: '#f87171' }}>Delete &ldquo;{w.name}&rdquo;?</strong>
                                                                    <div style={{ opacity: 0.6, fontSize: '0.75rem', marginTop: '2px' }}>This will delete the wedding and all its associated video records.</div>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleDeleteWedding(w.id)}
                                                                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1.25rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                                                                >Yes, Delete</button>
                                                                <button
                                                                    onClick={() => setDeletingWedding(null)}
                                                                    style={{ background: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }}
                                                                >Cancel</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                        {weddings.length === 0 && (
                                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>No weddings registered yet.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'videos' && (
                    <div className="view">
                        <div className="list-section">
                            <div className="section-header">
                                <h3>Manage Assets</h3>
                                <div className="filters">
                                    <select onChange={e => setSelectedWeddingId(e.target.value)} value={selectedWeddingId}>
                                        <option value="">All Weddings</option>
                                        {weddings.map(w => <option key={w.id} value={w.id}>{w.name} ({w.access_code})</option>)}
                                    </select>
                                </div>
                            </div>
                            <div style={{
                                display: 'flex', gap: '1.5rem', marginBottom: '1rem', padding: '1rem 1.5rem',
                                background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)'
                            }}>
                                <div>
                                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.4, letterSpacing: '1px' }}>Total Videos</span>
                                    <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a78bfa' }}>{allVideos.length}</p>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.4, letterSpacing: '1px' }}>Total Storage</span>
                                    <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#60a5fa' }}>{formatSize(allVideos.reduce((acc, v) => acc + (v.file_size_bytes || 0), 0))}</p>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.4, letterSpacing: '1px' }}>Weddings</span>
                                    <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#34d399' }}>{weddings.length}</p>
                                </div>
                            </div>
                            <div className="data-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Preview</th>
                                            <th>Title & Info</th>
                                            <th>Size</th>
                                            <th>Wedding</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allVideos.filter(v => !selectedWeddingId || v.wedding_id === selectedWeddingId).map(v => (
                                            <React.Fragment key={v.id}>
                                                <tr>
                                                    <td style={{ width: '120px' }}>
                                                        <div className="video-thumb-small">
                                                            {v.thumbnail_key ? (
                                                                <img src={`/api/r2/${v.thumbnail_key}`} alt="thumb" />
                                                            ) : (
                                                                <Film size={20} opacity={0.3} />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {editingVideo === v.id ? (
                                                            <div className="edit-stack">
                                                                <input
                                                                    className="table-input"
                                                                    placeholder="Video Title"
                                                                    value={editData.title}
                                                                    onChange={e => setEditData({ ...editData, title: e.target.value })}
                                                                />
                                                                <textarea
                                                                    className="table-input"
                                                                    placeholder="Description"
                                                                    value={editData.description}
                                                                    onChange={e => setEditData({ ...editData, description: e.target.value })}
                                                                />
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                                    <input
                                                                        className="table-input"
                                                                        placeholder="Original/HLS Key"
                                                                        value={editData.r2Key}
                                                                        onChange={e => setEditData({ ...editData, r2Key: e.target.value })}
                                                                    />
                                                                    <input
                                                                        className="table-input"
                                                                        placeholder="1080p Key"
                                                                        value={editData.fastStreamKey}
                                                                        onChange={e => setEditData({ ...editData, fastStreamKey: e.target.value })}
                                                                    />
                                                                    <input
                                                                        className="table-input"
                                                                        placeholder="720p Key"
                                                                        value={editData.lowStreamKey}
                                                                        onChange={e => setEditData({ ...editData, lowStreamKey: e.target.value })}
                                                                    />
                                                                </div>
                                                                <textarea
                                                                    className="table-input"
                                                                    placeholder='Chapters e.g. [{"l":"Intro", "t":0}]'
                                                                    value={editData.chapters}
                                                                    onChange={e => setEditData({ ...editData, chapters: e.target.value })}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="video-meta">
                                                                <strong>{v.title}</strong>
                                                                {v.processing_status && v.processing_status !== 'completed' && (
                                                                    <span style={{
                                                                        marginLeft: '10px',
                                                                        fontSize: '0.65rem',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '12px',
                                                                        fontWeight: 800,
                                                                        textTransform: 'uppercase',
                                                                        background: v.processing_status === 'pending' ? 'rgba(245, 158, 11, 0.15)' :
                                                                            v.processing_status === 'processing' ? 'rgba(59, 130, 246, 0.15)' :
                                                                                'rgba(239, 68, 68, 0.15)',
                                                                        color: v.processing_status === 'pending' ? '#f59e0b' :
                                                                            v.processing_status === 'processing' ? '#3b82f6' :
                                                                                '#ef4444',
                                                                        border: `1px solid ${v.processing_status === 'pending' ? 'rgba(245, 158, 11, 0.3)' :
                                                                            v.processing_status === 'processing' ? 'rgba(59, 130, 246, 0.3)' :
                                                                                'rgba(239, 68, 68, 0.3)'
                                                                            }`
                                                                    }}>
                                                                        {v.processing_status === 'pending' ? '⏳ Pipeline Queue' :
                                                                            v.processing_status === 'processing' ? '⚙️ Process...' :
                                                                                '❌ Failed'}
                                                                    </span>
                                                                )}
                                                                <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>{v.description || "No description"}</p>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                                                    <code style={{ fontSize: '0.65rem', opacity: 0.6 }}>ID: {v.id}</code>
                                                                    <button
                                                                        onClick={() => {
                                                                            const url = `${window.location.origin}/watch/${v.wedding_id}/${v.id}`;
                                                                            navigator.clipboard.writeText(url);
                                                                            alert("Direct Link Copied!");
                                                                        }}
                                                                        style={{ fontSize: '0.6rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
                                                                    >
                                                                        Copy Link
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 600, color: v.file_size_bytes && v.file_size_bytes > 1073741824 ? '#f59e0b' : '#a78bfa' }}>
                                                            {v.r2_key?.endsWith('.m3u8') ? '✨ HLS ADAPTIVE' : formatSize(v.file_size_bytes)}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="wedding-tag">{v.wedding_name || weddings.find(w => w.id === v.wedding_id)?.name || 'Unknown'}</span>
                                                        <p style={{ fontSize: '0.65rem', opacity: 0.4, marginTop: '4px', fontFamily: 'monospace' }}>
                                                            📁 {v.r2_key?.split('/').slice(0, -1).join('/') || 'N/A'}
                                                        </p>
                                                    </td>
                                                    <td>
                                                        <div className="action-row">
                                                            {editingVideo === v.id ? (
                                                                <>
                                                                    <button onClick={() => handleUpdateVideo(v.id)} className="save-btn"><Save size={16} /></button>
                                                                    <button onClick={() => setEditingVideo(null)} className="cancel-btn"><X size={16} /></button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button onClick={() => {
                                                                        setEditingVideo(v.id);
                                                                        setEditData({
                                                                            ...editData,
                                                                            title: v.title,
                                                                            description: v.description || "",
                                                                            chapters: (v as any).chapters || ""
                                                                        });
                                                                    }} className="edit-btn"><Edit size={16} /></button>
                                                                    <button
                                                                        onClick={() => setDeletingVideo(deletingVideo === v.id ? null : v.id)}
                                                                        className="delete-btn"
                                                                        title="Delete video"
                                                                    ><Trash2 size={16} /></button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {deletingVideo === v.id && (
                                                    <tr>
                                                        <td colSpan={5} style={{ padding: '0.5rem 1rem 1rem' }}>
                                                            <div style={{
                                                                background: 'rgba(239,68,68,0.1)',
                                                                border: '1px solid rgba(239,68,68,0.4)',
                                                                borderRadius: '10px',
                                                                padding: '1rem 1.25rem',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '1rem',
                                                                flexWrap: 'wrap'
                                                            }}>
                                                                <Trash2 size={18} color="#f87171" />
                                                                <div style={{ flex: 1, fontSize: '0.85rem' }}>
                                                                    <strong style={{ color: '#f87171' }}>Delete &ldquo;{v.title}&rdquo;?</strong>
                                                                    <div style={{ opacity: 0.6, fontSize: '0.75rem', marginTop: '2px' }}>This will permanently remove all R2 files (HLS segments, thumbnails) and the database record.</div>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleDeleteVideo(v.id)}
                                                                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', padding: '0.5rem 1.25rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                                                                >Yes, Delete</button>
                                                                <button
                                                                    onClick={() => setDeletingVideo(null)}
                                                                    style={{ background: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }}
                                                                >Cancel</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'hls' && (
                    <div className="upload-view">
                        <div className="upload-container glass-panel">
                            <Film size={48} color="var(--primary)" />
                            <h3>HLS Folder Upload</h3>
                            <p style={{ marginBottom: '0.5rem' }}>After converting with FFmpeg, select your <strong>ABR_FAST</strong> output folder below. All segments and playlists will upload concurrently to R2 and be registered in the database automatically.</p>

                            <div style={{ background: 'rgba(193,164,97,0.08)', border: '1px solid rgba(193,164,97,0.2)', borderRadius: '1rem', padding: '1.5rem', textAlign: 'left', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                                <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '8px' }}>📋 Workflow</strong>
                                <ol style={{ paddingLeft: '1.2rem', opacity: 0.8, lineHeight: 1.7 }}>
                                    <li>Run FFmpeg ABR transcode → produces <code style={{ color: 'var(--primary)' }}>ABR_FAST/</code> folder</li>
                                    <li>Select the <code style={{ color: 'var(--primary)' }}>ABR_FAST</code> folder below</li>
                                    <li>Pick a wedding &amp; enter the video title</li>
                                    <li>Click <strong>Upload All Files</strong> — done! ✨</li>
                                </ol>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: '1rem', border: '1px solid rgba(193,164,97,0.15)', textAlign: 'left', marginBottom: '1.5rem' }}>
                                <h4 style={{ color: 'var(--primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                                    <Info size={16} /> Optimal FFmpeg ABR Command
                                </h4>
                                <p style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.75rem' }}>
                                    Generate professional 6-sec segments with industry bitrates (Fix 2 & 3):
                                </p>
                                <div style={{ background: '#050505', padding: '0.75rem', borderRadius: '0.5rem', fontFamily: 'monospace', fontSize: '0.7rem', color: '#4ade80', border: '1px solid #222', wordBreak: 'break-all' }}>
                                    ffmpeg -i input.mp4 -hls_time 6 -hls_playlist_type vod -hls_segment_filename "v%v/seg_%03d.ts" -master_pl_name master.m3u8 -b:v:0 5000k -s:v:0 1920x1080 -b:v:1 2800k -s:v:1 1280x720 -b:v:2 1200k -s:v:2 854x480 -map 0:v -map 0:a -map 0:v -map 0:a -map 0:v -map 0:a -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" ABR_FAST/master.m3u8
                                </div>
                            </div>

                            <div className="upload-controls">
                                <select
                                    value={hlsWeddingId}
                                    onChange={e => setHlsWeddingId(e.target.value)}
                                    required
                                >
                                    <option value="">Select Wedding...</option>
                                    {weddings.map(w => <option key={w.id} value={w.id}>{w.name} ({w.access_code})</option>)}
                                </select>

                                <input
                                    type="text"
                                    placeholder="Video Title (e.g. Rituals Evening)"
                                    value={hlsTitle}
                                    onChange={e => setHlsTitle(e.target.value)}
                                    required
                                />

                                <div style={{ position: 'relative', border: '2px dashed rgba(193,164,97,0.4)', borderRadius: '1rem', padding: '2rem', textAlign: 'center', cursor: 'pointer', transition: '0.3s' }}
                                    onDragOver={e => e.preventDefault()}
                                >
                                    <Film size={32} color="var(--primary)" style={{ marginBottom: '0.75rem' }} />
                                    <p style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                                        {hlsFiles.length > 0
                                            ? `✅ ${hlsFiles.length} files selected from folder`
                                            : 'Click to select ABR_FAST folder'}
                                    </p>
                                    <small style={{ opacity: 0.5 }}>Selects all .m3u8, .m4s, .mp4 segments recursively</small>
                                    <input
                                        type="file"
                                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                                        ref={el => { if (el) el.setAttribute('webkitdirectory', ''); }}
                                        multiple
                                        onChange={e => {
                                            const files = Array.from(e.target.files || []);
                                            setHlsFiles(files);
                                            setHlsTotalFiles(files.length);
                                            setHlsStatus('');
                                            setHlsDone(0);
                                            setHlsFailed(0);
                                        }}
                                    />
                                </div>

                                {hlsFiles.length > 0 && (
                                    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '0.75rem', padding: '1rem', textAlign: 'left', fontSize: '0.8rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span>Files selected</span>
                                            <strong style={{ color: 'var(--primary)' }}>{hlsFiles.length}</strong>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span>Total size</span>
                                            <strong style={{ color: 'var(--primary)' }}>
                                                {formatSize(hlsFiles.reduce((a, f) => a + f.size, 0))}
                                            </strong>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Root folder</span>
                                            <strong style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>
                                                {(hlsFiles[0] as any).webkitRelativePath?.split('/')[0] || '—'}
                                            </strong>
                                        </div>
                                    </div>
                                )}

                                {hlsUploading && (
                                    <div style={{ marginTop: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                                            <span>{hlsStatus}</span>
                                            <span style={{ color: 'var(--primary)' }}>{Math.round((hlsDone / Math.max(hlsFiles.length, 1)) * 100)}%</span>
                                        </div>
                                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${Math.round((hlsDone / Math.max(hlsFiles.length, 1)) * 100)}%`,
                                                background: 'var(--primary)',
                                                transition: 'width 0.3s ease',
                                                borderRadius: '3px'
                                            }} />
                                        </div>
                                        <div style={{ display: 'flex', gap: '1rem', marginTop: '6px', fontSize: '0.75rem', opacity: 0.6 }}>
                                            <span>✅ {hlsDone} uploaded</span>
                                            {hlsFailed > 0 && <span style={{ color: '#f87171' }}>❌ {hlsFailed} failed</span>}
                                        </div>
                                    </div>
                                )}

                                {!hlsUploading && hlsStatus && (
                                    <div style={{ padding: '1rem', background: hlsStatus.startsWith('✅') ? 'rgba(74,222,128,0.1)' : 'rgba(193,164,97,0.1)', borderRadius: '0.75rem', border: `1px solid ${hlsStatus.startsWith('✅') ? 'rgba(74,222,128,0.3)' : 'rgba(193,164,97,0.3)'}`, fontSize: '0.9rem', fontWeight: 600 }}>
                                        {hlsStatus}
                                    </div>
                                )}

                                <button
                                    className="upload-btn"
                                    onClick={handleHlsFolderUpload}
                                    disabled={hlsUploading || !hlsFiles.length || !hlsWeddingId || !hlsTitle}
                                    style={{ opacity: (hlsUploading || !hlsFiles.length || !hlsWeddingId || !hlsTitle) ? 0.5 : 1 }}
                                >
                                    {hlsUploading
                                        ? `Uploading... ${hlsDone}/${hlsFiles.length}`
                                        : `🚀 Upload All ${hlsFiles.length || ''} Files to R2`}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'upload' && (
                    <div className="upload-view">
                        <div className="upload-container glass-panel">
                            <Upload size={48} color="var(--primary)" />
                            <h3>Upload 4K Video Assets</h3>
                            <p>Supports files up to 100GB. Files are uploaded directly to R2.</p>

                            <div className="network-tip" style={{
                                marginTop: '1.5rem', padding: '1rem', background: 'rgba(193, 164, 97, 0.1)',
                                border: '1px solid rgba(193, 164, 97, 0.2)', borderRadius: '12px', textAlign: 'left',
                                display: 'flex', gap: '1rem', alignItems: 'center'
                            }}>
                                <Info size={24} color="var(--primary)" />
                                <div style={{ fontSize: '0.85rem' }}>
                                    <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '4px' }}>Industry Standard Deployment Tip</strong>
                                    To prevent video "sticking" or buffering, we highly recommend uploading an <strong>Optimized Version</strong> (720p/1080p, ~5-10Mbps) alongside your 4K Master. Our player will automatically switch to it on slow networks.
                                </div>
                            </div>

                            {pendingUploads.length > 0 && (
                                <div className="recovery-alert" style={{
                                    background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)',
                                    borderRadius: '12px', padding: '1rem', marginTop: '1rem', textAlign: 'left'
                                }}>
                                    <h4 style={{ color: '#34d399', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Upload size={16} /> Interrupted Uploads Detected
                                    </h4>
                                    <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.75rem' }}>We found unfinished uploads from your last session. To resume, simply select the same files again and click "Start Upload".</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {pendingUploads.map((u, i) => (
                                            <div key={i} style={{ fontSize: '0.75rem', opacity: 0.9, display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                                                <span>{u.fileName} ({u.label})</span>
                                                <span style={{ color: '#34d399' }}>{u.completed.length} chunks Uploaded</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                        <button
                                            onClick={() => { localStorage.removeItem("pending_uploads"); setPendingUploads([]); }}
                                            style={{ fontSize: '0.7rem', opacity: 0.5, textDecoration: 'underline', border: 'none', background: 'none', color: 'white', cursor: 'pointer' }}
                                        >
                                            Clear recovery cache
                                        </button>
                                        <button
                                            onClick={scanCloudUploads}
                                            disabled={scanningCloud}
                                            style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', padding: '4px 12px', borderRadius: '6px', border: '1px solid currentColor', fontWeight: 600 }}
                                        >
                                            {scanningCloud ? "Scanning..." : "☁️ Refresh from Cloud"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1.25rem', marginTop: '1rem', textAlign: 'left' }}>
                                <h4 style={{ color: '#60a5fa', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Sparkles size={18} /> Enable Ultra-Fast CDN Caching
                                </h4>
                                <p style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.8rem' }}>
                                    To get zero-buffering (Netflix style), you must enable <strong>Edge Caching</strong> on your R2 domain.
                                </p>
                                <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                                    <strong>How to enable:</strong> In Cloudflare Dashboard → Rules → Page Rules → Create Page Rule.
                                    <br />Match: <code>{r2PublicDomain ? `*${r2PublicDomain}/*` : 'your-cdn-domain.com/*'}</code>
                                    <br />Setting: <strong>Cache Level</strong> = <code>Cache Everything</code>, <strong>Edge Cache TTL</strong> = <code>1 Month</code>.
                                </div>
                            </div>

                            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '1.25rem', marginTop: '1rem', textAlign: 'left' }}>
                                <h4 style={{ color: '#f87171', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Info size={18} /> Fix "Worker exceeded resource limits" (Fix 1)
                                </h4>
                                <p style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.8rem' }}>
                                    If your video stops playing with Error 1102, it's because the Worker is hit by streaming traffic.
                                </p>
                                <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                                    <strong>Solution:</strong> In Cloudflare Dashboard, add environment variable <code>R2_PUBLIC_DOMAIN</code> set to your R2 public bucket URL (e.g., <code>pub-xxxx.r2.dev</code>). We've already implemented the auto-redirect logic!
                                </div>
                            </div>

                            {!pendingUploads.length && (
                                <button
                                    onClick={scanCloudUploads}
                                    className="cloud-recovery-btn"
                                    style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--primary)', opacity: 0.7, textDecoration: 'underline', background: 'none', border: 'none' }}
                                >
                                    {scanningCloud ? "Scanning Cloud..." : "Scan Cloud for interrupted uploads"}
                                </button>
                            )}

                            <div className="upload-controls">
                                <select value={selectedWeddingId} onChange={e => setSelectedWeddingId(e.target.value)} required>
                                    <option value="">Select Wedding...</option>
                                    {weddings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                                <input
                                    type="text"
                                    placeholder="Video Title (e.g. The Trailer)"
                                    value={videoTitle}
                                    onChange={e => setVideoTitle(e.target.value)}
                                    required
                                />
                                <textarea
                                    placeholder="Video Description"
                                    value={videoDescription}
                                    onChange={e => setVideoDescription(e.target.value)}
                                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '1rem', borderRadius: '0.75rem', color: 'white', minHeight: '80px' }}
                                />

                                <div style={{
                                    padding: '1rem',
                                    background: 'rgba(193, 164, 97, 0.05)',
                                    border: '1px solid rgba(193, 164, 97, 0.2)',
                                    borderRadius: '12px',
                                    marginTop: '0.5rem',
                                    marginBottom: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    cursor: 'pointer'
                                }} onClick={() => setUseOraclePipeline(!useOraclePipeline)}>
                                    <div style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '6px',
                                        background: useOraclePipeline ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        border: useOraclePipeline ? 'none' : '1px solid rgba(255,255,255,0.2)',
                                        transition: '0.2s'
                                    }}>
                                        {useOraclePipeline && <Sparkles size={14} color="black" />}
                                    </div>
                                    <div style={{ textAlign: 'left', flex: 1 }}>
                                        <div style={{ color: useOraclePipeline ? 'var(--primary)' : 'white', fontWeight: 800, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            Use Production Microservices Pipeline
                                        </div>
                                        <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '2px' }}>
                                            Offload FFmpeg transcoding to an external Oracle Cloud Server. Best for 4K Original uploads.
                                        </div>
                                    </div>
                                </div>


                                <div
                                    onClick={() => setActiveTab('hls')}
                                    style={{ cursor: 'pointer', textAlign: 'left', background: 'rgba(193, 164, 97, 0.08)', padding: '1.25rem 1.5rem', borderRadius: '1rem', border: '1px solid rgba(193, 164, 97, 0.3)', display: 'flex', alignItems: 'center', gap: '1rem', transition: '0.2s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(193,164,97,0.15)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(193,164,97,0.08)')}
                                >
                                    <Film size={28} color="var(--primary)" style={{ flexShrink: 0 }} />
                                    <div>
                                        <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '2px' }}>
                                            Uploading an HLS / ABR folder?
                                        </div>
                                        <div style={{ fontSize: '0.82rem', opacity: 0.65 }}>
                                            Use the <strong style={{ color: 'var(--primary)' }}>HLS Folder Upload</strong> tab in the sidebar → select your <code>ABR_FAST/</code> folder and all segments upload automatically.
                                        </div>
                                    </div>
                                    <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: '1.2rem' }}>›</span>
                                </div>


                                <div className="file-selectors">
                                    <label className={`file-btn ${(!selectedWeddingId || !videoTitle) ? 'disabled' : ''}`}>
                                        <Film size={20} />
                                        <span>{videoFile ? videoFile.name : "Select 4K Film"}</span>
                                        <input type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] || null)} hidden disabled={uploading} />
                                    </label>

                                    <label className={`file-btn ${(!selectedWeddingId || !videoTitle) ? 'disabled' : ''}`} style={{ borderColor: '#60a5fa', backgroundColor: 'rgba(96, 165, 250, 0.05)' }}>
                                        <Film size={20} color="#60a5fa" />
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700 }}>{midVideoFile ? midVideoFile.name : "1080p Full HD"}</span>
                                            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Standard Quality</span>
                                        </div>
                                        <input type="file" accept="video/*" onChange={e => setMidVideoFile(e.target.files?.[0] || null)} hidden disabled={uploading} />
                                    </label>

                                    <label className={`file-btn ${(!selectedWeddingId || !videoTitle) ? 'disabled' : ''}`} style={{ borderColor: 'rgba(52, 211, 153, 0.2)', backgroundColor: 'rgba(52, 211, 153, 0.05)' }}>
                                        <Film size={20} color="#34d399" />
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700 }}>{lowVideoFile ? lowVideoFile.name : "720p Optimized"}</span>
                                            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Prevents buffering on mobile</span>
                                        </div>
                                        <input type="file" accept="video/*" onChange={e => setLowVideoFile(e.target.files?.[0] || null)} hidden disabled={uploading} />
                                    </label>

                                    <label className={`file-btn secondary ${(!selectedWeddingId || !videoTitle) ? 'disabled' : ''}`}>
                                        <Plus size={20} />
                                        <span>{thumbFile ? thumbFile.name : "Add Thumbnail (Optional)"}</span>
                                        <input type="file" accept="image/*" onChange={e => setThumbFile(e.target.files?.[0] || null)} hidden disabled={uploading} />
                                    </label>
                                </div>

                                <button
                                    className="upload-submit-btn"
                                    onClick={handleUpload}
                                    disabled={(!videoFile && !hlsKey) || uploading || !selectedWeddingId || !videoTitle}
                                >
                                    {uploading ? (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                            <div className="dot-pulse"></div>
                                            <span>System Pipeline Active</span>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                            <Cpu size={20} />
                                            <span>Start All-in-One Automated Upload</span>
                                        </div>
                                    )}
                                </button>

                                {uploading && (
                                    <div className="upload-pipeline glass-panel">
                                        <div className="pipeline-header">
                                            <Cpu size={20} color="var(--primary)" />
                                            <h4>Production Pipeline Status</h4>
                                        </div>
                                        <div className="pipeline-steps">
                                            {pipeline.map((step, idx) => (
                                                <div key={step.id} className={`pipeline-step ${step.status}`}>
                                                    <div className="step-indicator">
                                                        {step.status === 'done' ? '✓' : idx + 1}
                                                        {step.status === 'running' && <div className="step-spinner"></div>}
                                                    </div>
                                                    <div className="step-content">
                                                        <div className="step-info">
                                                            <span>{step.label}</span>
                                                            {step.status === 'running' && <strong>{step.progress}%</strong>}
                                                        </div>
                                                        {(step.status === 'running' || step.status === 'done') && (
                                                            <div className="step-progress-wrapper">
                                                                <div className="step-progress-fill" style={{ width: `${step.progress}%` }}></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="pipeline-footer">
                                            <p>{uploadStatus}</p>
                                            {uploadSpeed && <small>{uploadSpeed}</small>}
                                        </div>
                                    </div>
                                )}
                                {uploading && (
                                    <button
                                        className="abort-btn"
                                        onClick={handleAbortUpload}
                                        style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(255,77,77,0.15)', color: '#ff4d4d', borderRadius: '0.75rem', width: '100%', fontWeight: 600 }}
                                    >
                                        ✕ Cancel Upload
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <style jsx>{`
        .admin-dashboard { display: flex; height: 100vh; background: #000; color: white; }
        .admin-sidebar { width: 280px; margin: 1rem; padding: 2rem; border-radius: 1.5rem; }
        .logo { font-size: 1.5rem; font-weight: 800; color: var(--primary); margin-bottom: 3rem; }
        nav { display: flex; flex-direction: column; gap: 0.5rem; }
        nav button { display: flex; align-items: center; gap: 1rem; padding: 1rem; border-radius: 0.75rem; color: rgba(255,255,255,0.6); transition: 0.2s; text-align: left; }
        nav button:hover { background: rgba(255,255,255,0.05); color: white; }
        nav button.active { background: var(--primary); color: black; font-weight: 700; }
        .admin-content { flex: 1; padding: 2rem; overflow-y: auto; }
        header { margin-bottom: 2rem; }
        h2 { font-size: 2rem; }
        .create-card { padding: 2rem; margin-bottom: 2rem; }
        h3 { margin-bottom: 1.5rem; opacity: 0.8; }
        .grid-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 1rem; }
        .grid-form input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 0.75rem 1rem; border-radius: 0.5rem; color: white; }
        .grid-form button { background: var(--primary); color: black; font-weight: 700; padding: 0 1.5rem; border-radius: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        .data-table { background: rgba(255,255,255,0.02); border-radius: 1rem; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 1rem; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.5); font-size: 0.8rem; text-transform: uppercase; }
        td { padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
        code { background: rgba(193, 164, 97, 0.2); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
        .delete-btn { color: #ff4d4d; opacity: 0.7; }
        .delete-btn:hover { opacity: 1; margin-bottom: 0 !important; }
        .save-btn { color: #4ade80; }
        .edit-btn { color: #60a5fa; }
        .view-btn { color: var(--primary); }
        .cancel-btn { color: #94a3b8; }
        
        .action-row { display: flex; gap: 1rem; align-items: center; }
        .table-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px 8px; color: white; width: 100%; }
        
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .filters select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 0.5rem; border-radius: 0.5rem; color: white; }
        
        .video-thumb-small { width: 100px; height: 60px; background: rgba(255,255,255,0.05); border-radius: 0.4rem; display: flex; align-items: center; justify-content: center; }
        .edit-stack { display: flex; flex-direction: column; gap: 0.5rem; }
        .edit-stack input, .edit-stack textarea { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 6px; color: white; font-size: 0.9rem; }
        .wedding-tag { background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; opacity: 0.7; }
        .upload-container { max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 2rem; }
        .upload-controls { margin-top: 2.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
        .upload-controls select, .upload-controls input { padding: 1rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 0.75rem; color: white; }
        .file-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
        .file-btn { border: 2px dashed rgba(255,255,255,0.1); padding: 2rem; border-radius: 1rem; cursor: pointer; transition: 0.3s; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; font-size: 0.9rem; }
        .file-btn:hover:not(.disabled) { border-color: var(--primary); background: rgba(193, 164, 97, 0.05); }
        .file-btn.secondary:hover:not(.disabled) { border-color: #fff; background: rgba(255,255,255,0.05); }
        .file-btn.disabled { opacity: 0.4; cursor: not-allowed; }
        
        .upload-submit-btn { width: 100%; padding: 1.25rem; background: var(--primary); color: black; font-weight: 800; border-radius: 1rem; font-size: 1.1rem; transition: 0.3s; }
        .upload-submit-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(193, 164, 97, 0.3); }
        .upload-submit-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        
        .upload-status { display: flex; flex-direction: column; gap: 0.5rem; }
        .progress-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
        .progress-bar.mini { height: 4px; background: rgba(0,0,0,0.2); }
        .progress-bar .fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }
        .video-thumb-small img { width: 100%; height: 100%; object-fit: cover; border-radius: 0.4rem; }

        .toggle { width: 50px; height: 26px; border-radius: 20px; background: rgba(255,255,255,0.1); border: 2px solid rgba(255,255,255,0.2); position: relative; transition: 0.3s; }
        .toggle.active { background: var(--primary); border-color: var(--primary); }
        .toggle .handle { width: 18px; height: 18px; border-radius: 50%; background: white; position: absolute; top: 2px; left: 2px; transition: 0.3s; }
        .toggle.active .handle { left: 24px; background: black; }

        .dot-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); animation: pulse 1s infinite alternate; }
        @keyframes pulse { from { opacity: 0.2; transform: scale(0.8); } to { opacity: 1; transform: scale(1.2); } }

        .upload-pipeline {
            margin-top: 1.5rem;
            padding: 1.5rem;
            text-align: left;
            border: 1px solid rgba(193, 164, 97, 0.2);
            background: rgba(0,0,0,0.4) !important;
        }

        .pipeline-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 1.5rem;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 0.75rem;
        }

        .pipeline-header h4 {
            margin: 0;
            font-size: 0.9rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            opacity: 0.8;
        }

        .pipeline-steps {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .pipeline-step {
            display: flex;
            gap: 1rem;
            opacity: 0.3;
            transition: 0.3s;
        }

        .pipeline-step.running, .pipeline-step.done {
            opacity: 1;
        }

        .step-indicator {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(255,255,255,0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7rem;
            font-weight: 800;
            flex-shrink: 0;
            position: relative;
        }

        .pipeline-step.done .step-indicator {
            background: #4ade80;
            color: black;
        }

        .pipeline-step.running .step-indicator {
            background: var(--primary);
            color: black;
        }

        .step-spinner {
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            border: 2px solid var(--primary);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        .step-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .step-info {
            display: flex;
            justify-content: space-between;
            font-size: 0.85rem;
        }

        .step-progress-wrapper {
            height: 4px;
            background: rgba(255,255,255,0.05);
            border-radius: 2px;
            overflow: hidden;
        }

        .step-progress-fill {
            height: 100%;
            background: var(--primary);
            transition: width 0.3s ease;
        }

        .pipeline-footer {
            margin-top: 1.5rem;
            padding-top: 1rem;
            border-top: 1px solid rgba(255,255,255,0.05);
        }

        .pipeline-footer p {
            margin: 0;
            font-size: 0.8rem;
            color: var(--primary);
        }

        .pipeline-footer small {
            font-size: 0.7rem;
            opacity: 0.5;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .progress-bar.indeterminate .fill {
          width: 30%;
          animation: slide 1.5s infinite linear;
          background: linear-gradient(90deg, transparent, var(--primary), transparent);
          border-radius: 10px;
        }

        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-dot.live {
          background: #4ade80;
          box-shadow: 0 0 8px #4ade80;
          animation: pulse-green 2s infinite;
        }
        .status-dot.offline {
          background: rgba(255,255,255,0.2);
        }
        @keyframes pulse-green {
          0% { opacity: 0.6; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0.6; transform: scale(0.9); }
        }

        .manage-section-cell {
            padding: 1rem;
            background: rgba(0,0,0,0.2);
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .manage-container {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 1.5rem;
            animation: slideDown 0.3s ease;
        }

        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .manage-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-top: 1rem;
        }

        .manage-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 0.75rem;
        }

        h5 { margin: 0 0 1rem 0; font-size: 0.9rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px; }

        .live-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .live-item {
            background: rgba(255,255,255,0.03);
            padding: 0.5rem 0.75rem;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.85rem;
        }
        .live-badge { background: #ef4444; color: white; font-size: 0.6rem; padding: 2px 4px; border-radius: 4px; font-weight: 800; }

        .add-live-form {
            display: grid;
            grid-template-columns: 1fr 1fr auto auto;
            gap: 0.5rem;
            margin-top: 0.5rem;
            align-items: center;
        }
        .add-live-form input {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            padding: 4px 8px;
            color: white;
            font-size: 0.75rem;
        }

        .photo-grid-admin {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
            gap: 0.5rem;
        }

        .photo-thumb {
            aspect-ratio: 1;
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            background: #000;
        }
        .photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .del-p {
            position: absolute; top: 2px; right: 2px;
            background: rgba(0,0,0,0.6); border: none; color: white;
            cursor: pointer; padding: 2px; border-radius: 2px;
        }

        .upload-photo-btn {
            aspect-ratio: 1;
            border-radius: 4px;
            border: 2px dashed rgba(255,255,255,0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: 0.3s;
            opacity: 0.5;
        }
        .upload-photo-btn:hover { border-color: var(--primary); opacity: 1; color: var(--primary); }

        .spin { animation: spin 1s linear infinite; }

        /* ═══ LIVE STREAMING PANEL ═══ */
        .live-event-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 0.75rem;
            transition: border-color 0.3s;
        }
        .live-event-card:hover {
            border-color: rgba(255,255,255,0.15);
        }

        .live-event-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }
        .live-event-header strong {
            display: block;
            font-size: 0.9rem;
        }

        .status-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .status-indicator.live {
            background: #ef4444;
            box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);
            animation: pulse-red 1.5s infinite;
        }
        .status-indicator.waiting {
            background: #f59e0b;
            box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
            animation: pulse-amber 2s infinite;
        }
        .status-indicator.idle { background: rgba(255,255,255,0.2); }
        .status-indicator.ended { background: rgba(255,255,255,0.1); }

        @keyframes pulse-red {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
        }
        @keyframes pulse-amber {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        .stream-status-tag {
            display: inline-block;
            font-size: 0.65rem;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 4px;
            margin-left: 6px;
        }
        .stream-status-tag.live { background: rgba(239,68,68,0.15); color: #ef4444; }
        .stream-status-tag.waiting { background: rgba(245,158,11,0.15); color: #f59e0b; }
        .stream-status-tag.ended { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); }
        .stream-status-tag.idle { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); }

        .stream-toggle-btn {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 5px 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            transition: 0.2s;
        }
        .stream-toggle-btn.start {
            background: rgba(74,222,128,0.15);
            color: #4ade80;
            border: 1px solid rgba(74,222,128,0.3);
        }
        .stream-toggle-btn.start:hover {
            background: rgba(74,222,128,0.25);
        }
        .stream-toggle-btn.stop {
            background: rgba(239,68,68,0.15);
            color: #ef4444;
            border: 1px solid rgba(239,68,68,0.3);
        }
        .stream-toggle-btn.stop:hover {
            background: rgba(239,68,68,0.25);
        }

        .obs-config-panel {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            padding: 0.75rem;
            margin-top: 0.5rem;
        }
        .obs-config-label {
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.4;
            margin-bottom: 0.6rem;
            font-weight: 700;
        }
        .obs-config-row {
            margin-bottom: 0.5rem;
        }
        .obs-config-row:last-child { margin-bottom: 0; }
        .obs-label {
            font-size: 0.7rem;
            opacity: 0.5;
            display: block;
            margin-bottom: 3px;
        }
        .obs-value-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .obs-value {
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 0.75rem;
            background: rgba(255,255,255,0.05);
            padding: 4px 8px;
            border-radius: 4px;
            color: #a78bfa;
            flex: 1;
            word-break: break-all;
        }
        .obs-value.stream-key {
            color: #f59e0b;
        }

        .copy-btn {
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.1);
            color: rgba(255,255,255,0.6);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.75rem;
            transition: 0.2s;
            flex-shrink: 0;
        }
        .copy-btn:hover { background: rgba(255,255,255,0.15); color: white; }
        .copy-btn.copied { background: rgba(74,222,128,0.2); color: #4ade80; border-color: rgba(74,222,128,0.3); }

        .regen-btn {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            color: rgba(255,255,255,0.4);
            padding: 4px 6px;
            border-radius: 4px;
            cursor: pointer;
            transition: 0.2s;
            flex-shrink: 0;
        }
        .regen-btn:hover { background: rgba(245,158,11,0.15); color: #f59e0b; border-color: rgba(245,158,11,0.3); }

        .add-live-form-v2 {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.75rem;
            align-items: center;
        }
        .add-live-form-v2 input {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 8px 12px;
            color: white;
            font-size: 0.8rem;
        }
        .add-live-form-v2 input:focus {
            outline: none;
            border-color: var(--primary);
        }

        .create-stream-btn {
            background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(245,158,11,0.2));
            border: 1px solid rgba(167,139,250,0.3);
            color: #a78bfa;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: 0.2s;
            white-space: nowrap;
        }
        .create-stream-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, rgba(167,139,250,0.3), rgba(245,158,11,0.3));
            transform: translateY(-1px);
        }
        .create-stream-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      `}</style>
        </div>
    );
}
