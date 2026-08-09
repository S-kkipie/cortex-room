import { Skeleton } from "@/frontend/components/ui/skeleton";

export default function CanvasLoading() {
    return (
        <div className="flex min-h-svh flex-col bg-muted/20" aria-busy="true">
            <header className="flex min-h-14 items-center gap-3 border-b bg-background px-4 py-2 sm:px-6">
                <Skeleton className="h-8 w-20" />
                <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-32 max-w-full" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="hidden h-4 w-32 md:block" />
                    <Skeleton className="h-8 w-20" />
                </div>
            </header>
            <main className="flex min-h-0 flex-1 items-center justify-center p-4">
                <Skeleton className="h-48 w-full max-w-md rounded-xl" />
            </main>
        </div>
    );
}
