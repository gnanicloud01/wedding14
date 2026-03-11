"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Key, Play, Heart, LogOut, User as UserIcon, Lock, ChevronRight, Crown, Zap, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [myWeddings, setMyWeddings] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user) {
      // Fetch user's unlocked weddings from D1 via a new API
      fetch(`/api/user/access?userId=${user.uid}`)
        .then(res => res.json())
        .then(data => {
          if (data.weddings) setMyWeddings(data.weddings);
        })
        .catch(err => console.error("Failed to fetch my weddings", err));
    }
  }, [user, authLoading, router]);

  const handleEnter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;

    setLoading(true);
    setError("");

    try {
      // Verify the code and optionally link it to the user account
      const res = await fetch(`/api/wedding/verify?code=${code}${user ? `&userId=${user.uid}` : ''}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // If successful, redirect to the wedding view via its stable ID (hiding the code)
      router.push(`/watch/${data.wedding.id}`);
    } catch (err: any) {
      setError(err.message || "Invalid Access Code");
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login"); // Optional: clear state and stay here
  };

  if (authLoading) return <div className="loading-screen"><div className="loader"></div></div>;

  return (
    <div className="home-container">
      <div className="hero-bg">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="overlay" />
        <div className="hero-visual" />
      </div>

      <div className="content animate-fade-in">
        <header className="home-header">
          <div className="logo">
            <Heart size={32} fill="var(--primary)" color="var(--primary)" />
            <span>Wedding OTT</span>
          </div>

          <div className="user-nav">
            {user ? (
              <div className="user-profile">
                <button onClick={() => router.push('/dashboard')} className="nav-link" title="Dashboard">
                  <Crown size={16} />
                </button>
                <div className="profile-info">
                  <span className="user-name">{user.displayName || user.email?.split('@')[0]}</span>
                  <span className="user-status">Premium Member</span>
                </div>
                <div className="avatar">
                  {user.photoURL ? <img src={user.photoURL} alt="Avatar" /> : <UserIcon size={20} />}
                </div>
                <button onClick={handleLogout} className="logout-btn" title="Sign Out">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => router.push("/login")}
                className="login-trigger-btn"
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        <main className="hero-content">
          <section className="welcome-hero">
            <h1>Relive Your Most Beautiful Days</h1>
            <p>A secure, private sanctuary for your wedding cinema.</p>
            <div className="hero-ctas">
              <button onClick={() => router.push('/pricing')} className="cta-primary">
                <Zap size={18} /> View Plans & Pricing
              </button>
              {user && (
                <button onClick={() => router.push('/dashboard')} className="cta-secondary">
                  <Crown size={18} /> My Dashboard
                </button>
              )}
            </div>
          </section>

          {user && myWeddings.length > 0 && (
            <section className="dashboard-section animate-slide-up">
              <div className="section-header">
                <h2><Lock size={18} className="icon" /> Your Private Collection</h2>
              </div>
              <div className="weddings-grid">
                {myWeddings.map((w: any) => (
                  <div
                    key={w.id}
                    className="wedding-card"
                    onClick={() => router.push(`/watch/${w.access_code}`)}
                  >
                    <div className="card-media">
                      {/* Using a placeholder visual. In real app, use wedding thumbnail */}
                      <div className="card-visual" />
                      <div className="play-overlay"><Play fill="white" size={32} /></div>
                    </div>
                    <div className="card-info">
                      <h3>{w.name}</h3>
                      <span>{new Date(w.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</span>
                    </div>
                    <ChevronRight className="arrow" size={20} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="access-section animate-slide-up">
            <div className="vault-entry-card">
              <div className="vault-decoration">
                <Lock size={20} className="lock-icon" />
              </div>
              <div className="section-header">
                <h2>{user ? "Unlock New Wedding" : "Enter Your Private Vault"}</h2>
                <p>Welcome to the journey. Enter your unique 8-digit access code to relive your most beautiful memories.</p>
              </div>

              <form onSubmit={handleEnter} className="code-form-premium">
                <div className="input-glow-container">
                  <input
                    type="text"
                    placeholder="____ - ____"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoFocus={!user || myWeddings.length === 0}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <div className="input-glow"></div>
                </div>

                <button type="submit" disabled={loading || !code} className="enter-vault-btn">
                  {loading ? (
                    <div className="btn-loading">
                      <div className="small-loader"></div>
                      <span>Verifying...</span>
                    </div>
                  ) : (
                    <>
                      <span>{user ? "UNLOCK & WATCH" : "ENTER THE VAULT"}</span>
                      <ChevronRight size={20} />
                    </>
                  )}
                </button>
              </form>

              {error && <p className="error-msg-premium">{error}</p>}

              <div className="vault-security-footer">
                <ShieldCheck size={14} />
                <span>Privacy Mandated • Industry Standard Encryption</span>
              </div>
            </div>
          </section>
        </main>

        <footer className="home-footer">
          <div className="footer-links">
            <a href="#">Privacy</a>
            <span className="dot">•</span>
            <a href="#">Security</a>
            <span className="dot">•</span>
            <a href="#">Terms</a>
          </div>
          <p>© 2024 Wedding OTT. Powered by FireAuth & Edge Streaming.</p>
        </footer>
      </div>

      <style jsx>{`
        .home-container {
          min-height: 100vh;
          position: relative;
          color: white;
          overflow-x: hidden;
        }

        .loading-screen {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
        }

        .loader {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(var(--primary-rgb), 0.2);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .hero-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
        }

        .hero-visual {
          width: 100%;
          height: 100%;
          background: linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url('https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=2000');
          background-size: cover;
          background-position: center;
          filter: brightness(0.6);
          scale: 1.1;
        }

        .orb {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.1;
          pointer-events: none;
        }
        .orb-1 { background: var(--primary); top: -200px; left: -100px; animation: float 15s infinite alternate ease-in-out; }
        .orb-2 { background: #ca8a04; bottom: -200px; right: -100px; animation: float 20s infinite alternate-reverse ease-in-out; }

        @keyframes float {
          0% { transform: translate(0,0); }
          100% { transform: translate(100px, 100px); }
        }

        .overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at center, transparent 0%, var(--background) 100%);
        }

        .content {
          width: 100%;
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .home-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2rem 0;
          margin-bottom: 4rem;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 1.25rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .user-nav {
          display: flex;
          align-items: center;
        }

        .user-profile {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: rgba(255,255,255,0.05);
          padding: 0.5rem 0.5rem 0.5rem 1.25rem;
          border-radius: 100px;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .profile-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .user-name {
          font-size: 0.9rem;
          font-weight: 700;
        }

        .user-status {
          font-size: 0.7rem;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .logout-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.5);
          transition: 0.2s;
        }

        .logout-btn:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
        }

        .login-trigger-btn {
          padding: 0.75rem 1.5rem;
          background: rgba(255,255,255,0.1);
          border-radius: 100px;
          font-weight: 700;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.1);
          transition: 0.2s;
        }

        .login-trigger-btn:hover {
          background: rgba(255,255,255,0.2);
          transform: translateY(-2px);
        }

        .hero-content {
          flex: 1;
        }

        .welcome-hero h1 {
          font-size: 4rem;
          margin-bottom: 1.5rem;
          line-height: 1.1;
          background: linear-gradient(to right, #fff, var(--primary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .welcome-hero p {
          font-size: 1.5rem;
          color: rgba(255,255,255,0.6);
          margin-bottom: 2rem;
        }

        .hero-ctas {
          display: flex;
          gap: 1rem;
          margin-bottom: 4rem;
        }

        .cta-primary {
          padding: 0.9rem 1.5rem;
          background: var(--primary);
          color: black;
          border-radius: 0.75rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
        }

        .cta-primary:hover {
          background: var(--primary-hover);
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(193, 164, 97, 0.3);
        }

        .cta-secondary {
          padding: 0.9rem 1.5rem;
          background: rgba(255,255,255,0.05);
          color: white;
          border-radius: 0.75rem;
          font-weight: 700;
          border: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
        }

        .cta-secondary:hover {
          background: rgba(255,255,255,0.1);
          transform: translateY(-2px);
        }

        .nav-link {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
          transition: 0.2s;
        }

        .nav-link:hover {
          background: rgba(var(--primary-rgb, 193, 164, 97), 0.1);
        }

        .dashboard-section {
          margin-bottom: 4rem;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .section-header h2 {
          font-size: 1.25rem;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .section-header .icon { color: var(--primary); }

        .weddings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .wedding-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1.5rem;
          padding: 1rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }

        .wedding-card:hover {
          background: rgba(255,255,255,0.08);
          transform: translateY(-5px) scale(1.02);
          border-color: var(--primary);
          box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }

        .card-media {
          width: 80px;
          height: 80px;
          border-radius: 1rem;
          overflow: hidden;
          position: relative;
        }

        .card-visual {
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #111, #333);
        }

        .play-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.3);
          opacity: 0;
          transition: 0.2s;
        }

        .wedding-card:hover .play-overlay { opacity: 1; }

        .card-info h3 { margin-bottom: 0.25rem; font-size: 1.1rem; }
        .card-info span { font-size: 0.8rem; color: rgba(255,255,255,0.4); }

        .arrow { margin-left: auto; color: rgba(255,255,255,0.2); }
        .wedding-card:hover .arrow { color: var(--primary); }

        .access-section {
          max-width: 600px;
          margin: 4rem auto;
        }

        .vault-entry-card {
          background: rgba(15,15,20, 0.4);
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 2.5rem;
          padding: 4rem 3rem;
          text-align: center;
          position: relative;
          overflow: hidden;
          box-shadow: 0 40px 80px rgba(0,0,0,0.6);
        }

        .vault-decoration {
          width: 50px;
          height: 50px;
          background: rgba(var(--primary-rgb, 193, 164, 97), 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 2rem;
          border: 1px solid rgba(var(--primary-rgb, 193, 164, 97), 0.2);
          color: var(--primary);
        }

        .code-form-premium {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          margin-top: 2.5rem;
        }

        .input-glow-container {
          position: relative;
        }

        .input-glow-container input {
          width: 100%;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 1.25rem;
          padding: 1.5rem;
          color: white;
          font-size: 2rem;
          text-align: center;
          letter-spacing: 0.4em;
          font-family: monospace;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .input-glow-container input:focus {
          outline: none;
          border-color: var(--primary);
          background: rgba(0, 0, 0, 0.7);
          box-shadow: 0 0 20px rgba(var(--primary-rgb, 193, 164, 97), 0.2);
          transform: scale(1.02);
        }

        .enter-vault-btn {
          background: var(--primary);
          color: #000;
          padding: 1.5rem;
          border-radius: 1.25rem;
          font-weight: 800;
          font-size: 1.1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .enter-vault-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-4px);
          box-shadow: 0 20px 40px rgba(var(--primary-rgb, 193, 164, 97), 0.3);
        }

        .enter-vault-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .error-msg-premium {
          color: #ef4444;
          margin-top: 1.5rem;
          font-weight: 600;
          font-size: 1rem;
        }

        .vault-security-footer {
          margin-top: 3.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.6rem 1.2rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 100px;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .btn-loading {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .small-loader {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(0,0,0,0.1);
          border-top-color: #000;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .error-msg {
          color: #f87171;
          margin-top: 1rem;
          font-size: 0.9rem;
          text-align: center;
        }

        .home-footer {
          margin-top: 4rem;
          padding: 2rem 0;
          border-top: 1px solid rgba(255,255,255,0.05);
          text-align: center;
          color: rgba(255,255,255,0.3);
          font-size: 0.9rem;
        }

        .footer-links {
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        }

        .footer-links a { color: inherit; text-decoration: none; }
        .footer-links a:hover { color: #fff; }
        .dot { opacity: 0.5; }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .animate-fade-in { animation: fadeIn 0.8s ease-out forwards; }
        .animate-slide-up { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

        @media (max-width: 640px) {
          .welcome-hero h1 { font-size: 2.5rem; }
          .welcome-hero p { font-size: 1.1rem; }
        }
      `}</style>
    </div>
  );
}
