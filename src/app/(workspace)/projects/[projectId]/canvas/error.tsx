"use client";

import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

export default function CanvasError({
    reset,
}: {
    error: Error;
    reset: () => void;
}) {
    return (
        <main
            className="canvas-shell canvas-error-page flex min-h-svh items-center justify-center p-6"
            data-canvas-theme="control-room"
        >
            <section className="canvas-error-page-card w-full max-w-md space-y-4 text-center">
                <div className="space-y-2">
                    <span className="canvas-error-page-mark" aria-hidden="true">
                        !
                    </span>
                    <h1 className="canvas-error-page-title font-semibold text-2xl">
                        We could not load this canvas
                    </h1>
                    <p className="canvas-error-page-copy text-sm">
                        Something went wrong. Please try again or return to your
                        projects.
                    </p>
                </div>
                <div className="canvas-error-page-actions flex flex-wrap justify-center gap-2">
                    <Button className="canvas-retry-button" onClick={reset}>
                        Retry
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/canvas">Volver a reuniones</Link>
                    </Button>
                </div>
            </section>
        </main>
    );
}
