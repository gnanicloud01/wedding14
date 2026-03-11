/**
 * Wedding OTT Microservices Architecture
 * 
 * This project is designed as a suite of decoupled services running on 
 * Cloudflare's global edge network and Firebase.
 */

export const Services = {
    // 1. Identity Service (Firebase)
    // Handles authentication, user profiles, and multi-platform sign-on.
    auth: {
        name: 'Identity Service',
        provider: 'Firebase Auth',
        endpoints: ['/login'],
    },

    // 2. Video Store (Cloudflare R2)
    // Decoupled object storage for raw 4K videos and ABR HLS segments.
    storage: {
        name: 'Asset Service',
        provider: 'Cloudflare R2',
        regions: 'Global Edge',
    },

    // 3. Database Service (Cloudflare D1)
    // Serverless SQL database holding wedding metadata and user access relations.
    database: {
        name: 'Metadata Service',
        provider: 'Cloudflare D1',
        schema: 'Wedding & User Access Relations',
    },

    // 4. API Gateway (Next.js/Cloudflare Workers)
    // Routes requests between the frontend and various services.
    gateway: {
        name: 'Edge Gateway',
        framework: 'Next.js 15 (OpenNext)',
        runtime: 'Cloudflare Pages/Workers',
    },

    // 5. Transcoding Engine (Distributed processing)
    // Currently handled by CLI scripts, but designed to be an independent service.
    processing: {
        name: 'Transcode Service',
        engine: 'FFmpeg + Python',
        output: 'HLS / DASH (ABR Capable)',
    }
};
