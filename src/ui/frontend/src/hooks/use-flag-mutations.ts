import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateFlag, bulkUpdateFlags } from "@/api/client";
import type { ReviewStatus } from "@/api/types";
import { toast } from "sonner";

export function useUpdateFlagStatus(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, status }: { flagId: string; status: ReviewStatus }) =>
      updateFlag(flagId, { review_status: status }),
    onSuccess: () => {
      toast.success("Flag updated");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to update flag: ${err.message}`);
    },
  });
}

export function useSaveNotes(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      flagId,
      reviewerNote,
      outcome,
    }: {
      flagId: string;
      reviewerNote: string | null;
      outcome: string | null;
    }) => updateFlag(flagId, { reviewer_note: reviewerNote, outcome }),
    onSuccess: () => {
      toast.success("Notes saved");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to save notes: ${err.message}`);
    },
  });
}

export function useBulkUpdate(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagIds, status }: { flagIds: string[]; status: ReviewStatus }) =>
      bulkUpdateFlags(flagIds, status),
    onSuccess: (_data, variables) => {
      toast.success(`${variables.flagIds.length} flags updated`);
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: Error) => {
      toast.error(`Bulk action failed: ${err.message}`);
    },
  });
}
