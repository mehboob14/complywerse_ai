// Saves each answer as it is given. A question has one save in flight at a time, so an older answer can never land after a
// newer one; what is given meanwhile waits, and only the latest is sent. Different questions save side by side (the server
// applies them one after the other).

export interface Change { value: string; comment: string }
export type SavePhase = 'saving' | 'saved' | 'failed';

export function createSaver(
  send: (id: string, change: Change) => Promise<void>,
  report: (id: string, phase: SavePhase, error?: unknown) => void,
) {
  const waiting = new Map<string, Change>();
  const flying = new Set<string>();

  const run = async (id: string, change: Change): Promise<void> => {
    flying.add(id);
    report(id, 'saving');
    let failure: { error: unknown } | null = null;
    try {
      await send(id, change);
    } catch (error) {
      failure = { error };
    }
    flying.delete(id);
    const newer = waiting.get(id);
    if (newer) {                                 // given again meanwhile: that is the answer now, however this one went
      waiting.delete(id);
      return run(id, newer);
    }
    if (failure) report(id, 'failed', failure.error);
    else report(id, 'saved');
    return undefined;
  };

  return {
    save(id: string, change: Change) {
      if (flying.has(id)) waiting.set(id, change);
      else void run(id, change);
    },
  };
}
