import type { SentenceData, SignalPacket } from "../../types/SignalPacket.types";
import { freezeSignalPacket } from "../../utils/freezeSignalPacket";

const buildSentence = (): SentenceData => ({
  text: "Example sentence.",
  position: 0,
  esScore: 0,
  arousalScore: 0,
});

const buildPacket = (): SignalPacket => ({
  messageText: "Example sentence.",
  sentences: [buildSentence()],
  metadata: { traceId: "test" },
});

describe("SignalPacket immutability contract", () => {
  test("SignalPacket is frozen", () => {
    const packet = freezeSignalPacket(buildPacket());
    expect(Object.isFrozen(packet)).toBe(true);
  });

  test("mutation throws or is ignored", () => {
    const packet = freezeSignalPacket(buildPacket());
    const original = packet.messageText;
    let threw = false;
    try {
      (packet as { messageText: string }).messageText = "mutated";
    } catch {
      threw = true;
    }
    expect(threw || packet.messageText === original).toBe(true);
  });

  test("SentenceData fields are readonly by type", () => {
    const sentence = buildSentence();
    // @ts-expect-error readonly contract
    sentence.text = "mutated";
  });

  test("deterministic equality across runs", () => {
    const a = freezeSignalPacket(buildPacket());
    const b = freezeSignalPacket(buildPacket());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
