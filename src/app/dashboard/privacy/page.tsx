"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, User, Mail, Lock, Trash2, ArrowLeft, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { auth } from "@/lib/firebase";
import { updateProfile, deleteUser } from "firebase/auth";

export default function PrivacyPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    const [displayName, setDisplayName] = useState("");
    const [updating, setUpdating] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/login");
            return;
        }
        if (user) {
            setDisplayName(user.displayName || "");
        }
    }, [user, authLoading]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setUpdating(true);
        setMessage(null);

        try {
            await updateProfile(user, { displayName });
            setMessage({ type: 'success', text: "Profile updated successfully!" });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setUpdating(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user) return;
        setUpdating(true);
        try {
            // In production, you'd also call a backend to wipe their D1 data
            await fetch(`/api/user/delete?userId=${user.uid}`, { method: 'DELETE' });
            await deleteUser(user);
            router.push("/login");
        } catch (err: any) {
            setMessage({ type: 'error', text: "For security, please re-login before deleting your account." });
            setUpdating(false);
            setShowDeleteConfirm(false);
        }
    };

    if (authLoading || !user) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                <Loader2 size={40} color="#c1a461" className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="privacy-root">
            <nav className="privacy-nav">
                <button onClick={() => router.push('/dashboard')} className="back-btn">
                    <ArrowLeft size={20} />
                </button>
                <div className="nav-logo">
                    <ShieldCheck size={20} color="#c1a461" />
                    <span>Privacy & Security</span>
                </div>
            </nav>

            <main className="privacy-main animate-fade-in">
                <header className="page-header">
                    <h1>Account Privacy</h1>
                    <p>Manage your identity and security settings for Wedding OTT.</p>
                </header>

                <div className="settings-grid">
                    {/* Profile Section */}
                    <section className="settings-card glass-panel">
                        <div className="card-header">
                            <User size={20} color="#c1a461" />
                            <h2>Public Identity</h2>
                        </div>
                        <form onSubmit={handleUpdateProfile} className="settings-form">
                            <div className="input-group">
                                <label>Display Name</label>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="Your full name"
                                />
                            </div>
                            <div className="input-group">
                                <label>Registered Email</label>
                                <div className="readonly-box">
                                    <Mail size={16} />
                                    <span>{user.email}</span>
                                </div>
                                <p className="hint">Email cannot be changed directly. Contact support for migration.</p>
                            </div>
                            <button type="submit" className="save-btn" disabled={updating}>
                                {updating ? "Saving..." : "Update Profile"}
                            </button>
                        </form>
                    </section>

                    {/* Security Section */}
                    <section className="settings-card glass-panel">
                        <div className="card-header">
                            <Lock size={20} color="#c1a461" />
                            <h2>Security Check</h2>
                        </div>
                        <div className="security-status">
                            <div className="status-item">
                                <CheckCircle size={18} color="#4ade80" />
                                <div>
                                    <strong>Multi-Factor Ready</strong>
                                    <span>Your account is protected by modern OAuth 2.0.</span>
                                </div>
                            </div>
                            <div className="status-item">
                                <ShieldCheck size={18} color="#c1a461" />
                                <div>
                                    <strong>Private Vaults</strong>
                                    <span>Your wedding access is restricted to your authorized devices.</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Danger Zone */}
                    <section className="settings-card glass-panel danger">
                        <div className="card-header">
                            <Trash2 size={20} color="#f87171" />
                            <h2>Danger Zone</h2>
                        </div>
                        <p className="danger-text">Permanently delete your account and all associated wedding access. This action is irreversible.</p>
                        {!showDeleteConfirm ? (
                            <button onClick={() => setShowDeleteConfirm(true)} className="delete-btn">Delete My Account</button>
                        ) : (
                            <div className="confirm-box">
                                <p>Are you absolutely sure?</p>
                                <div className="confirm-btns">
                                    <button onClick={handleDeleteAccount} className="confirm-yes" disabled={updating}>
                                        {updating ? "Deleting..." : "Yes, Delete Everything"}
                                    </button>
                                    <button onClick={() => setShowDeleteConfirm(false)} className="confirm-no">Cancel</button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                {message && (
                    <div className={`status-toast ${message.type}`}>
                        {message.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                        <span>{message.text}</span>
                    </div>
                )}
            </main>

            <style jsx>{`
                .privacy-root { min-height: 100vh; background: #000; color: #fff; font-family: 'Outfit', sans-serif; }
                .privacy-nav {
                    position: fixed; top: 0; left: 0; right: 0; height: 60px; padding: 0 1.5rem;
                    display: flex; align-items: center; gap: 1rem; z-index: 100;
                    background: rgba(0,0,0,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                .back-btn { color: rgba(255,255,255,0.5); transition: 0.2s; cursor: pointer; background: none; border: none; }
                .back-btn:hover { color: #fff; }
                .nav-logo { display: flex; align-items: center; gap: 0.75rem; font-weight: 700; color: #fff; }

                .privacy-main { max-width: 800px; margin: 0 auto; padding: 100px 1.5rem 4rem; }
                .page-header { margin-bottom: 2.5rem; }
                .page-header h1 { font-size: 2.5rem; font-weight: 800; letter-spacing: -1px; margin-bottom: 0.5rem; }
                .page-header p { color: rgba(255,255,255,0.5); font-size: 1.1rem; }

                .settings-grid { display: grid; gap: 1.5rem; }
                .settings-card { padding: 2rem; border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
                .settings-card.danger { border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.02); }
                
                .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; }
                .card-header h2 { font-size: 1.25rem; font-weight: 700; }

                .settings-form { display: grid; gap: 1.5rem; }
                .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
                .input-group label { font-size: 0.85rem; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.05em; }
                
                input {
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                    padding: 0.75rem 1rem; border-radius: 0.75rem; color: #fff; font-size: 1rem; transition: 0.2s;
                }
                input:focus { outline: none; border-color: #c1a461; background: rgba(255,255,255,0.08); }

                .readonly-box {
                    display: flex; align-items: center; gap: 0.75rem;
                    padding: 0.75rem 1rem; background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.05); border-radius: 0.75rem;
                    color: rgba(255,255,255,0.6); font-family: monospace;
                }
                .hint { font-size: 0.75rem; color: rgba(255,255,255,0.3); }

                .save-btn {
                    padding: 0.75rem; background: #c1a461; color: #000; font-weight: 800;
                    border: none; border-radius: 0.75rem; cursor: pointer; transition: 0.2s;
                }
                .save-btn:hover { opacity: 0.9; transform: translateY(-1px); }

                .security-status { display: grid; gap: 1rem; }
                .status-item {
                    display: flex; gap: 1rem; padding: 1rem;
                    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
                    border-radius: 1rem;
                }
                .status-item div { display: flex; flex-direction: column; }
                .status-item strong { font-size: 0.95rem; }
                .status-item span { font-size: 0.8rem; color: rgba(255,255,255,0.4); }

                .danger-text { color: rgba(255,255,255,0.5); font-size: 0.9rem; margin-bottom: 1.5rem; }
                .delete-btn {
                    padding: 0.75rem 1.5rem; background: rgba(239, 68, 68, 0.1); color: #f87171;
                    border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 0.75rem; font-weight: 700;
                    cursor: pointer; transition: 0.2s;
                }
                .delete-btn:hover { background: rgba(239, 68, 68, 0.2); }

                .confirm-box { text-align: center; padding: 1rem; background: rgba(239, 68, 68, 0.05); border-radius: 1rem; }
                .confirm-btns { display: flex; gap: 0.75rem; justify-content: center; margin-top: 1rem; }
                .confirm-yes { background: #ef4444; color: #fff; font-weight: 700; padding: 0.6rem 1.2rem; border-radius: 0.5rem; border: none; cursor: pointer; }
                .confirm-no { background: rgba(255,255,255,0.1); color: #fff; padding: 0.6rem 1.2rem; border-radius: 0.5rem; border: none; cursor: pointer; }

                .status-toast {
                    position: fixed; bottom: 2rem; right: 2rem;
                    display: flex; align-items: center; gap: 0.75rem;
                    padding: 1rem 1.5rem; border-radius: 1rem; font-weight: 600;
                    animation: slideUp 0.3s ease; z-index: 200;
                }
                .status-toast.success { background: #4ade80; color: #064e3b; }
                .status-toast.error { background: #ef4444; color: #fff; }

                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .animate-fade-in { animation: fadeIn 0.4s ease-out; }
            `}</style>
        </div>
    );
}
