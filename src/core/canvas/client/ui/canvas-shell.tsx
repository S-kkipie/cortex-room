import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NavigableCanvas } from "@/core/canvas/client/ui/navigable-canvas";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { Button } from "@/frontend/components/ui/button";

export function CanvasShell({
    projectId,
    userId,
    projectName,
    userLabel,
}: {
    projectId: string;
    userId: string;
    projectName: string;
    userLabel: string;
}) {
    return (
        <div
            className="canvas-shell flex h-svh flex-col"
            data-canvas-theme="control-room"
        >
            <header className="canvas-header">
                <div className="canvas-header__left">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="canvas-back-button"
                        aria-label="Back to projects"
                    >
                        <Link href="/projects">
                            <ArrowLeft />
                            <span className="hidden sm:inline">Projects</span>
                        </Link>
                    </Button>
                    <span className="canvas-brand-mark" aria-hidden="true">
                        CR
                    </span>
                    <div className="canvas-project-heading">
                        <p className="canvas-project-kicker">
                            CORTEX / LIVE CANVAS
                        </p>
                        <h1 className="canvas-project-name">{projectName}</h1>
                    </div>
                </div>
                <div className="canvas-header__right">
                    <div className="canvas-live-indicator">
                        <span className="canvas-live-dot" aria-hidden="true" />
                        <span>Live workspace</span>
                    </div>
                    <div className="canvas-user-chip">
                        <span className="canvas-avatar" aria-hidden="true">
                            {userLabel.charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="canvas-user-label">{userLabel}</span>
                    </div>
                    <div className="canvas-signout">
                        <SignOutButton />
                    </div>
                </div>
            </header>
            <main className="canvas-main relative flex min-h-0 flex-1">
                <NavigableCanvas projectId={projectId} userId={userId} />
            </main>
        </div>
    );
}
