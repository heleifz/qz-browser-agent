/** External lifecycle receipt; execution authority and private runtime state are not wire data. */
export interface SessionStopReceipt {
  sessionId: string;
  stopped: boolean;
  status: string;
}

/** Task progress exposed by the MCP producer, without an implicit page target. */
export interface SessionRuntimeObservation {
  status: unknown; running: boolean; pendingStart: boolean; runId: unknown;
  waitId: unknown; waitMessage: unknown; waitTitle: unknown; waitForm: unknown;
  interrupted: boolean; reason: unknown; startedAt: unknown; endedAt: unknown; updatedAt: unknown;
  currentToolName: unknown; currentToolStartedAt: unknown;
  contextUsage: unknown; contextWindow: unknown; inputTokensEstimate: unknown;
  tracker: unknown; goal: unknown;
  pendingSteerings: unknown; pendingSteeringMessages: unknown; pendingFollowUps: unknown; pendingFollowUpMessages: unknown;
}
