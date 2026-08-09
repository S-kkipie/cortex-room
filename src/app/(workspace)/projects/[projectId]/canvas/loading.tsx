import { Skeleton } from "@/frontend/components/ui/skeleton";

export default function CanvasLoading() {
    return (
        <div
            className="canvas-shell flex min-h-svh flex-col"
            data-canvas-theme="control-room"
            aria-busy="true"
        >
            <header className="canvas-header">
                <div className="canvas-header__left">
                    <Skeleton className="canvas-loading-mark h-8 w-8" />
                    <div className="canvas-project-heading">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-4 w-32 max-w-full" />
                    </div>
                </div>
                <div className="canvas-header__right">
                    <Skeleton className="hidden h-4 w-28 sm:block" />
                    <Skeleton className="h-8 w-20" />
                </div>
            </header>
            <main className="canvas-loading-main flex min-h-0 flex-1 items-center justify-center p-4">
                <Skeleton className="h-48 w-full max-w-md rounded-2xl" />
            </main>
        </div>
    );
}
