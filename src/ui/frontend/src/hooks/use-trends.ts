import { useQuery } from "@tanstack/react-query";
import { fetchTrends } from "@/api/client";

export function useTrends(params: {
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: ["trends", params.agent ?? "", params.dateFrom ?? "", params.dateTo ?? ""],
    queryFn: () => fetchTrends(params),
  });
}
