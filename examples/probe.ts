import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Development/test probe only. Do not deploy these unauthenticated functions publicly.
export const write = mutation({
  args: { value: v.string() },
  handler: async (ctx, args) => ctx.db.insert("worktreeProbes", args),
});

export const read = query({
  args: {},
  handler: async (ctx) => ctx.db.query("worktreeProbes").collect(),
});
