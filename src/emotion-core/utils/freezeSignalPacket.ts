export const freezeSignalPacket = <T extends object>(
  packet: T
): Readonly<T> => Object.freeze(packet);
