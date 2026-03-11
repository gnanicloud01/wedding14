import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // We can't check Firebase client-side auth state in middleware easily without session cookies
    // But we can check for a session cookie if we implement Firebase Admin/Session management
    // For now, since we are using client-side Firebase, the best way to handle "First Login" 
    // without complex session cookies is to let the layout or page handle it.

    // However, we can check if the user is attempting to access a protected route
    // and they don't have a 'session' token/cookie (if we were using session cookies)

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login|public).*)'],
};
