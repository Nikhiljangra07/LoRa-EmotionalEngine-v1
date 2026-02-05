import { runChatCLI } from "../chat-cli";

describe("chat-cli smoke", () => {
  test("exports runChatCLI", () => {
    expect(typeof runChatCLI).toBe("function");
  });
});
