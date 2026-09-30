import "server-only";
import type { Completion } from "./engine";
import type { ProcessCode } from "./processes";
import { completeLeave } from "./leave";
import { completeCorrection } from "./correction";
import { completeHeadcount } from "./headcount";
import { completeRegularisation } from "./regularisation";

/** What approving or rejecting finally does, per process. */
export const COMPLETIONS: Record<ProcessCode, Completion> = {
  leave: completeLeave,
  correction: completeCorrection,
  headcount: completeHeadcount,
  regularisation: completeRegularisation,
};
