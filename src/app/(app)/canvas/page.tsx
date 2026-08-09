import { ArrowRight, Plus, Radio } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { projectSearchSchema } from "@/core/project/domain/schemas";
import { searchProjectsService } from "@/core/project/server/services/search-projects-service";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { requireAuth } from "@/server/auth/require-auth";
import { createRoomAction } from "./actions";

export const metadata: Metadata = { title: "Reuniones" };

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export default async function CanvasRoomsPage() {
    const { user } = await requireAuth("/canvas");
    const params = projectSearchSchema.parse({ perPage: 60 });
    const result = await searchProjectsService(user.id, params);
    const rooms = result.ok ? result.data.items : [];

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            <header className="mb-8 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-primary">
                    <Radio className="size-4" />
                    <span className="font-medium text-xs uppercase tracking-widest">
                        Cortex Room
                    </span>
                </div>
                <h1 className="font-semibold text-3xl tracking-tight">
                    Tus reuniones
                </h1>
                <p className="max-w-prose text-muted-foreground text-sm">
                    Cada reunión tiene un canvas colaborativo en vivo. Crea una,
                    invita al agente a tu Google Meet y mira cómo las notas
                    aparecen solas mientras hablan.
                </p>
            </header>

            <form
                action={createRoomAction}
                className="mb-8 flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
            >
                <Input
                    name="name"
                    placeholder="Nombre de la reunión (ej. Kickoff con cliente)"
                    aria-label="Nombre de la reunión"
                    maxLength={200}
                    className="flex-1"
                />
                <Button type="submit" className="gap-2">
                    <Plus className="size-4" />
                    Nueva reunión
                </Button>
            </form>

            {rooms.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/10 px-6 py-16 text-center">
                    <h2 className="font-medium text-lg">
                        Aún no hay reuniones
                    </h2>
                    <p className="mt-1 text-muted-foreground text-sm">
                        Crea tu primera reunión arriba para abrir su canvas.
                    </p>
                </div>
            ) : (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {rooms.map((room) => (
                        <li key={room.id}>
                            <Link
                                href={`/projects/${room.id}/canvas`}
                                className="group flex h-full flex-col justify-between rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                            >
                                <div className="min-w-0">
                                    <h3 className="truncate font-medium text-base">
                                        {room.name}
                                    </h3>
                                    {room.description ? (
                                        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
                                            {room.description}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="mt-6 flex items-center justify-between text-muted-foreground text-xs">
                                    <span>
                                        Creada {formatDate(room.createdAt)}
                                    </span>
                                    <span className="flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                        Abrir canvas
                                        <ArrowRight className="size-3.5" />
                                    </span>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
