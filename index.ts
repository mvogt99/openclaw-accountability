import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig } from "./src/config.js";
import { createAfterToolCallHandler } from "./src/hooks/after-tool-call.js";

export default definePluginEntry({
  id: "openclaw-accountability",
  name: "Accountability Verification",
  description:
    "Post-hoc claim verification: checks that files written by the agent exist, parse cleanly, and resolve their local imports.",
  register(api) {
    const config = parseConfig(api.config);
    const handler = createAfterToolCallHandler(config, api.logger);
    api.on("after_tool_call", handler);
  },
});
