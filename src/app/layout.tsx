import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthContext";

export const metadata: Metadata = {
  title: "Wedding OTT - Relive the Magic",
  description: "A private streaming platform for your wedding memories in 4K.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="main">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
