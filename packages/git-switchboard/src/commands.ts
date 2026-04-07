/**
 * All CommandTui instances — one per CLI subcommand.
 *
 * Import this in docs/tooling that needs to enumerate commands and their views.
 * Each command's views carry both the keybind metadata and the render function.
 */
import { BRANCH_COMMAND } from './branch-router.js';
import { PR_COMMAND } from './pr-router.js';

/** All commands, in CLI definition order. */
export const ALL_COMMANDS = [BRANCH_COMMAND, PR_COMMAND];
