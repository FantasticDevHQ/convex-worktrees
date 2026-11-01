import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Merge this table into an existing app schema rather than replacing its tables.
export default defineSchema({
  worktreeProbes: defineTable({ value: v.string() }),
});
