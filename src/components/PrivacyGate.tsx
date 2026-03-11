"use client";

import { useState } from "react";
import { Lock, Heart, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthContext";

interface PrivacyGateProps {
    weddingName: string;
    onUnlocked: () => void;
}

export default function PrivacyGate({ weddingName, onUnlocked }: PrivacyGateProps) {
    const [inputCode, setInputCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { user } = useAuth();

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputCode) return;

        setLoading(true);
        setError("");

        try {
            const res = await fetch(`/api/wedding/verify?code=${inputCode.toUpperCase()}${user ? `&userId=${user.uid}` : ''}`);
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            // If successful, trigger the callback to reload data
            onUnlocked();
        } catch (err: any) {
            setError(err.message || "Invalid Access Code");
            setLoading(false);
        }
    };

    return (
        <div className="privacy-gate">
            <div className="gate-content">
                <div className="vault-header">
                    <div className="vault-icon">
                        <Heart size={40} fill="var(--primary)" color="var(--primary)" />
                    </div>
                    <span className="est">Wedding Cinema • Est. 2024</span>
                    <h1>ENTER THE VAULT</h1>
                    <p>
                        Welcome to the journey. Enter the private code to unlock
                        <strong> {weddingName || 'this wedding'}</strong>&apos;s cinematic films.
                    </p>
                </div>

                <form onSubmit={handleUnlock} className="gate-form">
                    <div className="code-input-container">
                        <input
                            type="text"
                            placeholder="____ - ____ - ____"
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                            maxLength={12}
                            autoFocus
                            className={error ? 'error' : ''}
                            autoComplete="off"
                            spellCheck="false"
                        />
                    </div>

                    <button type="submit" disabled={loading || !inputCode} className="unlock-btn">
                        {loading ? "UNLOCKING..." : (
                            <>
                                <Lock size={18} />
                                ENTER THE VAULT
                            </>
                        )}
                    </button>
                </form>

                {error && <p className="error-msg">{error}</p>}

                <div className="gate-footer">
                    <div className="privacy-badge">
                        <ShieldCheck size={14} />
                        <span>Privacy Protected • End-to-End Encryption</span>
                    </div>
                </div>
            </div>

            <style jsx>{`
        .privacy-gate {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          z-index: 1000;
          padding: 2rem;
        }

        .privacy-gate::before {
          content: '';
          position: absolute;
          inset: 0;
          background: url('https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=2000');
          background-size: cover;
          background-position: center;
          filter: blur(80px) brightness(0.2);
          opacity: 0.7;
        }

        .gate-content {
          position: relative;
          width: 100%;
          max-width: 500px;
          background: rgba(15, 15, 20, 0.4);
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 2.5rem;
          padding: 4rem 2.5rem;
          text-align: center;
          box-shadow: 0 50px 100px rgba(0,0,0,0.8);
          animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .vault-header {
          margin-bottom: 3.5rem;
        }

        .vault-icon {
          width: 70px;
          height: 70px;
          background: rgba(var(--primary-rgb, 193, 164, 97), 0.05);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          border: 1px solid rgba(var(--primary-rgb, 193, 164, 97), 0.1);
        }

        .est {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          color: rgba(255, 255, 255, 0.3);
          margin-bottom: 1rem;
        }

        h1 {
          font-size: 2.25rem;
          font-weight: 800;
          margin-bottom: 1rem;
          letter-spacing: 0.1em;
          color: #fff;
        }

        p {
          font-size: 1rem;
          color: rgba(255, 255, 255, 0.5);
          line-height: 1.6;
        }

        p strong {
          color: var(--primary);
        }

        .gate-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .code-input-container {
          position: relative;
        }

        input {
          width: 100%;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 1.25rem;
          padding: 1.25rem;
          color: white;
          font-size: 1.5rem;
          text-align: center;
          letter-spacing: 0.4em;
          font-family: monospace;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        input:focus {
          outline: none;
          border-color: var(--primary);
          background: rgba(0, 0, 0, 0.7);
          box-shadow: 0 0 0 4px rgba(var(--primary-rgb, 193, 164, 97), 0.05);
          transform: scale(1.02);
        }

        input.error {
          border-color: #ef4444;
          animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
        }

        @keyframes shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
          40%, 60% { transform: translate3d(4px, 0, 0); }
        }

        .unlock-btn {
          background: var(--primary);
          color: #000;
          padding: 1.25rem;
          border-radius: 1.25rem;
          font-weight: 800;
          font-size: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .unlock-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-4px);
          box-shadow: 0 15px 30px rgba(193, 164, 97, 0.3);
        }

        .unlock-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .error-msg {
          color: #ef4444;
          margin-top: 1.5rem;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .gate-footer {
          margin-top: 3.5rem;
          display: flex;
          justify-content: center;
        }

        .privacy-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 1.2rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 100px;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
      `}</style>
        </div>
    );
}
