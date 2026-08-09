import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

export default function CanvasNotFound() {
    return (
        <main className="flex min-h-svh items-center justify-center p-6">
            <section className="w-full max-w-md space-y-4 text-center">
                <div className="space-y-2">
                    <h1 className="font-semibold text-2xl">Canvas not found</h1>
                    <p className="text-muted-foreground text-sm">
                        This workspace is unavailable or no longer exists.
                    </p>
                </div>
                <Button asChild>
                    <Link href="/canvas">Volver a reuniones</Link>
                </Button>
            </section>
        </main>
    );
}
