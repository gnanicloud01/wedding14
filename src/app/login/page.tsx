"use client";

import { useState, useEffect } from "react";
import {
    signInWithPopup,
    signInWithEmailLink,
    isSignInWithEmailLink,
    sendSignInLinkToEmail,
    GoogleAuthProvider,
    OAuthProvider
} from "firebase/auth";
import { auth, googleProvider, microsoftProvider, appleProvider } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Heart, Mail, Smartphone, ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();

    useEffect(() => {
        // Check if the user is already logged in
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                router.push("/"); // Redirect to home if already logged in
            }
        });

        // Handle email link redirect
        if (isSignInWithEmailLink(auth, window.location.href)) {
            let emailForSignIn = window.localStorage.getItem('emailForSignIn');
            if (!emailForSignIn) {
                emailForSignIn = window.prompt('Please provide your email for confirmation');
            }
            if (emailForSignIn) {
                setLoading(true);
                signInWithEmailLink(auth, emailForSignIn, window.location.href)
                    .then(() => {
                        window.localStorage.removeItem('emailForSignIn');
                        router.push("/");
                    })
                    .catch((err) => {
                        setError(err.message);
                        setLoading(false);
                    });
            }
        }

        return () => unsubscribe();
    }, [router]);

    const handleSocialLogin = async (provider: any) => {
        setError("");
        setLoading(true);
        try {
            await signInWithPopup(auth, provider);
            router.push("/");
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setError("");
        setLoading(true);
        setMessage("");

        const actionCodeSettings = {
            url: window.location.origin + '/login', // Redirect back here
            handleCodeInApp: true,
        };

        try {
            await sendSignInLinkToEmail(auth, email, actionCodeSettings);
            window.localStorage.setItem('emailForSignIn', email);
            setMessage("Login link sent! Please check your email.");
            setLoading(false);
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="gradient-bg">
                <div className="orb orb-1"></div>
                <div className="orb orb-2"></div>
            </div>

            <div className="login-card animate-scale-in">
                <header className="card-header">
                    <div className="logo">
                        <Heart size={40} fill="var(--primary)" color="var(--primary)" />
                    </div>
                    <h1>Welcome to Wedding OTT</h1>
                    <p>The vault of your most cherished memories.</p>
                </header>

                <div className="social-buttons">
                    <button onClick={() => handleSocialLogin(googleProvider)} className="social-btn google">
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
                        Continue with Google
                    </button>

                    <button onClick={() => handleSocialLogin(appleProvider)} className="social-btn apple">
                        <svg viewBox="0 0 384 512" width="18" height="18" fill="currentColor">
                            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-48.7-19.1-76.9-19.1-36.8 0-70.7 21.3-89.7 54.1-38.3 66.1-9.8 163.8 27.5 218 18.2 26.3 39.8 55.6 68.3 54.5 27-1.1 37.1-17.5 69.4-17.5 32.1 0 41.5 17.5 69.9 17 29.1-.5 47.9-26.4 66.1-53.1 20.9-30.7 29.4-60.5 29.7-62.1-.7-.3-57-22-57.1-83.1zm-48.5-184.9c15.6-19 25.9-45.3 23.3-71.5-22.3 1-49.3 15-65.5 34-14.4 16.8-27 43.6-23.7 69.2 24.8 1.9 49.3-13.3 65.9-31.7z" />
                        </svg>
                        Continue with Apple
                    </button>

                    <button onClick={() => handleSocialLogin(microsoftProvider)} className="social-btn microsoft">
                        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 23 23">
                            <path fill="#f3f3f3" d="M0 0h11v11H0z" />
                            <path fill="#f3f3f3" d="M12 0h11v11H12z" />
                            <path fill="#f3f3f3" d="M0 12h11v23H0z" />
                            <path fill="#f3f3f3" d="M12 12h11v23H12z" />
                        </svg>
                        Continue with Microsoft
                    </button>
                </div>

                <div className="divider">
                    <span>or use email</span>
                </div>

                <form className="email-form" onSubmit={handleEmailLogin}>
                    <div className="input-field">
                        <Mail size={18} className="input-icon" />
                        <input
                            type="email"
                            placeholder="name@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            required
                        />
                    </div>

                    <button type="submit" className="login-btn" disabled={loading || !email}>
                        {loading ? <Loader2 className="animate-spin" /> : (
                            <>
                                Sign in with OTP Link
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                {message && <p className="success-msg animate-fade-in">{message}</p>}
                {error && <p className="error-msg animate-fade-in">{error}</p>}

                <footer className="login-footer">
                    <p>By signing in, you agree to our <a href="#">Service Terms</a></p>
                </footer>
            </div>

            <style jsx>{`
        .login-container {
          min-height: 100vh;
          width: 100vw;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          color: white;
          overflow: hidden;
          position: relative;
        }

        .gradient-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
        }

        .orb {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.15;
          animation: float 20s infinite alternate ease-in-out;
        }

        .orb-1 {
          background: var(--primary);
          top: -200px;
          left: -100px;
          animation-delay: -5s;
        }

        .orb-2 {
          background: #ca8a04;
          bottom: -200px;
          right: -100px;
        }

        @keyframes float {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, 50px); }
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 2rem;
          padding: 3rem 2.5rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          position: relative;
          z-index: 10;
        }

        .card-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .logo {
          width: 80px;
          height: 80px;
          background: rgba(var(--primary-rgb), 0.1);
          border-radius: 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          background: linear-gradient(to bottom, #fff, #999);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        p {
          color: rgba(255, 255, 255, 0.5);
          font-size: 1rem;
        }

        .social-buttons {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .social-btn {
          width: 100%;
          height: 52px;
          border-radius: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          font-weight: 600;
          font-size: 0.95rem;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }

        .social-btn img {
          width: 18px;
          height: 18px;
        }

        .google {
          background: white;
          color: #111;
        }

        .google:hover {
          background: #f1f1f1;
          transform: translateY(-2px);
        }

        .apple {
          background: #111;
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .apple:hover {
          background: #000;
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
        }

        .microsoft {
          background: #2f2f2f;
          color: white;
        }

        .microsoft:hover {
          background: #3a3a3a;
          transform: translateY(-2px);
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 1.5rem 0;
          color: rgba(255, 255, 255, 0.2);
        }

        .divider::before, .divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
        }

        .divider span {
          padding: 0 1rem;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .email-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .input-field {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: rgba(255, 255, 255, 0.3);
        }

        input {
          width: 100%;
          height: 52px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          padding: 0 1rem 0 3rem;
          color: white;
          font-size: 0.95rem;
          transition: all 0.2s;
        }

        input:focus {
          outline: none;
          border-color: var(--primary);
          background: rgba(255, 255, 255, 0.08);
        }

        .login-btn {
          height: 52px;
          background: var(--primary);
          color: black;
          border-radius: 0.75rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: all 0.2s;
          cursor: pointer;
        }

        .login-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(193, 164, 97, 0.2);
        }

        .login-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .success-msg {
          color: #4ade80;
          font-size: 0.9rem;
          text-align: center;
          margin-top: 1rem;
        }

        .error-msg {
          color: #f87171;
          font-size: 0.9rem;
          text-align: center;
          margin-top: 1rem;
        }

        .login-footer {
          margin-top: 2rem;
          text-align: center;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.3);
        }

        .login-footer a {
          color: var(--primary);
          text-decoration: none;
        }

        .login-footer a:hover {
          text-decoration: underline;
        }

        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .animate-scale-in {
          animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
        </div>
    );
}
