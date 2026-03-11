"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
    Shield, Lock, Users, CreditCard, Film, Camera, Radio, BarChart3,
    Trash2, Edit, Crown, AlertTriangle, ChevronRight, Eye, EyeOff,
    Search, ArrowLeft, LogOut, RefreshCw, Check, X, Loader2,
    DollarSign, HardDrive, Video, Image as ImageIcon, Wifi, UserCheck,
    Ban, UserPlus, Calendar, Clock, Download, Settings, List, Activity
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Helpers ──────────────────────────────────────────────────────
function formatSize(bytes: number | null | undefined): string {
    if (!bytes) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, s = bytes;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return `${s.toFixed(i > 1 ? 2 : 0)} ${u[i]}`;
}
function formatCurrency(paisa: number): string {
    return `₹${(paisa / 100).toLocaleString("en-IN")}`;
}
function formatDate(d: string | null): string {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

type Tab = "dashboard" | "users" | "subscriptions" | "weddings" | "content" | "payments" | "settings" | "queue" | "analytics";

export default function MasterAdminPage() {
    const router = useRouter();

    // ─── Auth State ───────────────────────────────────────────────
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [authLoading, setAuthLoading] = useState(false);
    const [failedAttempts, setFailedAttempts] = useState(0);
    const [lockoutUntil, setLockoutUntil] = useState(0);
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MS = 60000;

    // ─── Tab + Data ───────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<Tab>("dashboard");
    const [token, setToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [lastActivity, setLastActivity] = useState(Date.now());
    const AUTO_LOGOUT_MS = 30 * 60 * 1000;

    // ─── Data ─────────────────────────────────────────────────────
    const [stats, setStats] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [weddings, setWeddings] = useState<any[]>([]);
    const [content, setContent] = useState<{ videos: any[]; photos: any[] }>({ videos: [], photos: [] });
    const [payments, setPayments] = useState<any[]>([]);
    const [siteSettings, setSiteSettings] = useState<Record<string, string>>({});
    const [encodingQueue, setEncodingQueue] = useState<any[]>([]);
    const [extendedAnalytics, setExtendedAnalytics] = useState<any>(null);

    // ─── Modal ────────────────────────────────────────────────────
    const [confirmAction, setConfirmAction] = useState<{ type: string; entity: string; id: string; name: string } | null>(null);

    // ─── Check session on mount ───────────────────────────────────
    useEffect(() => {
        const t = sessionStorage.getItem("admin_token");
        if (t) { setToken(t); setIsAuthenticated(true); }
    }, []);

    // ─── Auto-logout timer ────────────────────────────────────────
    useEffect(() => {
        if (!isAuthenticated) return;
        const resetActivity = () => setLastActivity(Date.now());
        window.addEventListener("mousemove", resetActivity);
        window.addEventListener("keydown", resetActivity);
        const timer = setInterval(() => {
            if (Date.now() - lastActivity > AUTO_LOGOUT_MS) handleLogout();
        }, 30000);
        return () => { window.removeEventListener("mousemove", resetActivity); window.removeEventListener("keydown", resetActivity); clearInterval(timer); };
    }, [isAuthenticated, lastActivity]);

    // ─── Fetch helper ─────────────────────────────────────────────
    const adminFetch = useCallback(async (action: string) => {
        const res = await fetch(`/api/aadminster?action=${action}`, { headers: { "x-admin-token": token } });
        if (res.status === 401) { handleLogout(); return null; }
        return await res.json();
    }, [token]);

    const adminMutate = useCallback(async (method: "PATCH" | "DELETE", body: any) => {
        const res = await fetch("/api/aadminster", {
            method, headers: { "Content-Type": "application/json", "x-admin-token": token }, body: JSON.stringify(body)
        });
        return await res.json();
    }, [token]);

    // ─── Load data for active tab ─────────────────────────────────
    useEffect(() => {
        if (!isAuthenticated || !token) return;
        setLoading(true);
        const load = async () => {
            try {
                switch (activeTab) {
                    case "dashboard": setStats(await adminFetch("stats")); break;
                    case "users": setUsers(await adminFetch("users") || []); break;
                    case "subscriptions": setSubscriptions(await adminFetch("subscriptions") || []); break;
                    case "weddings": setWeddings(await adminFetch("weddings") || []); break;
                    case "content": setContent(await adminFetch("content") || { videos: [], photos: [] }); break;
                    case "payments": setPayments(await adminFetch("payments") || []); break;
                    case "settings": setSiteSettings(await adminFetch("settings") || {}); break;
                    case "queue": setEncodingQueue(await adminFetch("queue") || []); break;
                    case "analytics": setExtendedAnalytics(await adminFetch("analytics_extended")); break;
                }
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        load();
    }, [activeTab, isAuthenticated, token, adminFetch]);

    // ─── Auth ─────────────────────────────────────────────────────
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (Date.now() < lockoutUntil) { setAuthError(`Too many attempts. Wait ${Math.ceil((lockoutUntil - Date.now()) / 1000)}s.`); return; }
        setAuthLoading(true); setAuthError("");
        try {
            const res = await fetch("/api/aadminster", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (res.ok && data.token) {
                sessionStorage.setItem("admin_token", data.token);
                setToken(data.token); setIsAuthenticated(true); setFailedAttempts(0);
            } else {
                const attempts = failedAttempts + 1;
                setFailedAttempts(attempts);
                if (attempts >= MAX_ATTEMPTS) { setLockoutUntil(Date.now() + LOCKOUT_MS); setAuthError("Too many failed attempts. Locked for 60 seconds."); }
                else setAuthError(`Invalid password. ${MAX_ATTEMPTS - attempts} attempts remaining.`);
            }
        } catch { setAuthError("Connection error."); }
        setAuthLoading(false); setPassword("");
    };

    const handleLogout = () => {
        sessionStorage.removeItem("admin_token");
        setToken(""); setIsAuthenticated(false); setPassword("");
        setStats(null); setUsers([]); setSubscriptions([]); setWeddings([]); setPayments([]);
        setContent({ videos: [], photos: [] }); setSiteSettings({}); setEncodingQueue([]); setExtendedAnalytics(null);
    };

    // ─── Actions ──────────────────────────────────────────────────
    const handleChangeRole = async (userId: string, newRole: string) => {
        await adminMutate("PATCH", { entity: "user", id: userId, role: newRole });
        setUsers(await adminFetch("users") || []);
    };
    const handleCancelSub = async (subId: string) => {
        await adminMutate("PATCH", { entity: "subscription", id: subId, status: "cancelled" });
        setSubscriptions(await adminFetch("subscriptions") || []);
    };
    const handleExtendSub = async (subId: string, months: number) => {
        await adminMutate("PATCH", { entity: "subscription", id: subId, extend_months: months });
        setSubscriptions(await adminFetch("subscriptions") || []);
    };
    const handleDelete = async (entity: string, id: string) => {
        await adminMutate("DELETE", { entity, id });
        setConfirmAction(null);
        // Refresh the relevant tab
        switch (entity) {
            case "user": setUsers(await adminFetch("users") || []); break;
            case "wedding": setWeddings(await adminFetch("weddings") || []); break;
            case "video": case "photo": setContent(await adminFetch("content") || { videos: [], photos: [] }); break;
        }
        setStats(await adminFetch("stats"));
    };
    const handleUpdateSettings = async (updates: Record<string, string>) => {
        const res = await adminMutate("PATCH", { entity: "settings", ...updates });
        if (res.success) setSiteSettings(await adminFetch("settings") || {});
    };
    const handleQueueAction = async (id: string, action: string) => {
        await adminMutate("PATCH", { entity: "queue", id, action });
        setEncodingQueue(await adminFetch("queue") || []);
    };

    // ─── Filter ───────────────────────────────────────────────────
    const q = searchQuery.toLowerCase();
    const filteredUsers = users.filter(u => (u.email || "").toLowerCase().includes(q) || (u.display_name || "").toLowerCase().includes(q));
    const filteredWeddings = weddings.filter(w => (w.name || "").toLowerCase().includes(q) || (w.owner_email || "").toLowerCase().includes(q));
    const filteredPayments = payments.filter(p => (p.email || "").toLowerCase().includes(q) || (p.status || "").toLowerCase().includes(q));

    // ═══════════════════════════════════════════════════════════════
    //  LOGIN GATE
    // ═══════════════════════════════════════════════════════════════
    if (!isAuthenticated) {
        return (
            <div className="login-wrap">
                <div className="login-card">
                    <div className="login-shield"><Shield size={48} /></div>
                    <h1>Master Admin</h1>
                    <p>Authorized access only. Enter admin password.</p>
                    <form onSubmit={handleLogin}>
                        <div className="pwd-field">
                            <Lock size={16} />
                            <input type="password" placeholder="Admin Password" value={password} onChange={e => setPassword(e.target.value)} autoFocus required disabled={Date.now() < lockoutUntil} />
                        </div>
                        {authError && <div className="auth-error"><AlertTriangle size={14} /> {authError}</div>}
                        <button type="submit" className="login-btn" disabled={authLoading || Date.now() < lockoutUntil}>
                            {authLoading ? <Loader2 size={18} className="spin" /> : <><Shield size={16} /> Authenticate</>}
                        </button>
                    </form>
                    <div className="login-footer">
                        <Lock size={12} /> End-to-end secured · Session expires on tab close
                    </div>
                </div>
                <style jsx>{`
                    .login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0a0a0a; padding:2rem; }
                    .login-card { max-width:420px; width:100%; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:1.5rem; padding:3rem 2.5rem; text-align:center; }
                    .login-shield { width:80px; height:80px; margin:0 auto 1.5rem; border-radius:1.25rem; background:linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05)); display:flex; align-items:center; justify-content:center; color:#ef4444; }
                    h1 { font-size:1.8rem; font-weight:800; color:#fff; margin-bottom:0.5rem; }
                    p { color:rgba(255,255,255,0.4); font-size:0.9rem; margin-bottom:2rem; }
                    .pwd-field { display:flex; align-items:center; gap:0.75rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.75rem; padding:0.9rem 1rem; margin-bottom:0.75rem; color:rgba(255,255,255,0.3); }
                    .pwd-field input { flex:1; background:none; border:none; color:#fff; font-size:0.95rem; outline:none; font-family:inherit; }
                    .pwd-field:focus-within { border-color:#ef4444; }
                    .auth-error { display:flex; align-items:center; gap:0.4rem; color:#f87171; font-size:0.8rem; margin-bottom:0.75rem; padding:0.6rem 0.8rem; background:rgba(239,68,68,0.06); border-radius:0.5rem; }
                    .login-btn { width:100%; padding:0.9rem; background:linear-gradient(135deg,#dc2626,#ef4444); color:#fff; font-weight:700; font-size:0.9rem; border:none; border-radius:0.75rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.5rem; transition:0.2s; }
                    .login-btn:hover { transform:translateY(-1px); box-shadow:0 4px 16px rgba(239,68,68,0.3); }
                    .login-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
                    .login-footer { margin-top:2rem; font-size:0.7rem; color:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; gap:0.4rem; }
                    .spin { animation:spin 1s linear infinite; }
                    @keyframes spin { to { transform:rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN PANEL
    // ═══════════════════════════════════════════════════════════════
    const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: "dashboard", label: "Dashboard", icon: <BarChart3 size={18} /> },
        { id: "users", label: "Users", icon: <Users size={18} /> },
        { id: "subscriptions", label: "Subscriptions", icon: <Crown size={18} /> },
        { id: "weddings", label: "Weddings", icon: <Film size={18} /> },
        { id: "content", label: "Content", icon: <Video size={18} /> },
        { id: "payments", label: "Payments", icon: <CreditCard size={18} /> },
        { id: "queue", label: "Encoding Queue", icon: <List size={18} /> },
        { id: "settings", label: "Settings", icon: <Settings size={18} /> },
        { id: "analytics", label: "Analytics", icon: <Activity size={18} /> },
    ];

    return (
        <div className="admin-root">
            {/* Confirm modal */}
            {confirmAction && (
                <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <AlertTriangle size={32} color="#f87171" />
                        <h3>Confirm Delete</h3>
                        <p>Permanently delete <strong>{confirmAction.name}</strong>? This action cannot be undone.</p>
                        <div className="modal-actions">
                            <button onClick={() => handleDelete(confirmAction.entity, confirmAction.id)} className="btn-delete-confirm">Delete</button>
                            <button onClick={() => setConfirmAction(null)} className="btn-cancel">Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <Shield size={22} color="#ef4444" />
                    <span>Admin</span>
                </div>
                <nav className="sidebar-nav">
                    {tabs.map(t => (
                        <button key={t.id} className={`nav-item ${activeTab === t.id ? "active" : ""}`} onClick={() => { setActiveTab(t.id); setSearchQuery(""); }}>
                            {t.icon}<span>{t.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <button onClick={handleLogout} className="logout-btn"><LogOut size={16} /> Logout</button>
                </div>
            </aside>

            {/* Main */}
            <main className="admin-main">
                {/* Top bar */}
                <header className="topbar">
                    <h2>{tabs.find(t => t.id === activeTab)?.label}</h2>
                    {activeTab !== "dashboard" && (
                        <div className="search-box">
                            <Search size={16} />
                            <input placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                        </div>
                    )}
                    <button onClick={() => { setLoading(true); setTimeout(() => window.location.reload(), 0); }} className="refresh-btn" title="Refresh"><RefreshCw size={16} /></button>
                </header>

                {loading ? (
                    <div className="loading"><Loader2 size={32} className="spin" /></div>
                ) : (
                    <div className="content-area">
                        {/* ═══ DASHBOARD ═══ */}
                        {activeTab === "dashboard" && stats && (
                            <div className="dashboard">
                                <div className="stats-grid">
                                    {[
                                        { label: "Total Users", value: stats.totalUsers, icon: <Users size={22} />, color: "#6366f1" },
                                        { label: "Subscribers", value: stats.activeSubscribers, icon: <UserCheck size={22} />, color: "#4ade80" },
                                        { label: "Weddings", value: stats.totalWeddings, icon: <Film size={22} />, color: "#c1a461" },
                                        { label: "Videos", value: stats.totalVideos, icon: <Video size={22} />, color: "#38bdf8" },
                                        { label: "Photos", value: stats.totalPhotos, icon: <ImageIcon size={22} />, color: "#f472b6" },
                                        { label: "Live Events", value: stats.totalLiveEvents, icon: <Wifi size={22} />, color: "#fb923c" },
                                        { label: "Revenue", value: formatCurrency(stats.totalRevenue), icon: <DollarSign size={22} />, color: "#4ade80" },
                                        { label: "Storage", value: formatSize(stats.totalStorage), icon: <HardDrive size={22} />, color: "#a78bfa" },
                                    ].map((s, i) => (
                                        <div key={i} className="stat-card" style={{ "--accent": s.color } as any}>
                                            <div className="stat-icon">{s.icon}</div>
                                            <div className="stat-value">{s.value}</div>
                                            <div className="stat-label">{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ═══ USERS ═══ */}
                        {activeTab === "users" && (
                            <div className="data-table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>User</th><th>Email</th><th>Role</th><th>Subscription</th><th>Storage</th><th>Joined</th><th>Actions</th>
                                    </tr></thead>
                                    <tbody>
                                        {filteredUsers.map(u => (
                                            <tr key={u.id}>
                                                <td className="user-cell">
                                                    <div className="user-avatar">{(u.display_name || u.email || "?")[0].toUpperCase()}</div>
                                                    <span>{u.display_name || "—"}</span>
                                                </td>
                                                <td className="mono">{u.email}</td>
                                                <td>
                                                    <select value={u.role || "free"} onChange={e => handleChangeRole(u.id, e.target.value)} className={`role-select ${u.role}`}>
                                                        <option value="free">Free</option>
                                                        <option value="subscriber">Subscriber</option>
                                                        <option value="admin">Admin</option>
                                                    </select>
                                                </td>
                                                <td><span className={`status-badge ${u.sub_status || "none"}`}>{u.sub_status ? `${u.plan_name}` : "None"}</span></td>
                                                <td>{formatSize(u.storage_used_bytes)}</td>
                                                <td>{formatDate(u.created_at)}</td>
                                                <td>
                                                    <button onClick={() => setConfirmAction({ type: "delete", entity: "user", id: u.id, name: u.email })} className="action-btn danger" title="Delete user">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredUsers.length === 0 && <div className="empty">No users found.</div>}
                            </div>
                        )}

                        {/* ═══ SUBSCRIPTIONS ═══ */}
                        {activeTab === "subscriptions" && (
                            <div className="data-table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>User</th><th>Plan</th><th>Status</th><th>Period</th><th>Amount</th><th>Actions</th>
                                    </tr></thead>
                                    <tbody>
                                        {subscriptions.map(s => (
                                            <tr key={s.id}>
                                                <td>
                                                    <div>{s.display_name || "—"}</div>
                                                    <div className="sub-text">{s.email}</div>
                                                </td>
                                                <td><span className="plan-badge">{s.plan_name}</span></td>
                                                <td><span className={`status-badge ${s.status}`}>{s.status}</span></td>
                                                <td>
                                                    <div>{formatDate(s.current_period_start)}</div>
                                                    <div className="sub-text">→ {formatDate(s.current_period_end)}</div>
                                                </td>
                                                <td>{formatCurrency(s.price || 0)}</td>
                                                <td className="action-cell">
                                                    {s.status === "active" && (
                                                        <>
                                                            <button onClick={() => handleExtendSub(s.id, 1)} className="action-btn extend" title="+1 Month"><Calendar size={14} /></button>
                                                            <button onClick={() => handleCancelSub(s.id)} className="action-btn danger" title="Cancel"><Ban size={14} /></button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {subscriptions.length === 0 && <div className="empty">No subscriptions yet.</div>}
                            </div>
                        )}

                        {/* ═══ WEDDINGS ═══ */}
                        {activeTab === "weddings" && (
                            <div className="data-table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>Wedding</th><th>Owner</th><th>Access Code</th><th>Videos</th><th>Photos</th><th>Live</th><th>Created</th><th>Actions</th>
                                    </tr></thead>
                                    <tbody>
                                        {filteredWeddings.map(w => (
                                            <tr key={w.id}>
                                                <td className="strong">{w.name}</td>
                                                <td>
                                                    <div>{w.owner_name || "—"}</div>
                                                    <div className="sub-text">{w.owner_email || "Unassigned"}</div>
                                                </td>
                                                <td><code className="code">{w.access_code}</code></td>
                                                <td>{w.video_count}</td>
                                                <td>{w.photo_count}</td>
                                                <td>{w.live_count}</td>
                                                <td>{formatDate(w.created_at)}</td>
                                                <td>
                                                    <button onClick={() => setConfirmAction({ type: "delete", entity: "wedding", id: w.id, name: w.name })} className="action-btn danger" title="Delete">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredWeddings.length === 0 && <div className="empty">No weddings found.</div>}
                            </div>
                        )}

                        {/* ═══ CONTENT ═══ */}
                        {activeTab === "content" && (
                            <div>
                                <h3 className="section-head"><Video size={18} /> Videos ({content.videos.length})</h3>
                                <div className="data-table-wrap">
                                    <table className="data-table">
                                        <thead><tr>
                                            <th>Title</th><th>Wedding</th><th>Owner</th><th>Size</th><th>Status</th><th>Date</th><th>Actions</th>
                                        </tr></thead>
                                        <tbody>
                                            {content.videos.map(v => (
                                                <tr key={v.id}>
                                                    <td className="strong">{v.title}</td>
                                                    <td>{v.wedding_name}</td>
                                                    <td className="sub-text">{v.owner_email || "—"}</td>
                                                    <td>{formatSize(v.file_size_bytes)}</td>
                                                    <td><span className={`status-badge ${v.processing_status}`}>{v.processing_status || "completed"}</span></td>
                                                    <td>{formatDate(v.created_at)}</td>
                                                    <td><button onClick={() => setConfirmAction({ type: "delete", entity: "video", id: v.id, name: v.title })} className="action-btn danger"><Trash2 size={14} /></button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {content.videos.length === 0 && <div className="empty">No videos.</div>}
                                </div>

                                <h3 className="section-head" style={{ marginTop: "2rem" }}><ImageIcon size={18} /> Photos ({content.photos.length})</h3>
                                <div className="data-table-wrap">
                                    <table className="data-table">
                                        <thead><tr>
                                            <th>Photo ID</th><th>Wedding</th><th>Date</th><th>Actions</th>
                                        </tr></thead>
                                        <tbody>
                                            {content.photos.map(p => (
                                                <tr key={p.id}>
                                                    <td className="mono">{p.id.slice(0, 8)}...</td>
                                                    <td>{p.wedding_name}</td>
                                                    <td>{formatDate(p.created_at)}</td>
                                                    <td><button onClick={() => setConfirmAction({ type: "delete", entity: "photo", id: p.id, name: `Photo ${p.id.slice(0, 8)}` })} className="action-btn danger"><Trash2 size={14} /></button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {content.photos.length === 0 && <div className="empty">No photos.</div>}
                                </div>
                            </div>
                        )}

                        {/* ═══ PAYMENTS ═══ */}
                        {activeTab === "payments" && (
                            <div className="data-table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>User</th><th>Amount</th><th>Status</th><th>Razorpay Order</th><th>Razorpay Payment</th><th>Method</th><th>Date</th>
                                    </tr></thead>
                                    <tbody>
                                        {filteredPayments.map(p => (
                                            <tr key={p.id}>
                                                <td>
                                                    <div>{p.display_name || "—"}</div>
                                                    <div className="sub-text">{p.email}</div>
                                                </td>
                                                <td className="strong">{formatCurrency(p.amount)}</td>
                                                <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
                                                <td className="mono">{p.razorpay_order_id ? p.razorpay_order_id.slice(0, 16) + "..." : "—"}</td>
                                                <td className="mono">{p.razorpay_payment_id ? p.razorpay_payment_id.slice(0, 16) + "..." : "—"}</td>
                                                <td>{p.payment_method || "—"}</td>
                                                <td>{formatDate(p.created_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredPayments.length === 0 && <div className="empty">No payments found.</div>}
                            </div>
                        )}

                        {/* ═══ ENCODING QUEUE ═══ */}
                        {activeTab === "queue" && (
                            <div className="data-table-wrap">
                                <table className="data-table">
                                    <thead><tr>
                                        <th>Video / Wedding</th><th>Status</th><th>Input Key</th><th>Progress / Error</th><th>Last Updated</th><th>Actions</th>
                                    </tr></thead>
                                    <tbody>
                                        {encodingQueue.map(j => (
                                            <tr key={j.id}>
                                                <td>
                                                    <div className="strong">{j.video_title}</div>
                                                    <div className="sub-text">{j.wedding_name}</div>
                                                </td>
                                                <td><span className={`status-badge ${j.status}`}>{j.status}</span></td>
                                                <td className="mono" title={j.input_key}>{j.input_key.split('/').pop()}</td>
                                                <td>
                                                    {j.status === 'failed' ? (
                                                        <div className="error-text" title={j.error}>{j.error?.slice(0, 40)}...</div>
                                                    ) : (
                                                        <div className="progress-bar-mini">
                                                            <div className="progress-fill" style={{ width: j.status === 'completed' ? '100%' : '20%' }}></div>
                                                        </div>
                                                    )}
                                                </td>
                                                <td>{formatDate(j.updated_at)}</td>
                                                <td className="action-cell">
                                                    {(j.status === 'failed' || j.status === 'processing') && (
                                                        <>
                                                            <button onClick={() => handleQueueAction(j.id, "retry")} className="action-btn extend" title="Retry"><RefreshCw size={14} /></button>
                                                            <button onClick={() => handleQueueAction(j.id, "abort")} className="action-btn danger" title="Abort"><X size={14} /></button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {encodingQueue.length === 0 && <div className="empty">Queue is empty.</div>}
                            </div>
                        )}

                        {/* ═══ SETTINGS ═══ */}
                        {activeTab === "settings" && (
                            <div className="settings-grid">
                                <div className="settings-card">
                                    <h3><HardDrive size={18} /> Resource Limits</h3>
                                    <div className="setting-row">
                                        <label>Max Video Size (GB)</label>
                                        <input type="number" value={siteSettings.max_video_size_gb || ""} onChange={e => handleUpdateSettings({ max_video_size_gb: e.target.value })} />
                                    </div>
                                    <div className="setting-row">
                                        <label>Max Videos per Wedding</label>
                                        <input type="number" value={siteSettings.max_videos_per_wedding || ""} onChange={e => handleUpdateSettings({ max_videos_per_wedding: e.target.value })} />
                                    </div>
                                    <div className="setting-row">
                                        <label>Max Photos per Wedding</label>
                                        <input type="number" value={siteSettings.max_photos_per_wedding || ""} onChange={e => handleUpdateSettings({ max_photos_per_wedding: e.target.value })} />
                                    </div>
                                </div>

                                <div className="settings-card">
                                    <h3><Shield size={18} /> Platform Control</h3>
                                    <div className="setting-row toggle">
                                        <label>Maintenance Mode</label>
                                        <button className={`toggle-btn ${siteSettings.maintenance_mode === 'true' ? 'on' : 'off'}`} 
                                                onClick={() => handleUpdateSettings({ maintenance_mode: siteSettings.maintenance_mode === 'true' ? 'false' : 'true' })}>
                                            {siteSettings.maintenance_mode === 'true' ? "ENABLED" : "DISABLED"}
                                        </button>
                                    </div>
                                    <div className="setting-row">
                                        <label>Broadcast Enabled</label>
                                        <button className={`toggle-btn ${siteSettings.broadcast_enabled === 'true' ? 'on' : 'off'}`} 
                                                onClick={() => handleUpdateSettings({ broadcast_enabled: siteSettings.broadcast_enabled === 'true' ? 'false' : 'true' })}>
                                            {siteSettings.broadcast_enabled === 'true' ? "ON" : "OFF"}
                                        </button>
                                    </div>
                                    <div className="setting-row stack">
                                        <label>Broadcast Message</label>
                                        <textarea value={siteSettings.broadcast_message || ""} 
                                                  onChange={e => setSiteSettings({ ...siteSettings, broadcast_message: e.target.value })}
                                                  onBlur={e => handleUpdateSettings({ broadcast_message: e.target.value })}
                                                  placeholder="Site-wide announcement banner text..." />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ═══ ANALYTICS ═══ */}
                        {activeTab === "analytics" && extendedAnalytics && (
                            <div className="analytics-view">
                                <div className="analytics-grid">
                                    <div className="analytics-card">
                                        <h3>Monthly User Growth</h3>
                                        <div className="chart-mock">
                                            {extendedAnalytics.growth.map((g: any, i: number) => (
                                                <div key={i} className="chart-bar-wrap">
                                                    <div className="chart-bar" style={{ height: `${Math.min(100, (g.count / 10) * 100)}%` }}>
                                                        <span className="bar-val">{g.count}</span>
                                                    </div>
                                                    <span className="bar-lab">{g.month}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="analytics-card">
                                        <h3>Recent Revenue Trend (30d)</h3>
                                        <div className="chart-mock">
                                            {extendedAnalytics.revenueDaily.slice(0, 10).map((r: any, i: number) => (
                                                <div key={i} className="chart-bar-wrap">
                                                    <div className="chart-bar revenue" style={{ height: `${Math.min(100, (r.total / 200000) * 100)}%` }}>
                                                        <span className="bar-val">{Math.round(r.total/100)}</span>
                                                    </div>
                                                    <span className="bar-lab">{r.date.slice(5)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="analytics-footer-stats">
                                    <div className="mini-stat">
                                        <label>Video Storage</label>
                                        <span>{formatSize(extendedAnalytics.storageBreakdown?.video_bytes)}</span>
                                    </div>
                                    <div className="mini-stat">
                                        <label>Photo Storage (est.)</label>
                                        <span>{formatSize(extendedAnalytics.storageBreakdown?.photo_bytes)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <style jsx>{`
                .admin-root { display:flex; min-height:100vh; background:#0a0a0a; color:#fff; font-family:'Outfit',sans-serif; }

                /* Sidebar */
                .sidebar { width:220px; background:rgba(255,255,255,0.02); border-right:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; position:fixed; top:0; bottom:0; left:0; z-index:100; }
                .sidebar-brand { display:flex; align-items:center; gap:0.6rem; padding:1.5rem 1.25rem; font-weight:800; font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.06); }
                .sidebar-nav { flex:1; padding:0.75rem 0.5rem; display:flex; flex-direction:column; gap:0.15rem; }
                .nav-item { display:flex; align-items:center; gap:0.6rem; padding:0.7rem 1rem; border-radius:0.6rem; font-size:0.85rem; font-weight:600; color:rgba(255,255,255,0.4); cursor:pointer; transition:0.15s; background:none; border:none; text-align:left; width:100%; }
                .nav-item:hover { color:rgba(255,255,255,0.7); background:rgba(255,255,255,0.03); }
                .nav-item.active { color:#ef4444; background:rgba(239,68,68,0.06); }
                .sidebar-footer { padding:1rem; border-top:1px solid rgba(255,255,255,0.06); }
                .logout-btn { display:flex; align-items:center; gap:0.5rem; width:100%; padding:0.6rem 0.8rem; border-radius:0.5rem; font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.3); cursor:pointer; transition:0.15s; background:none; border:none; }
                .logout-btn:hover { color:#f87171; background:rgba(239,68,68,0.05); }

                /* Main */
                .admin-main { flex:1; margin-left:220px; min-height:100vh; }
                .topbar { display:flex; align-items:center; gap:1rem; padding:1rem 2rem; border-bottom:1px solid rgba(255,255,255,0.06); position:sticky; top:0; background:rgba(10,10,10,0.95); backdrop-filter:blur(12px); z-index:50; }
                .topbar h2 { font-size:1.3rem; font-weight:800; }
                .search-box { display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.6rem; padding:0.5rem 0.8rem; margin-left:auto; color:rgba(255,255,255,0.3); }
                .search-box input { background:none; border:none; color:#fff; font-size:0.85rem; outline:none; width:180px; font-family:inherit; }
                .refresh-btn { padding:0.5rem; border-radius:0.5rem; color:rgba(255,255,255,0.3); cursor:pointer; transition:0.15s; background:none; border:none; }
                .refresh-btn:hover { color:#fff; background:rgba(255,255,255,0.06); }

                .content-area { padding:1.5rem 2rem; }
                .loading { display:flex; justify-content:center; padding:4rem; }

                /* Dashboard Stats */
                .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; }
                .stat-card { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.06); border-radius:1rem; padding:1.5rem; transition:0.2s; }
                .stat-card:hover { border-color:rgba(255,255,255,0.12); transform:translateY(-2px); }
                .stat-icon { width:40px; height:40px; border-radius:0.75rem; background:color-mix(in srgb, var(--accent) 10%, transparent); color:var(--accent); display:flex; align-items:center; justify-content:center; margin-bottom:1rem; }
                .stat-value { font-size:1.8rem; font-weight:800; margin-bottom:0.25rem; }
                .stat-label { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,255,255,0.35); }

                /* Tables */
                .data-table-wrap { overflow-x:auto; border-radius:0.75rem; border:1px solid rgba(255,255,255,0.06); }
                .data-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
                .data-table thead { background:rgba(255,255,255,0.03); }
                .data-table th { text-align:left; padding:0.8rem 1rem; font-weight:700; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,255,255,0.4); border-bottom:1px solid rgba(255,255,255,0.06); white-space:nowrap; }
                .data-table td { padding:0.75rem 1rem; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
                .data-table tr:hover { background:rgba(255,255,255,0.02); }
                .data-table .strong { font-weight:700; }
                .data-table .mono { font-family:monospace; font-size:0.75rem; color:rgba(255,255,255,0.5); }
                .data-table .sub-text { font-size:0.75rem; color:rgba(255,255,255,0.3); }

                /* User cell */
                .user-cell { display:flex; align-items:center; gap:0.6rem; }
                .user-avatar { width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem; color:rgba(255,255,255,0.5); flex-shrink:0; }

                /* Role select */
                .role-select { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.4rem; padding:0.3rem 0.5rem; color:#fff; font-size:0.75rem; font-weight:600; cursor:pointer; font-family:inherit; }
                .role-select option { background:#111; }
                .role-select.admin { color:#ef4444; border-color:rgba(239,68,68,0.2); }
                .role-select.subscriber { color:#4ade80; border-color:rgba(74,222,128,0.2); }

                /* Status badges */
                .status-badge { display:inline-block; padding:0.2rem 0.6rem; border-radius:100px; font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
                .status-badge.active { background:rgba(74,222,128,0.1); color:#4ade80; }
                .status-badge.captured { background:rgba(74,222,128,0.1); color:#4ade80; }
                .status-badge.completed { background:rgba(74,222,128,0.1); color:#4ade80; }
                .status-badge.expired, .status-badge.cancelled { background:rgba(239,68,68,0.1); color:#f87171; }
                .status-badge.failed { background:rgba(239,68,68,0.1); color:#f87171; }
                .status-badge.created { background:rgba(251,191,36,0.1); color:#fbbf24; }
                .status-badge.pending, .status-badge.processing { background:rgba(56,189,248,0.1); color:#38bdf8; }
                .status-badge.none { background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.3); }

                .plan-badge { display:inline-block; padding:0.2rem 0.6rem; border-radius:100px; font-size:0.7rem; font-weight:700; background:rgba(193,164,97,0.1); color:#c1a461; }
                .code { background:rgba(255,255,255,0.04); padding:0.2rem 0.5rem; border-radius:0.3rem; font-size:0.8rem; letter-spacing:0.1em; }

                /* Action buttons */
                .action-cell { display:flex; gap:0.3rem; }
                .action-btn { padding:0.4rem; border-radius:0.4rem; cursor:pointer; transition:0.15s; background:none; border:none; color:rgba(255,255,255,0.3); }
                .action-btn:hover { background:rgba(255,255,255,0.06); color:#fff; }
                .action-btn.danger:hover { background:rgba(239,68,68,0.1); color:#f87171; }
                .action-btn.extend:hover { background:rgba(74,222,128,0.1); color:#4ade80; }

                /* Section head */
                .section-head { display:flex; align-items:center; gap:0.5rem; font-size:1rem; font-weight:700; color:#c1a461; margin-bottom:0.75rem; }

                /* Empty */
                .empty { text-align:center; padding:2.5rem; color:rgba(255,255,255,0.2); font-size:0.9rem; }

                /* Modal */
                .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:999; backdrop-filter:blur(4px); }
                .modal-card { max-width:380px; width:90%; background:#111; border:1px solid rgba(255,255,255,0.1); border-radius:1.25rem; padding:2rem; text-align:center; }
                .modal-card h3 { color:#fff; margin:1rem 0 0.5rem; font-size:1.2rem; }
                .modal-card p { color:rgba(255,255,255,0.5); font-size:0.85rem; line-height:1.5; }
                .modal-actions { display:flex; gap:0.75rem; margin-top:1.5rem; }
                .btn-delete-confirm { flex:1; padding:0.75rem; background:rgba(239,68,68,0.15); color:#f87171; font-weight:700; border:none; border-radius:0.6rem; cursor:pointer; transition:0.2s; font-size:0.85rem; }
                .btn-delete-confirm:hover { background:rgba(239,68,68,0.3); }
                .btn-cancel { flex:1; padding:0.75rem; background:rgba(255,255,255,0.05); color:#fff; font-weight:600; border:none; border-radius:0.6rem; cursor:pointer; font-size:0.85rem; }

                /* Utils */
                .spin { animation:spin 1s linear infinite; }
                @keyframes spin { to { transform:rotate(360deg); } }

                /* Responsive */
                @media (max-width:900px) {
                    .sidebar { width:60px; } .sidebar span { display:none; }
                    .sidebar-brand span { display:none; } .sidebar-brand { justify-content:center; }
                    .nav-item { padding:0.7rem; justify-content:center; }
                    .admin-main { margin-left:60px; }
                    .stats-grid { grid-template-columns:repeat(2,1fr); }
                    .topbar { padding:1rem; }
                    .content-area { padding:1rem; }
                }

                /* Phase 2 Additions */
                .settings-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:1.5rem; margin-top:0.5rem; }
                .settings-card { background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:1rem; padding:1.5rem; }
                .settings-card h3 { display:flex; align-items:center; gap:0.5rem; font-size:0.9rem; font-weight:700; color:#c1a461; margin-bottom:1.5rem; }
                .setting-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid rgba(255,255,255,0.04); }
                .setting-row:last-child { border:none; margin:0; padding:0; }
                .setting-row label { font-size:0.85rem; color:rgba(255,255,255,0.5); }
                .setting-row input { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.4rem; padding:0.4rem 0.6rem; color:#fff; font-size:0.85rem; width:80px; text-align:right; outline:none; }
                .setting-row.stack { flex-direction:column; align-items:flex-start; gap:0.75rem; }
                .setting-row.stack textarea { width:100%; min-height:80px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:0.5rem; padding:0.75rem; color:#fff; font-size:0.85rem; resize:vertical; outline:none; }
                .setting-row.stack textarea:focus { border-color:#ef4444; }
                
                .toggle-btn { padding:0.4rem 0.8rem; border-radius:2rem; font-size:0.7rem; font-weight:800; border:none; cursor:pointer; transition:0.2s; }
                .toggle-btn.off { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.3); }
                .toggle-btn.on { background:rgba(74,222,128,0.15); color:#4ade80; box-shadow:0 0 12px rgba(74,222,128,0.1); }

                .progress-bar-mini { width:80px; height:4px; background:rgba(255,255,255,0.05); border-radius:10px; overflow:hidden; }
                .progress-fill { height:100%; background:#38bdf8; transition:width 0.3s; }
                .error-text { font-size:0.7rem; color:#f87171; font-style:italic; }

                .analytics-view { display:flex; flex-direction:column; gap:1.5rem; }
                .analytics-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:1.5rem; }
                .analytics-card { background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:1rem; padding:1.5rem; }
                .analytics-card h3 { font-size:0.85rem; font-weight:700; color:rgba(255,255,255,0.4); margin-bottom:1.5rem; }
                .chart-mock { height:120px; display:flex; align-items:flex-end; gap:0.5rem; padding-top:1rem; }
                .chart-bar-wrap { flex:1; display:flex; flex-direction:column; align-items:center; gap:0.5rem; height:100%; justify-content:flex-end; }
                .chart-bar { width:100%; background:rgba(99,102,241,0.2); border-radius:4px 4px 0 0; position:relative; min-height:4px; transition:height 1s; }
                .chart-bar.revenue { background:rgba(74,222,128,0.2); }
                .bar-val { position:absolute; top:-1.2rem; left:50%; transform:translateX(-50%); font-size:0.65rem; color:rgba(255,255,255,0.5); font-weight:700; }
                .bar-lab { font-size:0.6rem; color:rgba(255,255,255,0.2); text-transform:uppercase; }
                
                .analytics-footer-stats { display:flex; gap:2rem; padding:1.5rem; background:rgba(255,255,255,0.015); border-radius:1rem; border:1px solid rgba(255,255,255,0.04); }
                .mini-stat { display:flex; flex-direction:column; gap:0.25rem; }
                .mini-stat label { font-size:0.7rem; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:0.04em; }
                .mini-stat span { font-size:1.1rem; font-weight:800; color:#fff; }
            `}</style>
        </div>
    );
}
