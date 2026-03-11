"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Heart, Check, Zap, Crown, Shield, ArrowLeft, Loader2, Star, Clock, Sparkles } from "lucide-react";
import { useAuth } from "@/components/AuthContext";

interface Plan {
    id: string;
    name: string;
    description: string;
    price: number;
    duration_months: number;
    max_videos: number;
    max_storage_gb: number;
    max_weddings: number;
    features: string;
}

export default function PricingPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [currentSub, setCurrentSub] = useState<any>(null);
    const [pageLoading, setPageLoading] = useState(true);

    useEffect(() => {
        fetch('/api/subscription/plans')
            .then(r => r.json())
            .then(d => {
                if (d.plans) setPlans(d.plans);
                setPageLoading(false);
            })
            .catch(() => setPageLoading(false));
    }, []);

    useEffect(() => {
        if (user) {
            fetch(`/api/subscription/status?userId=${user.uid}`)
                .then(r => r.json())
                .then(d => d.subscription && setCurrentSub(d.subscription))
                .catch(console.error);
        }
    }, [user]);

    const handleSubscribe = async (plan: Plan) => {
        if (!user) {
            router.push('/login');
            return;
        }

        setLoadingPlan(plan.id);

        try {
            // 1. Sync user profile
            await fetch('/api/user/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoUrl: user.photoURL,
                }),
            });

            // 2. Create Razorpay order
            const orderRes = await fetch('/api/payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create-order',
                    userId: user.uid,
                    planId: plan.id,
                }),
            });

            const orderData = await orderRes.json();
            if (!orderRes.ok) throw new Error(orderData.error);

            // 3. Open Razorpay Checkout
            const options = {
                key: orderData.keyId,
                amount: orderData.amount,
                currency: orderData.currency,
                name: "Wedding OTT",
                description: `${orderData.plan.name} Plan — ${orderData.plan.duration_months} Months`,
                order_id: orderData.orderId,
                handler: async function (response: any) {
                    // 4. Verify payment on backend
                    try {
                        const verifyRes = await fetch('/api/payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'verify',
                                userId: user.uid,
                                planId: plan.id,
                                razorpayOrderId: response.razorpay_order_id,
                                razorpayPaymentId: response.razorpay_payment_id,
                                razorpaySignature: response.razorpay_signature,
                            }),
                        });

                        const verifyData = await verifyRes.json();
                        if (verifyData.success) {
                            router.push('/dashboard?subscribed=true');
                        } else {
                            alert('Payment verification failed. Contact support.');
                        }
                    } catch (err) {
                        alert('Verification failed. Please contact support.');
                    }
                },
                prefill: {
                    name: user.displayName || '',
                    email: user.email || '',
                },
                theme: {
                    color: "#c1a461",
                    backdrop_color: "rgba(0,0,0,0.85)",
                },
                modal: {
                    ondismiss: () => setLoadingPlan(null),
                },
            };

            const rzp = new (window as any).Razorpay(options);
            rzp.open();
        } catch (err: any) {
            console.error('Payment Error:', err);
            alert(`Error: ${err.message}`);
        } finally {
            setLoadingPlan(null);
        }
    };

    const formatPrice = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;

    const getPlanAccent = (idx: number) => {
        const accents = ['#6366f1', '#c1a461', '#22d3ee'];
        return accents[idx] || '#c1a461';
    };

    const getMonthlyPrice = (plan: Plan) => Math.round(plan.price / plan.duration_months);

    const getSavings = (plan: Plan, plans: Plan[]) => {
        if (plans.length === 0) return null;
        const baseMonthly = plans[0].price / plans[0].duration_months;
        const thisMonthly = plan.price / plan.duration_months;
        if (thisMonthly >= baseMonthly) return null;
        const saved = Math.round(((baseMonthly - thisMonthly) / baseMonthly) * 100);
        return saved > 0 ? saved : null;
    };

    if (authLoading || pageLoading) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                <Loader2 size={40} color="#c1a461" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    return (
        <div className="pricing-root">
            <script src="https://checkout.razorpay.com/v1/checkout.js" async />

            <div className="bg-effects">
                <div className="glow g1" />
                <div className="glow g2" />
            </div>

            <nav className="p-nav">
                <button onClick={() => router.push('/')} className="back-btn">
                    <ArrowLeft size={20} />
                </button>
                <div className="logo">
                    <Heart size={18} fill="#c1a461" color="#c1a461" />
                    <span>Wedding OTT</span>
                </div>
            </nav>

            <main className="p-main">
                <header className="p-header">
                    <div className="premium-badge"><Sparkles size={14} /> PREMIUM PLANS</div>
                    <h1>Your Memories Deserve the Best</h1>
                    <p>Unlock cinematic streaming for your wedding films. All plans include unlimited content.</p>
                </header>

                <div className="plans-row">
                    {plans.map((plan, idx) => {
                        const isPopular = idx === 1;
                        const isCurrentPlan = currentSub?.plan_id === plan.id;
                        const features = JSON.parse(plan.features || '[]');
                        const savings = getSavings(plan, plans);
                        const accent = getPlanAccent(idx);

                        return (
                            <div
                                key={plan.id}
                                className={`plan-card ${isPopular ? 'popular' : ''} ${isCurrentPlan ? 'current' : ''}`}
                                style={{ '--accent': accent } as any}
                            >
                                {isPopular && <div className="pop-badge">⭐ BEST VALUE</div>}
                                {isCurrentPlan && <div className="cur-badge">✓ CURRENT</div>}

                                <div className="plan-top">
                                    <div className="plan-icon-wrap">
                                        <Clock size={24} />
                                    </div>
                                    <h2>{plan.name}</h2>
                                    <p className="plan-desc">{plan.description}</p>
                                </div>

                                <div className="price-section">
                                    <div className="price-big">{formatPrice(plan.price)}</div>
                                    <div className="price-per">for {plan.duration_months} months</div>
                                    <div className="price-monthly">
                                        {formatPrice(getMonthlyPrice(plan))}/month
                                    </div>
                                    {savings && (
                                        <div className="savings-badge">Save {savings}%</div>
                                    )}
                                </div>

                                <ul className="feat-list">
                                    {features.map((f: string, i: number) => (
                                        <li key={i}><Check size={15} /> {f}</li>
                                    ))}
                                </ul>

                                <button
                                    className={`sub-btn ${isPopular ? 'primary' : ''}`}
                                    onClick={() => handleSubscribe(plan)}
                                    disabled={!!loadingPlan || isCurrentPlan}
                                >
                                    {loadingPlan === plan.id ? (
                                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                    ) : isCurrentPlan ? (
                                        'Active Plan'
                                    ) : (
                                        <>
                                            <Zap size={16} /> Subscribe Now
                                        </>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div className="trust-bar">
                    <div className="trust-item"><Shield size={18} /> 256-bit SSL</div>
                    <div className="trust-item"><Heart size={18} /> 30-Day Refund</div>
                    <div className="trust-item"><Zap size={18} /> Instant Access</div>
                    <div className="trust-item"><Crown size={18} /> UPI / Cards / Net Banking</div>
                </div>
            </main>

            <style jsx>{`
                .pricing-root {
                    min-height: 100vh;
                    background: #000;
                    color: #fff;
                    position: relative;
                    overflow: hidden;
                    font-family: 'Outfit', sans-serif;
                }
                .bg-effects { position: fixed; inset: 0; pointer-events: none; }
                .glow {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(140px);
                    opacity: 0.06;
                }
                .g1 { width: 700px; height: 700px; background: #c1a461; top: -250px; left: -100px; }
                .g2 { width: 500px; height: 500px; background: #6366f1; bottom: -200px; right: -100px; }

                .p-nav {
                    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
                    height: 60px; padding: 0 1.5rem;
                    display: flex; align-items: center; gap: 1rem;
                    background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                .back-btn { color: rgba(255,255,255,0.5); transition: 0.2s; }
                .back-btn:hover { color: #fff; }
                .logo {
                    display: flex; align-items: center; gap: 0.5rem;
                    font-weight: 700; font-size: 0.95rem; letter-spacing: 0.5px;
                }

                .p-main {
                    max-width: 1100px; margin: 0 auto;
                    padding: 100px 1.5rem 4rem;
                }

                .p-header { text-align: center; margin-bottom: 3.5rem; }
                .premium-badge {
                    display: inline-flex; align-items: center; gap: 0.4rem;
                    padding: 0.35rem 1rem; border-radius: 100px;
                    background: rgba(193,164,97,0.1);
                    border: 1px solid rgba(193,164,97,0.2);
                    color: #c1a461; font-weight: 700; font-size: 0.7rem;
                    letter-spacing: 0.12em; margin-bottom: 1.5rem;
                }
                .p-header h1 {
                    font-size: 2.8rem; line-height: 1.1; margin-bottom: 1rem;
                    background: linear-gradient(135deg, #fff 30%, #c1a461 100%);
                    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                }
                .p-header p {
                    color: rgba(255,255,255,0.45); font-size: 1.1rem;
                    max-width: 500px; margin: 0 auto;
                }

                .plans-row {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1.25rem;
                    align-items: start;
                }

                .plan-card {
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 1.25rem;
                    padding: 1.75rem;
                    position: relative;
                    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .plan-card:hover {
                    transform: translateY(-6px);
                    border-color: var(--accent, rgba(255,255,255,0.15));
                    box-shadow: 0 24px 48px rgba(0,0,0,0.4);
                }
                .plan-card.popular {
                    border-color: #c1a461;
                    background: rgba(193,164,97,0.03);
                    box-shadow: 0 0 80px rgba(193,164,97,0.06);
                    transform: scale(1.03);
                }
                .plan-card.popular:hover {
                    transform: scale(1.03) translateY(-6px);
                }
                .plan-card.current { border-color: #4ade80; }

                .pop-badge {
                    position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
                    background: linear-gradient(135deg, #c1a461, #e2c07a);
                    color: #000; padding: 3px 14px; border-radius: 100px;
                    font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em;
                    white-space: nowrap;
                }
                .cur-badge {
                    position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
                    background: #4ade80; color: #000;
                    padding: 3px 14px; border-radius: 100px;
                    font-size: 0.7rem; font-weight: 800;
                }

                .plan-top { margin-bottom: 1.5rem; }
                .plan-icon-wrap {
                    width: 48px; height: 48px; border-radius: 0.75rem;
                    background: rgba(255,255,255,0.04);
                    display: flex; align-items: center; justify-content: center;
                    color: var(--accent, #c1a461); margin-bottom: 1rem;
                }
                .plan-top h2 { font-size: 1.35rem; margin-bottom: 0.35rem; }
                .plan-desc { font-size: 0.85rem; color: rgba(255,255,255,0.35); }

                .price-section { margin-bottom: 1.5rem; }
                .price-big { font-size: 2.75rem; font-weight: 800; line-height: 1; }
                .price-per {
                    font-size: 0.85rem; color: rgba(255,255,255,0.4);
                    margin-bottom: 0.35rem;
                }
                .price-monthly {
                    font-size: 0.8rem; color: var(--accent, #c1a461);
                    font-weight: 600;
                }
                .savings-badge {
                    display: inline-block; margin-top: 0.5rem;
                    padding: 2px 8px; border-radius: 4px;
                    background: rgba(74,222,128,0.12); color: #4ade80;
                    font-size: 0.72rem; font-weight: 700;
                }

                .feat-list {
                    list-style: none; margin-bottom: 1.75rem;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    padding-top: 1rem;
                }
                .feat-list li {
                    display: flex; align-items: center; gap: 0.6rem;
                    padding: 0.4rem 0; font-size: 0.85rem;
                    color: rgba(255,255,255,0.6);
                }
                .feat-list li :global(svg) { color: #4ade80; flex-shrink: 0; }

                .sub-btn {
                    width: 100%; height: 46px; border-radius: 0.75rem;
                    font-weight: 700; font-size: 0.9rem;
                    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
                    transition: all 0.2s; cursor: pointer;
                    background: rgba(255,255,255,0.06);
                    color: #fff; border: 1px solid rgba(255,255,255,0.1);
                }
                .sub-btn:hover:not(:disabled) {
                    background: rgba(255,255,255,0.12);
                    transform: translateY(-2px);
                }
                .sub-btn.primary {
                    background: linear-gradient(135deg, #c1a461, #e2c07a);
                    color: #000; border: none;
                }
                .sub-btn.primary:hover:not(:disabled) {
                    box-shadow: 0 12px 30px rgba(193,164,97,0.35);
                    transform: translateY(-2px);
                }
                .sub-btn:disabled { opacity: 0.5; cursor: not-allowed; }

                .trust-bar {
                    display: flex; justify-content: center; gap: 2.5rem;
                    margin-top: 3.5rem; padding: 1.5rem 0;
                    border-top: 1px solid rgba(255,255,255,0.04);
                }
                .trust-item {
                    display: flex; align-items: center; gap: 0.4rem;
                    color: rgba(255,255,255,0.35); font-size: 0.8rem;
                }
                .trust-item :global(svg) { color: #c1a461; }

                @keyframes spin { to { transform: rotate(360deg); } }

                @media (max-width: 900px) {
                    .plans-row { grid-template-columns: 1fr; max-width: 400px; margin: 0 auto; }
                    .plan-card.popular { transform: none; }
                    .plan-card.popular:hover { transform: translateY(-6px); }
                    .p-header h1 { font-size: 2rem; }
                    .trust-bar { flex-wrap: wrap; justify-content: center; gap: 1.25rem; }
                }
            `}</style>
        </div>
    );
}
