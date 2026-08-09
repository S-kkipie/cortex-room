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
        <main className="flex min-h-svh items-center justify-center p-6">
            <section className="w-full max-w-md space-y-4 text-center">
                <div className="space-y-2">
                    <h1 className="font-semibold text-2xl">
                        We could not load this canvas
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Something went wrong. Please try again or return to your
                        projects.
                    </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={reset}>Retry</Button>
                    <Button asChild variant="outline">
                        <Link href="/projects">Back to projects</Link>
                    </Button>
                </div>
            </section>
        </main>
    );
}
