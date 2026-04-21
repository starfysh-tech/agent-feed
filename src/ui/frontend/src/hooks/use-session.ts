import { useQuery } from "@tanstack/react-query";
import { fetchSession } from "@/api/client";

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId!),
    enabled: !!sessionId,
  });
}
