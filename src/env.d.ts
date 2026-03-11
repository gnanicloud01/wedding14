import { D1Database, R2Bucket } from "@cloudflare/workers-types";

declare global {
    interface CloudflareEnv {
        DB: D1Database;
        R2: R2Bucket;
        ADMIN_SECRET: string;
        CF_ACCOUNT_ID: string;
        R2_ACCESS_KEY_ID: string;
        R2_SECRET_ACCESS_KEY: string;
        R2_PUBLIC_DOMAIN?: string;
        CF_PAGES?: string;
    }

    namespace NodeJS {
        interface ProcessEnv {
            [key: string]: string | undefined;
        }
    }
}

declare module "next" {
    interface NextApiRequest {
        env: CloudflareEnv;
    }
}

// For App Router
declare global {
    interface Request {
        cf?: any;
    }
}
