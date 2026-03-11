"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Heart, ArrowLeft, Crown, Upload, Film, HardDrive, Calendar, ChevronRight, Zap, AlertTriangle, CheckCircle, Loader2, CreditCard, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthContext";

function DashboardContent() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const justSubscribed = searchParams.get('subscribed') === 'true';

    const [subscription, setSubscription] = useState<any>(null);
    const [canUpload, setCanUpload] = useState(false);
    const [uploadBlockReason, setUploadBlockReason] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/login");
            return;
        }
        if (user) fetchDashboard();
    }, [user, authLoading]);

    useEffect(() => {
        if (justSubscribed) {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
        }
    }, [justSubscribed]);

    const fetchDashboard = async () => {
        try {
            // Sync user
            await fetch('/api/user/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user!.uid,
                    email: user!.email,
                    displayName: user!.displayName,
                    photoUrl: user!.photoURL,
                }),
            });

            const statusRes = await fetch(`/api/subscription/status?userId=${user!.uid}`);
            const statusData = await statusRes.json();

            setSubscription(statusData.subscription);
            setCanUpload(statusData.canUpload);
            setUploadBlockReason(statusData.uploadBlockReason);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelSubscription = async () => {
        if (!confirm("Are you sure you want to cancel? You'll lose access to upload features at the end of your current period.")) return;

        await fetch('/api/subscription/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel', userId: user!.uid }),
        });

        fetchDashboard();
    };

    const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const formatPrice = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;

    if (authLoading || loading) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                <Loader2 size={40} color="#c1a461" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    return (
        <div className="dash-root">
            <nav className="dash-nav">
                <button onClick={() => router.push('/')} className="back-btn">
                    <ArrowLeft size={20} />
                </button>
                <div className="nav-logo">
                    <Heart size={18} fill="#c1a461" color="#c1a461" />
                    <span>My Dashboard</span>
                </div>
            </nav>

            <main className="dash-main">
                {/* Success Banner */}
                {showSuccess && (
                    <div className="success-banner">
                        <CheckCircle size={20} />
                        <span>🎉 Subscription activated! You now have full access.</span>
                    </div>
                )}

                {/* Subscription Status */}
                <section className="status-card">
                    <div className="status-row">
                        <div className="status-icon-wrap">
                            {subscription ? <Crown size={28} /> : <AlertTriangle size={28} />}
                        </div>
                        <div className="status-info">
                            <h1>{subscription ? `${subscription.plan_name} Plan` : 'Free Account'}</h1>
                            <p>
                                {subscription
                                    ? `Active until ${formatDate(subscription.current_period_end)}`
                                    : 'Subscribe to upload and manage wedding videos'
                                }
                            </p>
                        </div>
                        <div className={`status-pill ${subscription ? 'active' : 'free'}`}>
                            {subscription ? 'Active' : 'Free'}
                        </div>
                    </div>

                    {subscription && (
                        <div className="info-grid">
                            <div className="info-item">
                                <Calendar size={16} />
                                <div>
                                    <span className="info-val">{subscription.duration_months} Months</span>
                                    <span className="info-label">Duration</span>
                                </div>
                            </div>
                            <div className="info-item">
                                <Film size={16} />
                                <div>
                                    <span className="info-val">{subscription.max_videos === -1 ? '∞' : subscription.max_videos}</span>
                                    <span className="info-label">Videos</span>
                                </div>
                            </div>
                            <div className="info-item">
                                <HardDrive size={16} />
                                <div>
                                    <span className="info-val">{subscription.max_storage_gb === -1 ? '∞' : `${subscription.max_storage_gb} GB`}</span>
                                    <span className="info-label">Storage</span>
                                </div>
                            </div>
                            <div className="info-item">
                                <CreditCard size={16} />
                                <div>
                                    <span className="info-val">Paid</span>
                                    <span className="info-label">Status</span>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* Upload Access */}
                <section className="access-card">
                    <div className="access-title"><Upload size={18} /> Upload Access</div>
                    {canUpload ? (
                        <div className="access-ok">
                            <CheckCircle size={22} />
                            <div>
                                <h3>Ready to Upload</h3>
                                <p>Upload unlimited videos to your weddings.</p>
                            </div>
                            <button onClick={() => router.push('/studio')} className="go-btn">
                                Open Studio <ChevronRight size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="access-blocked">
                            <AlertTriangle size={22} />
                            <div>
                                <h3>Uploads Locked</h3>
                                <p>{uploadBlockReason || 'Subscribe to start uploading.'}</p>
                            </div>
                            <button onClick={() => router.push('/pricing')} className="upgrade-btn">
                                <Zap size={14} /> Upgrade
                            </button>
                        </div>
                    )}
                </section>

                {/* Quick Actions */}
                <div className="actions-row">
                    <button className="action-card" onClick={() => router.push('/pricing')}>
                        <Crown size={22} />
                        <span>{subscription ? 'Change Plan' : 'View Plans'}</span>
                        <ChevronRight size={16} />
                    </button>
                    <button className="action-card" onClick={() => router.push('/studio')}>
                        <Film size={22} />
                        <span>Manage Videos</span>
                        <ChevronRight size={16} />
                    </button>
                    <button className="action-card" onClick={() => router.push('/dashboard/privacy')}>
                        <ShieldCheck size={22} />
                        <span>Privacy & Security</span>
                        <ChevronRight size={16} />
                    </button>
                    {subscription && (
                        <button className="action-card danger" onClick={handleCancelSubscription}>
                            <AlertTriangle size={22} />
                            <span>Cancel Plan</span>
                            <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </main>

            <style jsx>{`
                .dash-root { min-height: 100vh; background: #000; color: #fff; font-family: 'Outfit', sans-serif; }

                .dash-nav {
                    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
                    height: 60px; padding: 0 1.5rem;
                    display: flex; align-items: center; gap: 1rem;
                    background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                .back-btn { color: rgba(255,255,255,0.5); transition: 0.2s; }
                .back-btn:hover { color: #fff; }
                .nav-logo { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; }

                .dash-main {
                    max-width: 720px; margin: 0 auto;
                    padding: 90px 1.5rem 4rem;
                    display: flex; flex-direction: column; gap: 1.25rem;
                }

                .success-banner {
                    display: flex; align-items: center; gap: 0.75rem;
                    padding: 1rem 1.25rem; border-radius: 0.75rem;
                    background: rgba(74,222,128,0.08);
                    border: 1px solid rgba(74,222,128,0.15);
                    color: #4ade80; font-weight: 600; font-size: 0.9rem;
                    animation: slideDown 0.4s ease;
                }

                .status-card {
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 1.25rem; padding: 1.75rem;
                }
                .status-row {
                    display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;
                }
                .status-icon-wrap {
                    width: 56px; height: 56px; border-radius: 1rem;
                    background: rgba(193,164,97,0.08);
                    display: flex; align-items: center; justify-content: center;
                    color: #c1a461;
                }
                .status-info { flex: 1; }
                .status-info h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
                .status-info p { font-size: 0.85rem; color: rgba(255,255,255,0.4); }

                .status-pill {
                    padding: 0.3rem 0.9rem; border-radius: 100px;
                    font-weight: 700; font-size: 0.75rem;
                    text-transform: uppercase; letter-spacing: 0.05em;
                }
                .status-pill.active {
                    background: rgba(74,222,128,0.1); color: #4ade80;
                    border: 1px solid rgba(74,222,128,0.2);
                }
                .status-pill.free {
                    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.5);
                    border: 1px solid rgba(255,255,255,0.1);
                }

                .info-grid {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem;
                    padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.05);
                }
                .info-item {
                    display: flex; align-items: center; gap: 0.6rem;
                    color: #c1a461;
                }
                .info-item div { display: flex; flex-direction: column; }
                .info-val { font-weight: 800; font-size: 1rem; color: #fff; }
                .info-label { font-size: 0.65rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.04em; }

                .access-card {
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 1.25rem; padding: 1.25rem 1.5rem;
                }
                .access-title {
                    display: flex; align-items: center; gap: 0.5rem;
                    font-weight: 700; font-size: 0.95rem; margin-bottom: 1rem;
                    color: #c1a461;
                }
                .access-ok, .access-blocked {
                    display: flex; align-items: center; gap: 1rem;
                    padding: 0.9rem; border-radius: 0.75rem;
                }
                .access-ok {
                    background: rgba(74,222,128,0.04);
                    border: 1px solid rgba(74,222,128,0.1);
                    color: #4ade80;
                }
                .access-blocked {
                    background: rgba(239,68,68,0.04);
                    border: 1px solid rgba(239,68,68,0.1);
                    color: #f87171;
                }
                .access-ok h3, .access-blocked h3 { color: #fff; font-size: 0.95rem; }
                .access-ok p, .access-blocked p { color: rgba(255,255,255,0.4); font-size: 0.8rem; }
                .access-ok div, .access-blocked div { flex: 1; }

                .go-btn {
                    padding: 0.5rem 1rem; border-radius: 0.6rem;
                    background: rgba(74,222,128,0.1); color: #4ade80;
                    font-weight: 700; font-size: 0.8rem;
                    display: flex; align-items: center; gap: 0.2rem;
                    transition: 0.2s; white-space: nowrap;
                }
                .go-btn:hover { background: rgba(74,222,128,0.2); }

                .upgrade-btn {
                    padding: 0.5rem 1rem; border-radius: 0.6rem;
                    background: #c1a461; color: #000;
                    font-weight: 700; font-size: 0.8rem;
                    display: flex; align-items: center; gap: 0.3rem;
                    transition: 0.2s; white-space: nowrap;
                }
                .upgrade-btn:hover { transform: translateY(-1px); }

                .actions-row {
                    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 0.75rem;
                }
                .action-card {
                    display: flex; align-items: center; gap: 0.6rem;
                    padding: 1rem 1.1rem; border-radius: 0.9rem;
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.07);
                    color: #fff; font-weight: 600; font-size: 0.9rem;
                    transition: 0.2s; cursor: pointer;
                }
                .action-card span { flex: 1; text-align: left; }
                .action-card:hover {
                    background: rgba(255,255,255,0.06);
                    transform: translateY(-2px); border-color: #c1a461;
                }
                .action-card :global(svg:first-child) { color: #c1a461; }
                .action-card :global(svg:last-child) { color: rgba(255,255,255,0.25); }
                .action-card.danger:hover { border-color: #ef4444; }
                .action-card.danger :global(svg:first-child) { color: #f87171; }

                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @media (max-width: 640px) {
                    .info-grid { grid-template-columns: repeat(2, 1fr); }
                    .status-row { flex-wrap: wrap; }
                }
            `}</style>
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                <Loader2 size={40} color="#c1a461" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
        }>
            <DashboardContent />
        </Suspense>
    );
}
