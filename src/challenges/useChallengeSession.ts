import { challengeCatalog } from "./challengeCatalog";
import { useRef, useState, useEffect } from "react";
import { parseBoard, serializeBoard, type Board } from "../board/board";
import {
  parseChallenge,
  sameChallenge,
  type ChallengeDefinition,
  type ChallengeReport,
} from "./challenges";
export type ChallengeProgress = {
  submissions: number;
  stars: number;
  bestScore: number;
};
export type ChallengeStatus = {
  running: boolean;
  progress: number;
  error: string;
  baseline: boolean;
};
function readProgress(): Record<string, ChallengeProgress> {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem("liveboard-progress-v1") ?? "{}",
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([id, v]) =>
          /^[a-z0-9-]{1,80}$/.test(id) &&
          v &&
          typeof v === "object" &&
          ["submissions", "stars", "bestScore"].every((key) =>
            Number.isInteger(v[key]),
          ) &&
          v.submissions >= 0 &&
          v.submissions <= 100000 &&
          v.stars >= 0 &&
          v.stars <= 3 &&
          v.bestScore >= 0 &&
          v.bestScore <= 100,
      ),
    );
  } catch {
    return {};
  }
}
export default function useChallengeSession({
  send,
  onLoad,
  onFocus,
  initial,
}: {
  send: (type: string, extra?: Record<string, unknown>) => void;
  onLoad: (board: Board) => void;
  onFocus: () => void;
  initial?: {
    active?: ChallengeDefinition;
    draft?: ChallengeDefinition;
    view: "gallery" | "play" | "author";
  };
}) {
  const [active, setActive] = useState<ChallengeDefinition | undefined>(
    initial?.active,
  );
  const [draft, setDraft] = useState<ChallengeDefinition | undefined>(
    initial?.draft,
  );
  const [view, setView] = useState<"gallery" | "play" | "author">(
    initial?.view ?? "gallery",
  );
  const [report, setReport] = useState<ChallengeReport>();
  const [baseline, setBaseline] = useState<ChallengeReport>();
  const [hints, setHints] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [progress, setProgress] = useState(readProgress);
  useEffect(() => {
    try {
      localStorage.setItem("liveboard-progress-v1", JSON.stringify(progress));
    } catch {
      /* Keep session progress when device storage is full. */
    }
  }, [progress]);
  const [status, setStatus] = useState<ChallengeStatus>({
    running: false,
    progress: 0,
    error: "",
    baseline: false,
  });
  const [trusted] = useState(
    () =>
      new Map<string, ChallengeDefinition>(
        initial?.active ? [[initial.active.id, initial.active]] : [],
      ),
  );
  const pending = useRef<
    | {
        id: string;
        definition: ChallengeDefinition;
        board: Board;
        baseline: boolean;
        author: boolean;
        hints: number;
        attempt: number;
      }
    | undefined
  >(undefined);
  const cancel = () => {
    pending.current = undefined;
    send("cancelChallenge");
    setStatus((current) => ({ ...current, running: false }));
  };
  const verify = (
    definition: ChallengeDefinition,
    board: Board,
    options: { baseline?: boolean; author?: boolean } = {},
  ) => {
    try {
      const challenge = parseChallenge(definition),
        captured = parseBoard(serializeBoard(board)),
        id = crypto.randomUUID();
      send("cancelChallenge");
      if (options.author) trusted.set(challenge.id, challenge);
      const baseline = !!options.baseline,
        author = !!options.author,
        attempt = baseline || author ? attempts : attempts + 1;
      pending.current = {
        id,
        definition: challenge,
        board: captured,
        baseline,
        author,
        hints,
        attempt,
      };
      if (!baseline && !author) setAttempts(attempt);
      setStatus({ running: true, progress: 0, error: "", baseline });
      send("challenge", { id, definition: challenge, board: captured });
    } catch (error) {
      setStatus({
        running: false,
        progress: 0,
        error:
          error instanceof Error ? error.message : "Invalid challenge setup",
        baseline: false,
      });
    }
  };
  const open = (definition: ChallengeDefinition, solution?: Board) => {
    const challenge = parseChallenge(definition);
    cancel();
    trusted.set(challenge.id, challenge);
    setStatus({ running: false, progress: 0, error: "", baseline: false });
    setActive(challenge);
    setReport(undefined);
    setBaseline(undefined);
    setHints(0);
    setAttempts(0);
    setView("play");
    onLoad(parseBoard(serializeBoard(solution ?? challenge.starter)));
    onFocus();
    if (!solution) verify(challenge, challenge.starter, { baseline: true });
  };
  const receive = (data: {
    type: string;
    id?: string;
    progress?: number;
    report?: ChallengeReport;
    error?: string;
  }) => {
    const run = pending.current;
    if (!run || data.id !== run.id) return;
    if (data.type === "challengeProgress") {
      setStatus({
        running: true,
        progress: data.progress ?? 0,
        error: "",
        baseline: run.baseline,
      });
      return;
    }
    if (data.type === "challengeError") {
      pending.current = undefined;
      setStatus({
        running: false,
        progress: 0,
        error: data.error ?? "Challenge verification failed",
        baseline: run.baseline,
      });
      return;
    }
    if (data.type !== "challengeComplete" || !data.report) return;
    const result = data.report;
    pending.current = undefined;
    setStatus({
      running: false,
      progress: 100,
      error: "",
      baseline: run.baseline,
    });
    if (run.baseline) {
      setBaseline(result);
      return;
    }
    setReport(result);
    if (!run.author) {
      setProgress((current) => {
        const old = current[run.definition.id] ?? {
          submissions: 0,
          stars: 0,
          bestScore: 0,
        };
        const stars = result.passed
          ? 1 + Number(run.hints === 0) + Number(run.attempt === 1)
          : 0;
        const next = {
          ...current,
          [run.definition.id]: {
            submissions: old.submissions + 1,
            stars: Math.max(old.stars, stars),
            bestScore: Math.max(old.bestScore, result.score),
          },
        };
        return next;
      });
    }
  };
  const review = (definition: ChallengeDefinition, solution: Board) => {
    const original =
      trusted.get(definition.id) ??
      challengeCatalog.find((c) => c.id === definition.id);
    if (!original)
      throw new Error(
        "Import the original challenge before reviewing this submission.",
      );
    if (!sameChallenge(original, definition))
      throw new Error(
        "The submission changes the challenge definition. Use the original exercise and submit only design changes.",
      );
    open(original, solution);
  };
  const leave = () => {
    cancel();
    setActive(undefined);
    setReport(undefined);
    setBaseline(undefined);
    setView("gallery");
  };
  return {
    active,
    draft,
    setDraft,
    view,
    setView,
    report,
    baseline,
    hints,
    revealHint: () => setHints((value) => value + 1),
    attempts,
    progress,
    status,
    open,
    review,
    verify,
    cancel,
    receive,
    leave,
    pending,
  };
}
