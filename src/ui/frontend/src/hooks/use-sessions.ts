import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "@/api/client";

export function useSessions(agent?: string, dateFrom?: string) {
  return useQuery({
    queryKey: ["sessions", agent ?? "", dateFrom ?? ""],
    queryFn: () => fetchSessions({ agent, date: dateFrom }),
  });
}
