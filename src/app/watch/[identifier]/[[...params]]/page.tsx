"use client";

import { useEffect, useState, useRef } from "react";
import Hls from "hls.js";
import { useParams, useRouter } from "next/navigation";
import { Play, Calendar, MapPin, Share2, ArrowLeft, Heart, Settings, ShieldAlert, Radio, Users, MessageCircle } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import PrivacyGate from "@/components/PrivacyGate";

interface Video {
  id: string;
  title: string;
  description: string;
  r2_key: string;
  stream_url?: string;
  fast_stream_url?: string;
  low_stream_url?: string;
  thumbnail_key?: string;
  chapters?: string;
  created_at: string;
}

interface Photo {
  id: string;
  url: string;
  thumbnail_url?: string;
  description?: string;
}

interface LiveEvent {
  id: string;
  title: string;
  stream_url: string;
  is_live: boolean;
  status?: 'idle' | 'waiting' | 'live' | 'ended';
  started_at?: string;
}

interface Wedding {
  id: string;
  name: string;
  videos: Video[];
  live_events?: LiveEvent[];
  photos?: Photo[];
  is_live?: boolean;
  live_stream_url?: string;
}

export default function WatchPage() {
  const { identifier, params } = useParams();
  const videoId = Array.isArray(params) ? params[0] : null;
  const { user, loading: authLoading } = useAuth();

  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);
  const [wedding, setWedding] = useState<Wedding | null>(null);
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [activeLiveEvent, setActiveLiveEvent] = useState<LiveEvent | null>(null);
  const [activeTab, setActiveTab] = useState<'videos' | 'photos'>('videos');
  const [loading, setLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [quality, setQuality] = useState<'original' | 'optimized' | 'low' | 'auto'>('auto');
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedWeddingName, setLockedWeddingName] = useState("");
  const [diag, setDiag] = useState({
    videoId: '',
    cdnUrl: '',
    resolution: '',
    frameRate: 0,
    videoBitrate: 0,
    audioBitrate: 0,
    bandwidth: 0,
    bufferHealth: 0,
    droppedFrames: 0,
    currentLevel: -1,
    levels: [] as { res: string; bitrate: number }[],
    videoCodec: '',
    audioCodec: '',
    streamType: '',
    playbackRate: 1,
    currentTime: 0,
    duration: 0,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (authLoading) return;

    const fetchWedding = async () => {
      try {
        setLoading(true);
        const url = `/api/wedding/${identifier}${user ? `?userId=${user.uid}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();

        if (res.status === 403 && data.code === 'ACCESS_LOCKED') {
          setIsLocked(true);
          setLockedWeddingName(data.weddingName);
          return;
        }

        if (data.error) throw new Error(data.error);

        // Privacy Check: If the URL contains the access code instead of the ID, 
        // silently redirect to the ID-based URL to hide the code.
        if (identifier === data.access_code || (data.id && identifier !== data.id)) {
          router.replace(`/watch/${data.id}${videoId ? `/${videoId}` : ''}`);
        }

        setIsLocked(false);
        setWedding(data);

        // Auto-switch to live if there's an active event and no videoId in URL
        if (!videoId && data.live_events && data.live_events.length > 0) {
          const liveEvent = data.live_events.find((e: LiveEvent) => e.is_live);
          if (liveEvent) {
            setIsLiveMode(true);
            setActiveLiveEvent(liveEvent);
          }
        } else if (!videoId && data.is_live && data.live_stream_url) {
          setIsLiveMode(true);
        }

        // Handle specific videoId from URL or default to first video
        if (data.videos && data.videos.length > 0) {
          const selected = videoId
            ? data.videos.find((v: Video) => v.id === videoId)
            : data.videos[0];

          setActiveVideo(selected || data.videos[0]);

          // Network Optimization: Auto-pick quality based on connection
          if (typeof navigator !== 'undefined' && (navigator as any).connection) {
            const conn = (navigator as any).connection;
            // If on slow connection, pick low or optimized
            if (conn.effectiveType === '2g' || conn.saveData) {
              setQuality('low');
            } else if (conn.effectiveType === '3g') {
              setQuality('optimized');
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchWedding();
  }, [identifier, videoId, user, authLoading]);

  // ── Live Stream Polling (detect when stream goes live/offline) ──────
  useEffect(() => {
    if (!wedding?.live_events || wedding.live_events.length === 0) return;

    const pollLiveStatus = async () => {
      try {
        for (const event of wedding.live_events || []) {
          const res = await fetch(`/api/live/status/${event.id}`);
          if (!res.ok) continue;
          const data = await res.json();

          // Stream just went live — auto-switch to it
          if (data.isLive && data.streamUrl && !event.is_live) {
            setWedding(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                live_events: prev.live_events?.map(e =>
                  e.id === event.id
                    ? { ...e, is_live: true, stream_url: data.streamUrl, status: 'live' }
                    : e
                )
              };
            });

            // Auto-switch to live mode if user isn't watching a specific video
            if (!videoId) {
              setIsLiveMode(true);
              setActiveLiveEvent({ ...event, is_live: true, stream_url: data.streamUrl, status: 'live' });
            }
          }

          // Stream ended — update state
          if (!data.isLive && event.is_live) {
            setWedding(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                live_events: prev.live_events?.map(e =>
                  e.id === event.id
                    ? { ...e, is_live: false, status: 'ended' }
                    : e
                )
              };
            });

            // If we were watching this live event, switch back to first video
            if (isLiveMode && activeLiveEvent?.id === event.id) {
              setIsLiveMode(false);
              if (wedding.videos && wedding.videos.length > 0) {
                setActiveVideo(wedding.videos[0]);
              }
            }
          }
        }
      } catch (err) {
        // Silently fail — polling is best-effort
      }
    };

    // Poll every 10 seconds
    const interval = setInterval(pollLiveStatus, 10000);
    return () => clearInterval(interval);
  }, [wedding?.live_events, isLiveMode, activeLiveEvent, videoId]);

  // Handle video element events for buffering and smooth switching
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
    const handleTimeUpdate = () => {
      lastTimeRef.current = video.currentTime;
    };

    // Auto-downgrade quality if video is stuck multiple times
    let stallCount = 0;
    const handleStalled = () => {
      stallCount++;
      if (stallCount >= 2 && quality === 'auto') {
        if (activeVideo?.low_stream_url) {
          console.log("Network too slow. Switching to 720p...");
          setQuality('low');
        } else if (activeVideo?.fast_stream_url) {
          console.log("Network slow. Switching to 1080p...");
          setQuality('optimized');
        }
        stallCount = 0;
      }
    };

    // Auto-upgrade check: Periodically check if we can go back to original
    const upgradeInterval = setInterval(() => {
      if (quality !== 'auto') return;
      if (typeof navigator !== 'undefined' && (navigator as any).connection) {
        const conn = (navigator as any).connection;
        // If speed is 4g and we are currently on a lower version, try switching back to 4K
        if (conn.effectiveType === '4g' && !conn.saveData) {
          // Logic to return to 'original' handled by getActiveStreamUrl
        }
      }
    }, 10000);

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('stalled', handleStalled);

    // Close quality menu when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setIsQualityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    // Netflix-style diagnostic: Ctrl+Shift+Alt+D
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && e.key.toLowerCase() === 'd') {
        setShowDiag(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Live diagnostics update — every second
    const statsInterval = setInterval(() => {
      const hls = hlsRef.current;
      const vid = videoRef.current;
      if (!activeVideo || !vid) return;

      const streamUrl = activeVideo.fast_stream_url && activeVideo.fast_stream_url.includes('.m3u8')
        ? activeVideo.fast_stream_url
        : activeVideo.stream_url || '';

      // Strip query string for readability
      const cleanUrl = streamUrl.split('?')[0];

      const bufferHealth = vid.buffered.length > 0
        ? Number((vid.buffered.end(vid.buffered.length - 1) - vid.currentTime).toFixed(1))
        : 0;

      // Dropped frames via API
      const quality2 = (vid as any).getVideoPlaybackQuality?.();

      if (hls) {
        const lvl = hls.levels[hls.currentLevel];
        setDiag({
          videoId: activeVideo.id,
          cdnUrl: cleanUrl,
          resolution: lvl ? `${lvl.width}×${lvl.height}` : 'Auto',
          frameRate: lvl?.frameRate ?? 0,
          videoBitrate: lvl ? Math.round(lvl.bitrate / 1000) : 0,
          audioBitrate: lvl?.audioCodec ? 128 : 0,
          bandwidth: Math.round(hls.bandwidthEstimate / 1000),
          bufferHealth,
          droppedFrames: quality2?.droppedVideoFrames ?? 0,
          currentLevel: hls.currentLevel,
          levels: hls.levels.map(l => ({ res: `${l.width}×${l.height}`, bitrate: Math.round(l.bitrate / 1000) })),
          videoCodec: lvl?.videoCodec ?? 'hevc / hvc1',
          audioCodec: lvl?.audioCodec ?? 'aac',
          streamType: 'HLS fMP4 (ABR)',
          playbackRate: vid.playbackRate,
          currentTime: Number(vid.currentTime.toFixed(1)),
          duration: Number(vid.duration.toFixed(1)),
        });
      } else {
        setDiag(prev => ({
          ...prev,
          videoId: activeVideo.id,
          cdnUrl: cleanUrl,
          streamType: 'MP4 Progressive',
          bufferHealth,
          droppedFrames: quality2?.droppedVideoFrames ?? 0,
          playbackRate: vid.playbackRate,
          currentTime: Number(vid.currentTime.toFixed(1)),
          duration: Number(vid.duration.toFixed(1)),
        }));
      }
    }, 1000);

    return () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('stalled', handleStalled);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(upgradeInterval);
      clearInterval(statsInterval);
    }
  }, [activeVideo, quality, showDiag]);

  const handleVideoSelect = (vid: Video) => {
    setIsLiveMode(false);
    setActiveVideo(vid);
    // Update URL without full reload to support sharing/deeplinking
    window.history.pushState(null, "", `/watch/${wedding?.id || identifier}/${vid.id}`);
  };

  const handleLiveSelect = (event?: LiveEvent) => {
    setIsLiveMode(true);
    setActiveVideo(null);
    if (event) {
      setActiveLiveEvent(event);
    }
    window.history.pushState(null, "", `/watch/${wedding?.id || identifier}`);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!activeVideo && !isLiveMode)) return;

    const streamUrl = getActiveStreamUrl();
    const isHls = streamUrl.includes(".m3u8");

    // Before changing source, remember the current time for smooth transition
    const currentTime = lastTimeRef.current;

    if (isHls) {
      if (Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
        }
        const hls = new Hls(isLiveMode ? {
          // LOW-LATENCY LIVE: Aggressive settings for minimal delay
          capLevelToPlayerSize: true,
          backBufferLength: 10,
          maxBufferLength: 8,
          maxMaxBufferLength: 15,
          maxBufferHole: 0.3,
          enableWorker: true,
          lowLatencyMode: true,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
          liveDurationInfinity: true,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 300,
          levelLoadingMaxRetry: 5,
        } : {
          // VOD: Pre-fetching and progressive buffering
          capLevelToPlayerSize: true,
          backBufferLength: 60,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferHole: 0.5,
          enableWorker: true,
          lowLatencyMode: false,
          fragLoadingMaxRetry: 5,
          fragLoadingRetryDelay: 500,
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (currentTime > 0) video.currentTime = currentTime;
          video.play().catch(() => { /* Autoplay block */ });

          // Apply manual quality selection if already set (for HLS ABR levels)
          if (quality === 'low' && hls.levels.length > 1) {
            const levelIdx = hls.levels.findIndex(l => l.height <= 720);
            hls.currentLevel = levelIdx !== -1 ? levelIdx : 0;
          } else if (quality === 'optimized' && hls.levels.length > 1) {
            const levelIdx = hls.levels.findIndex(l => l.height <= 1080);
            hls.currentLevel = levelIdx !== -1 ? levelIdx : Math.floor(hls.levels.length / 2);
          } else if (quality === 'original') {
            hls.currentLevel = hls.levels.length - 1; // Highest quality
          } else {
            hls.currentLevel = -1; // Auto
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = streamUrl;
        video.currentTime = currentTime;
      }
    } else {
      // Normal MP4 fallback
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = streamUrl;
      if (currentTime > 0) {
        // We must wait for metadata to be loaded if it's a new source
        const resumePos = () => {
          video.currentTime = currentTime;
          video.play().catch(() => { });
          video.removeEventListener('loadedmetadata', resumePos);
        };
        video.addEventListener('loadedmetadata', resumePos);
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeVideo, isLiveMode, quality]);

  const getActiveStreamUrl = () => {
    if (isLiveMode) {
      if (activeLiveEvent) return activeLiveEvent.stream_url;
      if (wedding?.live_stream_url) return wedding.live_stream_url;
    }
    if (!activeVideo) return "";

    // ── HLS PRIORITY (ABR handles all quality switching internally) ──────────
    // fast_stream_url holds the master.m3u8 for ABR-encoded videos.
    // Always use it when available — hls.js will auto-select the right bitrate.
    if (activeVideo.fast_stream_url && activeVideo.fast_stream_url.includes('.m3u8')) {
      // honour manual quality selection within the HLS stream (handled in hls.on MANIFEST_PARSED)
      return activeVideo.fast_stream_url;
    }

    // ── Legacy r2_key-based HLS (older uploads where r2_key IS the m3u8) ────
    if (activeVideo.r2_key.endsWith(".m3u8")) {
      return `/api/r2/${activeVideo.r2_key}`;
    }

    // ── Fallback: plain MP4 quality tiers ───────────────────────────────────
    if (quality === 'low' && activeVideo.low_stream_url) {
      return activeVideo.low_stream_url;
    }
    if (quality === 'optimized' && activeVideo.fast_stream_url) {
      return activeVideo.fast_stream_url;
    }
    if (quality === 'original') {
      return activeVideo.stream_url || `/api/r2/${activeVideo.r2_key}`;
    }

    // AUTO MODE for plain MP4s: pick by connection speed
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      const conn = (navigator as any).connection;
      if (conn.saveData || conn.effectiveType === '2g') return activeVideo.low_stream_url || activeVideo.fast_stream_url || activeVideo.stream_url || "";
      if (conn.effectiveType === '3g') return activeVideo.fast_stream_url || activeVideo.stream_url || "";
    }

    return activeVideo.stream_url || `/api/r2/${activeVideo.r2_key}`;
  };

  const handleShare = async () => {
    if (!activeVideo || !wedding) return;
    const url = `${window.location.origin}/watch/${wedding.id}/${activeVideo.id}`;
    const shareData = {
      title: `${wedding.name} - ${activeVideo.title}`,
      text: `Watch our cinematic wedding film: ${activeVideo.title}`,
      url: url
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        alert("🔗 Link copied to clipboard!");
      }
    } catch (err) {
      console.error("Error sharing:", err);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loader"></div>
        <p>Opening the Vault of Memories...</p>
        <style jsx>{`
          .loading-state {
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--background);
            color: white;
          }
          .loader {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(193, 164, 97, 0.2);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 1rem;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (isLocked) {
    return (
      <PrivacyGate
        weddingName={lockedWeddingName}
        onUnlocked={() => {
          // Re-fetch wedding data now that it's unlocked
          window.location.reload();
        }}
      />
    );
  }

  if (!wedding) {
    return <div>Wedding not found</div>;
  }

  return (
    <div className="watch-container">
      <nav className="watch-nav">
        <button className="back-btn" onClick={() => router.push('/')}>
          <ArrowLeft size={24} />
        </button>
        <div className="logo-small">
          <Heart size={20} fill="var(--primary)" color="var(--primary)" />
          <span>Wedding OTT</span>
        </div>
      </nav>

      <main className="viewer-layout">
        <div className="player-section">
          <div className="player-wrapper">
            {/* Direct R2 public access or Cloudflare Worker Proxy */}
            <video
              ref={videoRef}
              key={activeVideo?.id}
              controls
              preload="auto"
              className="main-video"
              poster={activeVideo?.thumbnail_key ? `/api/r2/${activeVideo.thumbnail_key}` : "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=1200"}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
            >
              Your browser does not support high quality video playback.
            </video>

            {showDiag && (
              <div className="netflix-diag">
                <div className="diag-header">
                  <span className="diag-title">⚙ Stream Diagnostics</span>
                  <span className="diag-shortcut">Ctrl+Shift+Alt+D to toggle</span>
                  <button className="diag-close" onClick={() => setShowDiag(false)}>✕</button>
                </div>

                <div className="diag-section">
                  <div className="diag-label">IDENTITY</div>
                  <div className="diag-row"><span>Video ID</span><code>{diag.videoId || '—'}</code></div>
                  <div className="diag-row"><span>Stream Type</span><code>{diag.streamType || '—'}</code></div>
                </div>



                <div className="diag-section">
                  <div className="diag-label">PLAYBACK</div>
                  <div className="diag-row"><span>Resolution</span><code>{diag.resolution || '—'}</code></div>
                  <div className="diag-row"><span>Frame Rate</span><code>{diag.frameRate ? `${diag.frameRate} fps` : '—'}</code></div>
                  <div className="diag-row"><span>Video Bitrate</span><code>{diag.videoBitrate ? `${diag.videoBitrate} kbps` : '—'}</code></div>
                  <div className="diag-row"><span>Audio Bitrate</span><code>{diag.audioBitrate ? `${diag.audioBitrate} kbps` : '—'}</code></div>
                  <div className="diag-row"><span>Est. Bandwidth</span><code className={diag.bandwidth < 1000 ? 'warn' : 'ok'}>{diag.bandwidth ? `${diag.bandwidth} kbps` : '—'}</code></div>
                  <div className="diag-row"><span>Buffer Health</span><code className={diag.bufferHealth < 3 ? 'warn' : 'ok'}>{diag.bufferHealth}s</code></div>
                  <div className="diag-row"><span>Dropped Frames</span><code className={diag.droppedFrames > 0 ? 'warn' : 'ok'}>{diag.droppedFrames}</code></div>
                  <div className="diag-row"><span>Playback Rate</span><code>{diag.playbackRate}×</code></div>
                  <div className="diag-row"><span>Position</span><code>{diag.currentTime}s / {diag.duration}s</code></div>
                </div>

                <div className="diag-section">
                  <div className="diag-label">CODEC</div>
                  <div className="diag-row"><span>Video</span><code>{diag.videoCodec || '—'}</code></div>
                  <div className="diag-row"><span>Audio</span><code>{diag.audioCodec || '—'}</code></div>
                </div>

                {diag.levels.length > 0 && (
                  <div className="diag-section">
                    <div className="diag-label">AVAILABLE QUALITY LEVELS</div>
                    {diag.levels.map((l, i) => (
                      <div key={i} className={`diag-row ${i === diag.currentLevel ? 'active-level' : ''}`}>
                        <span>Level {i} {i === diag.currentLevel ? '▶ active' : ''}</span>
                        <code>{l.res} @ {l.bitrate} kbps</code>
                      </div>
                    ))}
                    <div className="diag-row">
                      <span>ABR Mode</span>
                      <code>{diag.currentLevel === -1 ? 'Auto (hls.js ABR)' : `Fixed Level ${diag.currentLevel}`}</code>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Buffering Loader Overlay */}
            {isBuffering && (
              <div className="video-loader-overlay">
                <div className="minimal-loader"></div>
                <p>Ensuring Cinematic Quality...</p>
              </div>
            )}
          </div>
          <div className="video-info">
            <div className="info-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {isLiveMode && (
                  <div className="live-status-badge">
                    <span className="live-dot"></span>
                    LIVE NOW
                  </div>
                )}
                <h1>{isLiveMode ? (activeLiveEvent ? activeLiveEvent.title : `LIVE: ${wedding?.name}`) : activeVideo?.title}</h1>
              </div>
              <div className="actions">
                <div className="quality-dropdown-container" ref={qualityMenuRef}>
                  <button
                    className={`quality-trigger ${quality !== 'auto' ? 'active' : ''}`}
                    onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
                  >
                    {quality === 'auto' ? '✓ Auto' : quality === 'original' ? '4K' : quality === 'optimized' ? '1080p' : '720p'}
                    <Settings size={14} className={isQualityMenuOpen ? 'spin' : ''} />
                  </button>

                  {isQualityMenuOpen && (
                    <div className="quality-menu">
                      <div className="menu-header">Playback Quality</div>
                      <button
                        className={`menu-item ${quality === 'auto' ? 'selected' : ''}`}
                        onClick={() => { setQuality('auto'); setIsQualityMenuOpen(false); }}
                      >
                        <span className="check">{quality === 'auto' ? '✓' : ''}</span>
                        <div className="item-label">
                          <span>Auto</span>
                          <small>Best for your connection</small>
                        </div>
                      </button>
                      <button
                        className={`menu-item ${quality === 'original' ? 'selected' : ''}`}
                        onClick={() => { setQuality('original'); setIsQualityMenuOpen(false); }}
                      >
                        <span className="check">{quality === 'original' ? '✓' : ''}</span>
                        <div className="item-label">
                          <span>4K Cinema</span>
                          <small>Original master quality</small>
                        </div>
                      </button>
                      {activeVideo?.fast_stream_url && (
                        <button
                          className={`menu-item ${quality === 'optimized' ? 'selected' : ''}`}
                          onClick={() => { setQuality('optimized'); setIsQualityMenuOpen(false); }}
                        >
                          <span className="check">{quality === 'optimized' ? '✓' : ''}</span>
                          <div className="item-label">
                            <span>1080p HD</span>
                            <small>Standard HD Quality</small>
                          </div>
                        </button>
                      )}
                      {activeVideo?.low_stream_url && (
                        <button
                          className={`menu-item ${quality === 'low' ? 'selected' : ''}`}
                          onClick={() => { setQuality('low'); setIsQualityMenuOpen(false); }}
                        >
                          <span className="check">{quality === 'low' ? '✓' : ''}</span>
                          <div className="item-label">
                            <span>720p SD</span>
                            <small>Perfect for data saving</small>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button className="icon-btn" title="Share" onClick={handleShare}><Share2 size={20} /></button>
                <button
                  className={`icon-btn ${showDiag ? 'icon-btn--active' : ''}`}
                  title="Stream Diagnostics (Ctrl+Shift+Alt+D)"
                  onClick={() => setShowDiag(prev => !prev)}
                >
                  <Settings size={20} />
                </button>
              </div>
            </div>
            <div className="metadata">
              <span><Calendar size={14} /> Dec 2024</span>
              <span><MapPin size={14} /> Hyderabad, India</span>
            </div>
            <p className="description">{activeVideo?.description}</p>

            <div className="tab-navigation">
              <button
                className={`tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
                onClick={() => setActiveTab('videos')}
              >
                Videos
              </button>
              <button
                className={`tab-btn ${activeTab === 'photos' ? 'active' : ''}`}
                onClick={() => setActiveTab('photos')}
              >
                Photo Gallery
              </button>
            </div>

            {activeTab === 'photos' && wedding?.photos && (
              <div className="photos-grid">
                {wedding.photos.map((photo) => (
                  <div key={photo.id} className="photo-card" onClick={() => window.open(photo.url, '_blank')}>
                    <img src={photo.thumbnail_url || photo.url} alt={photo.description || 'Wedding Photo'} />
                    {photo.description && <p>{photo.description}</p>}
                  </div>
                ))}
                {wedding.photos.length === 0 && <p className="empty-msg">No photos shared yet.</p>}
              </div>
            )}

            {activeTab === 'videos' && activeVideo?.chapters && (
              <div className="chapters-container">
                <h3>Moments in this Film</h3>
                <div className="chapters-grid">
                  {JSON.parse(activeVideo.chapters).map((ch: any, i: number) => (
                    <button
                      key={i}
                      className="chapter-item"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = ch.t;
                      }}
                    >
                      <span className="chapter-time">{new Date(ch.t * 1000).toISOString().substr(14, 5)}</span>
                      <span className="chapter-label">{ch.l}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="sidebar">
          {wedding.live_events && wedding.live_events.some(e => e.is_live) && (
            <div className="live-sidebar-section">
              <h3>Live Events</h3>
              {wedding.live_events.filter(e => e.is_live).map(event => (
                <div
                  key={event.id}
                  className={`live-stream-card ${isLiveMode && activeLiveEvent?.id === event.id ? 'active' : ''}`}
                  onClick={() => handleLiveSelect(event)}
                >
                  <div className="live-preview-box">
                    <Radio size={24} className="radio-icon" />
                    <div className="live-overlay">
                      <Users size={12} />
                      <span>Live</span>
                    </div>
                  </div>
                  <div className="live-info">
                    <h4>{event.title}</h4>
                    <p>Tap to join</p>
                  </div>
                </div>
              ))}
              <div className="live-divider"></div>
            </div>
          )}
          {!wedding.live_events?.some(e => e.is_live) && wedding.is_live && (
            <div className="live-sidebar-section">
              <h3>Broadcasting</h3>
              <div
                className={`live-stream-card ${isLiveMode ? 'active' : ''}`}
                onClick={() => handleLiveSelect()}
              >
                <div className="live-preview-box">
                  <Radio size={24} className="radio-icon" />
                  <div className="live-overlay">
                    <Users size={12} />
                    <span>Live</span>
                  </div>
                </div>
                <div className="live-info">
                  <h4>Main Event</h4>
                  <p>Join the celebration</p>
                </div>
              </div>
              <div className="live-divider"></div>
            </div>
          )}
          <h3>Collection</h3>
          <div className="video-list">
            {wedding.videos.map((vid) => (
              <div
                key={vid.id}
                className={`video-item ${activeVideo?.id === vid.id ? 'active' : ''}`}
                onClick={() => handleVideoSelect(vid)}
              >
                <div className="item-thumb">
                  {activeVideo?.id === vid.id && <div className="now-playing">Playing</div>}
                  <Play className="play-icon" size={24} fill="white" />
                </div>
                <div className="item-info">
                  <h4>{vid.title}</h4>
                  <p>4K Cinema</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <style jsx>{`
        .live-status-badge {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 800;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .live-dot {
          width: 6px;
          height: 6px;
          background: #ef4444;
          border-radius: 50%;
          box-shadow: 0 0 8px #ef4444;
          animation: pulse-red 1.5s infinite;
        }

        @keyframes pulse-red {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }

        .live-sidebar-section {
          margin-bottom: 2rem;
        }

        .live-stream-card {
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.1);
          border-radius: 12px;
          padding: 10px;
          display: flex;
          gap: 12px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .live-stream-card:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          transform: translateY(-2px);
        }

        .live-stream-card.active {
          background: rgba(239, 68, 68, 0.15);
          border-color: #ef4444;
          box-shadow: 0 10px 20px rgba(239, 68, 68, 0.1);
        }

        .live-preview-box {
          width: 80px;
          height: 60px;
          background: #000;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ef4444;
          position: relative;
        }

        .radio-icon {
          animation: pulse-red 2s infinite;
        }

        .live-overlay {
          position: absolute;
          bottom: 4px;
          left: 4px;
          right: 4px;
          background: rgba(0,0,0,0.6);
          border-radius: 4px;
          padding: 2px 4px;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.5rem;
          color: white;
        }

        .live-info h4 {
          font-size: 0.9rem;
          margin: 0 0 2px 0;
          color: #ef4444;
        }

        .live-info p {
          font-size: 0.7rem;
          opacity: 0.5;
          margin: 0;
        }

        .live-divider {
          height: 1px;
          background: linear-gradient(to right, rgba(239, 68, 68, 0.2), transparent);
          margin-top: 1.5rem;
        }

        .tab-navigation {
          display: flex;
          gap: 1.5rem;
          margin: 1.5rem 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 0.5rem;
        }

        .tab-btn {
          background: none;
          border: none;
          color: rgba(255,255,255,0.5);
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
          transition: 0.3s;
          padding: 0.5rem 0;
          position: relative;
        }

        .tab-btn:hover {
          color: white;
        }

        .tab-btn.active {
          color: var(--primary);
        }

        .tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: -0.5rem;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary);
          box-shadow: 0 0 10px var(--primary);
        }

        .photos-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1.5rem;
          margin-top: 1.5rem;
          animation: fadeIn 0.5s ease;
        }

        .photo-card {
          border-radius: 12px;
          overflow: hidden;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.05);
          cursor: pointer;
          transition: 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .photo-card:hover {
          transform: translateY(-5px);
          border-color: var(--primary);
        }

        .photo-card img {
          width: 100%;
          aspect-ratio: 4/5;
          object-fit: cover;
        }

        .photo-card p {
          padding: 0.75rem;
          font-size: 0.8rem;
          opacity: 0.7;
          margin: 0;
        }

        .empty-msg {
          grid-column: 1 / -1;
          text-align: center;
          padding: 3rem;
          opacity: 0.3;
          font-style: italic;
        }

        .watch-container {
          min-height: 100vh;
          background: var(--background);
          color: white;
        }

        .watch-nav {
          height: 70px;
          padding: 0 2rem;
          display: flex;
          align-items: center;
          gap: 2rem;
          background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
        }

        .back-btn {
          color: white;
          opacity: 0.7;
          transition: 0.3s;
        }

        .back-btn:hover {
          opacity: 1;
        }

        .logo-small {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .viewer-layout {
          display: grid;
          grid-template-columns: 1fr 350px;
          gap: 2rem;
          padding: 100px 2rem 2rem;
          max-width: 1800px;
          margin: 0 auto;
        }

        .player-wrapper {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
          background: #000;
          border-radius: 1rem;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          border: 1px solid var(--card-border);
        }

        /* ── Netflix-style Diagnostic Overlay ─────────────────────── */
        .netflix-diag {
          position: absolute;
          top: 12px;
          left: 12px;
          width: 360px;
          max-height: calc(100% - 24px);
          overflow-y: auto;
          background: rgba(0, 0, 0, 0.88);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(229, 9, 20, 0.4);
          border-radius: 8px;
          font-family: 'Courier New', monospace;
          font-size: 11px;
          color: #e5e5e5;
          z-index: 200;
          pointer-events: auto;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7);
          scrollbar-width: thin;
          scrollbar-color: rgba(229,9,20,0.4) transparent;
        }

        .diag-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 8px 10px;
          border-bottom: 1px solid rgba(229, 9, 20, 0.3);
          background: rgba(229, 9, 20, 0.08);
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .diag-title {
          font-weight: 700;
          font-size: 12px;
          color: #e50914;
          letter-spacing: 0.5px;
          flex: 1;
        }

        .diag-shortcut {
          font-size: 9px;
          color: rgba(255,255,255,0.3);
          flex: 1;
          text-align: right;
        }

        .diag-close {
          background: none;
          border: none;
          color: rgba(255,255,255,0.4);
          cursor: pointer;
          font-size: 13px;
          padding: 0 2px;
          line-height: 1;
        }

        .diag-close:hover { color: white; }

        .diag-section {
          padding: 6px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .diag-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1.5px;
          color: rgba(229, 9, 20, 0.7);
          margin-bottom: 4px;
          padding-top: 2px;
        }

        .diag-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          padding: 2px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }

        .diag-row span {
          color: rgba(255,255,255,0.45);
          white-space: nowrap;
          flex-shrink: 0;
          width: 110px;
        }

        .diag-row code {
          color: #46d369;
          font-family: 'Courier New', monospace;
          font-size: 10.5px;
          word-break: break-all;
          text-align: right;
          background: none;
        }

        .diag-row.diag-url code {
          font-size: 9.5px;
          color: #a8c8ff;
          word-break: break-all;
        }

        .diag-row code.warn { color: #f5a623; }
        .diag-row code.ok   { color: #46d369; }

        .diag-row.active-level {
          background: rgba(229, 9, 20, 0.08);
          border-radius: 3px;
          padding-left: 4px;
        }

        .diag-row.active-level span { color: #e50914; font-weight: 700; }
        .diag-row.active-level code { color: #fff; font-weight: 700; }

        .stats-overlay {
          position: absolute;
          top: 20px;
          left: 20px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          padding: 1rem;
          border-radius: 0.75rem;
          border: 1px solid rgba(255,255,255,0.1);
          color: white;
          z-index: 100;
          font-family: 'monospace';
          font-size: 0.75rem;
          min-width: 220px;
          pointer-events: auto;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .stats-header {
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 0.5rem;
          margin-bottom: 0.5rem;
          font-weight: 800;
          color: var(--primary);
          text-transform: uppercase;
        }

        .stats-grid {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .stat-item {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
        }

        .stat-item span { opacity: 0.5; }

        .stats-close {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          background: none;
          border: none;
          color: white;
          opacity: 0.5;
          cursor: pointer;
        }

        .stats-close:hover { opacity: 1; }

        .main-video {
          width: 100%;
          height: 100%;
          display: block;
        }

        .video-loader-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.4);
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 10;
          color: white;
          pointer-events: none;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .minimal-loader {
          width: 32px;
          height: 32px;
          border: 2px solid rgba(193, 164, 97, 0.2);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-bottom: 0.75rem;
        }

        .main-video {
          width: 100%;
          height: 100%;
          display: block;
        }

        .video-info {
          margin-top: 1.5rem;
        }

        .info-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .info-header h1 {
          font-size: 2.5rem;
          color: var(--primary);
        }

        .actions {
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }

        .quality-dropdown-container {
          position: relative;
        }

        .quality-trigger {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 2rem;
          color: white;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: 0.3s;
        }

        .quality-trigger:hover {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.2);
        }

        .quality-trigger.active {
          border-color: var(--primary);
          color: var(--primary);
          background: rgba(193, 164, 97, 0.1);
        }

        .quality-trigger .spin {
          animation: rotate 2s linear infinite;
        }

        @keyframes rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .quality-menu {
          position: absolute;
          bottom: calc(100% + 10px);
          right: 0;
          width: 240px;
          background: rgba(15, 15, 20, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 1rem;
          padding: 0.5rem;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          z-index: 1000;
          animation: slideUp 0.2s ease-out;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .menu-header {
          padding: 0.75rem;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.5px;
        }

        .menu-item {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: 0.2s;
          text-align: left;
          background: transparent;
          border: none;
          color: white;
        }

        .menu-item:hover:not(.disabled) {
          background: rgba(255,255,255,0.05);
        }

        .menu-item.selected {
          background: rgba(193, 164, 97, 0.1);
        }

        .menu-item.disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .check {
          width: 24px;
          font-size: 1rem;
          color: var(--primary);
          font-weight: 700;
        }

        .item-label {
          display: flex;
          flex-direction: column;
        }

        .item-label span {
          font-size: 0.95rem;
          font-weight: 600;
        }

        .item-label small {
          font-size: 0.7rem;
          color: rgba(255,255,255,0.5);
        }

        .icon-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: 0.3s;
          color: white;
        }

        .icon-btn:hover {
          background: rgba(255,255,255,0.1);
        }

        .icon-btn--active {
          background: rgba(193, 164, 97, 0.15);
          color: var(--primary);
          border: 1px solid rgba(193, 164, 97, 0.4);
        }

        .icon-btn--active:hover {
          background: rgba(193, 164, 97, 0.25);
        }

        .metadata {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          color: rgba(255,255,255,0.5);
          font-size: 0.9rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
        }

        .quality-selector {
          display: flex;
          gap: 0.5rem;
          background: rgba(255,255,255,0.05);
          padding: 4px;
          border-radius: 8px;
        }

        .quality-btn {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          transition: 0.3s;
          cursor: pointer;
        }

        .quality-btn:hover {
          color: white;
          background: rgba(255,255,255,0.05);
        }

        .quality-btn.active {
          background: var(--primary);
          color: black;
          box-shadow: 0 4px 12px rgba(193, 164, 97, 0.3);
        }

        .metadata-separator {
          opacity: 0.2;
        }

        .badge {
          background: rgba(193, 164, 97, 0.2);
          color: var(--primary);
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.75rem;
        }

        .metadata span {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .description {
          font-size: 1.1rem;
          color: rgba(255,255,255,0.8);
          max-width: 800px;
        }

        .sidebar h3 {
          font-size: 1.25rem;
          margin-bottom: 1.5rem;
          color: rgba(255,255,255,0.6);
        }

        .video-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .video-item {
          display: flex;
          gap: 1rem;
          padding: 0.75rem;
          border-radius: 1rem;
          cursor: pointer;
          transition: 0.3s;
          background: rgba(255,255,255,0.02);
          border: 1px solid transparent;
        }

        .video-item:hover {
          background: rgba(255,255,255,0.05);
        }

        .video-item.active {
          background: rgba(193, 164, 97, 0.1);
          border-color: rgba(193, 164, 97, 0.2);
        }

        .item-thumb {
          width: 140px;
          height: 80px;
          background: #1a1a1e;
          border-radius: 0.5rem;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .play-icon {
          opacity: 0;
          transition: 0.3s;
        }

        .video-item:hover .play-icon {
          opacity: 1;
        }

        .now-playing {
          position: absolute;
          bottom: 4px;
          right: 4px;
          font-size: 0.6rem;
          background: var(--primary);
          color: black;
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: 700;
        }

        .item-info h4 {
          font-size: 1rem;
          margin-bottom: 0.25rem;
        }

        .item-info p {
          font-size: 0.8rem;
          color: rgba(255,255,255,0.4);
        }

        @media (max-width: 1100px) {
          .viewer-layout {
            grid-template-columns: 1fr;
          }
          .sidebar {
            margin-top: 2rem;
          }
        }

        .chapters-container {
          margin-top: 2.5rem;
          padding-top: 2.5rem;
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .chapters-container h3 {
          font-size: 1.25rem;
          margin-bottom: 1.5rem;
          color: rgba(255,255,255,0.6);
        }

        .chapters-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
        }

        .chapter-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: rgba(255,255,255,0.03);
          border-radius: 0.75rem;
          border: 1px solid rgba(255,255,255,0.05);
          transition: 0.3s;
          color: white;
          text-align: left;
        }

        .chapter-item:hover {
          background: rgba(193, 164, 97, 0.1);
          border-color: rgba(193, 164, 97, 0.2);
          transform: translateY(-2px);
        }

        .chapter-time {
          font-family: monospace;
          font-size: 0.8rem;
          background: var(--primary);
          color: black;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 700;
        }

        .chapter-label {
          font-size: 0.9rem;
          font-weight: 500;
          opacity: 0.9;
        }
      `}</style>
    </div>
  );
}
