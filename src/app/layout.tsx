import type { Metadata } from "next";
import type { PropsWithChildren } from "react";
import { Providers } from "@/frontend/providers/providers";
import "./globals.css";

export const metadata: Metadata = {
    title: "Cortex Room",
    description: "Collaborative canvas for real-time teams",
};

export default function RootLayout({ children }: PropsWithChildren) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="min-h-svh antialiased">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
