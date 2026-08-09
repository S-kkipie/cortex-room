"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type {
    CanvasMutationResult,
    DeleteElementCommand,
    MoveElementCommand,
    ResizeElementCommand,
    UpdateElementCommand,
} from "@/core/canvas/domain/types";
import { useElysia } from "@/frontend/lib/eden";
import {
    type CanvasActions,
    type CanvasSelectionPort,
    type CanvasSnapshotPort,
    type CanvasTransport,
    createCanvasActions,
} from "./controller/canvas-controller";
import type { CanvasPreviewPort } from "./controller/canvas-preview";
import type { CanvasRealtimePort } from "./portal/canvas-portal-events";
import { retryCanvasPersistence } from "./retry";

type MutationEnvelope = { response: CanvasMutationResult };

type ControllerOptions = {
    projectId: string;
    userId: string;
    selection: CanvasSelectionPort;
    previews?: CanvasPreviewPort;
    realtime?: CanvasRealtimePort;
    enabled?: boolean;
    onError?: (error: unknown) => void;
};

export const useCanvas = () => {
    const client = useElysia().canvas;
    const queryClient = useQueryClient();

    const useSnapshot = (projectId: string) => {
        const procedure = client({ projectId }).elements.get;
        return useQuery(procedure.queryOptions());
    };

    const useController = ({
        projectId,
        userId,
        selection,
        previews,
        realtime,
        enabled = true,
        onError,
    }: ControllerOptions) => {
        const procedure = client({ projectId }).elements;
        const snapshotProcedure = procedure.get;
        const snapshotQuery = useQuery({
            ...snapshotProcedure.queryOptions(),
            enabled,
        });
        const queryKey = snapshotProcedure.queryKey();
        const snapshotEnvelopeRef = useRef(snapshotQuery.data);
        snapshotEnvelopeRef.current = snapshotQuery.data;

        const createMutation = useMutation(procedure.post.mutationOptions());
        const updateMutation = useMutation({
            mutationFn: ({
                elementId,
                command,
            }: {
                elementId: string;
                command:
                    | UpdateElementCommand
                    | MoveElementCommand
                    | ResizeElementCommand;
            }) =>
                client({ projectId })
                    .elements({ elementId })
                    .put.mutationOptions()
                    .mutationFn(command),
        });
        const deleteMutation = useMutation({
            mutationFn: ({
                elementId,
                command,
            }: {
                elementId: string;
                command: DeleteElementCommand;
            }) =>
                client({ projectId })
                    .elements({ elementId })
                    .delete.mutationOptions()
                    .mutationFn(command),
        });

        const state: CanvasSnapshotPort = {
            read: () => snapshotEnvelopeRef.current?.response,
            write: (updater) => {
                queryClient.setQueryData(queryKey, (current) => {
                    if (!current) return current;
                    const next = {
                        ...current,
                        response: updater(current.response),
                    };
                    snapshotEnvelopeRef.current = next;
                    return next;
                });
            },
        };

        const transport: CanvasTransport = {
            create: async (command) =>
                (
                    (await retryCanvasPersistence(() =>
                        createMutation.mutateAsync(command),
                    )) as MutationEnvelope
                ).response,
            update: async (command) =>
                (
                    (await retryCanvasPersistence(() =>
                        updateMutation.mutateAsync({
                            elementId: command.elementId,
                            command,
                        }),
                    )) as MutationEnvelope
                ).response,
            delete: async (command) =>
                (
                    (await retryCanvasPersistence(() =>
                        deleteMutation.mutateAsync({
                            elementId: command.elementId,
                            command,
                        }),
                    )) as MutationEnvelope
                ).response,
        };

        const controllerRef = useRef<{
            projectId: string;
            actions: CanvasActions;
        } | null>(null);

        if (
            controllerRef.current === null ||
            controllerRef.current.projectId !== projectId
        ) {
            controllerRef.current = {
                projectId,
                actions: createCanvasActions({
                    projectId,
                    userId,
                    state,
                    selection,
                    previews,
                    transport,
                    realtime,
                    onError,
                }),
            };
        }

        const actions = controllerRef.current.actions;
        return { snapshotQuery, actions } satisfies {
            snapshotQuery: typeof snapshotQuery;
            actions: CanvasActions;
        };
    };

    return { useSnapshot, useController };
};
