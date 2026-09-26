import "server-only";
import type { Completion } from "./engine";
import type { ProcessCode } from "./processes";
import { completeLeave } from "./leave";

/** What approving or rejecting finally does, per process. */
export const COMPLETIONS: Record<ProcessCode, Completion> = {
  leave: completeLeave,
};
