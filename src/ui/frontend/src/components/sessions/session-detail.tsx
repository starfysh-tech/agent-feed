interface SessionDetailProps { sessionId: string; }
export function SessionDetail({ sessionId }: SessionDetailProps) {
  return <div className="text-sm text-muted-foreground">Session: {sessionId} (implementing next)</div>;
}
