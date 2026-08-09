import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { Button } from "@/frontend/components/ui/button";

export function CanvasShell({
    projectName,
    userLabel,
}: {
    projectName: string;
    userLabel: string;
}) {
    return (
        <div className="flex min-h-svh flex-col bg-muted/20">
            <header className="flex min-h-14 items-center gap-3 border-b bg-background px-4 py-2 sm:px-6">
                <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    aria-label="Back to projects"
                >
                    <Link href="/projects">
                        <ArrowLeft />
                        <span className="hidden sm:inline">Projects</span>
                    </Link>
                </Button>
                <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                        Workspace
                    </p>
                    <h1 className="truncate font-semibold text-sm">
                        {projectName}
                    </h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden max-w-40 truncate text-muted-foreground text-sm md:inline">
                        {userLabel}
                    </span>
                    <SignOutButton />
                </div>
            </header>
            <main className="flex min-h-0 flex-1 items-center justify-center p-4">
                <section className="w-full max-w-md rounded-xl border border-dashed bg-background p-8 text-center shadow-sm">
                    <h2 className="font-semibold text-lg">Workspace ready</h2>
                    <p className="mt-2 text-muted-foreground text-sm">
                        Canvas tools will appear here.
                    </p>
                </section>
            </main>
        </div>
    );
}
