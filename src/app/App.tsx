"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  Map,
  Activity,
  Trophy,
  ClipboardList,
  PanelRightClose,
  ChevronRight,
  Clock3,
  Expand,
  Layers,
  MousePointer2,
  Network,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  SkipForward,
  X,
} from "lucide-react";
import {
  defaults,
  initialSnapshot,
  type Config,
  type Role,
  type Snapshot,
} from "../simulation/engine";
import TrafficPanel from "../labs/TrafficPanel";
import { ComponentNode, TrafficEdge } from "../board/BoardNodes";
import {
  catalog,
  createNode,
  createEdge,
  scenario,
  canConnect,
  serializeBoard,
  parseBoard,
  executionConfig,
  type Board,
  type Scenario,
} from "../board/board";
import { checkoutScenario } from "../scenarios/checkout";
import { icons } from "../board/visuals";
import { technology } from "../simulation/settings";
import useChallengeSession from "../challenges/useChallengeSession";
import { parseChallenge, parseSubmission } from "../challenges/challenges";
import {
  briefs,
  defaultBrief,
  type InterviewBrief,
} from "../interview/interview";
import type {
  ExperimentSpec,
  ExperimentReport,
} from "../simulation/experiments";
import type {
  RecordedRun,
  ExperimentStatus,
} from "../interview/InterviewPanel";
import useInterviewClock from "../interview/useInterviewClock";
import { ConnectionInspector } from "../inspector/ResilienceControls";
import Inspector from "../inspector/Inspector";
import BoardMenu from "./BoardMenu";
import { boardFilename, parseWorkspace, serializeWorkspace } from "./workspace";
import ExecutionResizeHandle from "../board/ExecutionResizeHandle";
const ChallengePanel = lazy(() => import("../challenges/ChallengePanel"));
const InterviewPanel = lazy(() => import("../interview/InterviewPanel"));
const LabPanel = lazy(() => import("../labs/LabPanel"));
const edgeTypes = { traffic: TrafficEdge };
const nodeTypes = { component: ComponentNode };
function App() {
  const [saved] = useState(() => {
    try {
      const text = localStorage.getItem("liveboard-v1");
      return text ? parseWorkspace(text) : undefined;
    } catch {
      // A damaged local document starts with an empty board.
      return undefined;
    }
  });
  const [empty] = useState(() => scenario("empty"));
  const [nodes, setNodes, onNodesChange] = useNodesState(
    saved?.board.nodes ?? empty.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    saved?.board.edges ?? empty.edges,
  );
  const [config, setConfig] = useState<Config>({
    ...defaults,
    ...saved?.board.config,
  });
  const [brief, setBrief] = useState<InterviewBrief>(
    () => saved?.board.interview ?? structuredClone(defaultBrief),
  );
  const clock = useInterviewClock(brief.minutes);
  const [runs, setRuns] = useState<RecordedRun[]>([]);
  const [experiment, setExperiment] = useState<ExperimentStatus>({
    running: false,
    progress: 0,
    error: "",
  });
  const pendingRun = useRef<{ id: string; board: Board } | undefined>(
    undefined,
  );
  const [title, setTitle] = useState(saved?.board.title ?? empty.title);
  const [state, setState] = useState<Snapshot>(initialSnapshot);
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const [path, setPath] = useState("/users/1");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState("Requests");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [saveError, setSaveError] = useState("");
  const [fileDrop, setFileDrop] = useState(false);
  const dragDepth = useRef(0);
  const importRevision = useRef(0);
  const [help, setHelp] = useState(false);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const [traffic, setTraffic] = useState(1);
  const flow = useRef<ReactFlowInstance | null>(null);
  const worker = useRef<Worker | null>(null);
  const message = (type: string, extra = {}) =>
    worker.current?.postMessage({ type, ...extra });
  const game = useChallengeSession({
    initial: saved,
    send: message,
    onLoad: (board) => loadBoard(board),
    onFocus: () => selectExecutionTab("Challenges"),
  });
  const challengeReceiver = useRef(game.receive);
  useEffect(() => {
    challengeReceiver.current = game.receive;
  }, [game.receive]);
  useEffect(() => {
    const w = new Worker(
      new URL("../simulation/simulation.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.current = w;
    w.onmessage = (e) => {
      const data = e.data;
      if (data.type === "snapshot") {
        setState(data.state);
        return;
      }
      if (data.type.startsWith("challenge")) {
        challengeReceiver.current(data);
        return;
      }
      if (!pendingRun.current || data.id !== pendingRun.current.id) return;
      if (data.type === "experimentProgress")
        setExperiment({ running: true, progress: data.progress, error: "" });
      if (data.type === "experimentComplete") {
        const completed = pendingRun.current;
        setRuns((current) => [
          ...current.slice(-3),
          {
            id: completed.id,
            board: completed.board,
            report: data.report as ExperimentReport,
          },
        ]);
        pendingRun.current = undefined;
        setExperiment({ running: false, progress: 100, error: "" });
      }
      if (data.type === "experimentError") {
        pendingRun.current = undefined;
        setExperiment({ running: false, progress: 0, error: data.error });
      }
    };
    return () => w.terminate();
  }, []);
  useEffect(() => {
    message("configure", {
      config: {
        ...config,
        roles: nodes.map((n) => n.data.role),
        components: nodes.map((n) => ({
          id: n.id,
          role: n.data.role,
          name: String(n.data.name),
        })),
        links: edges.map((e) => `${e.source}-${e.target}`),
      },
    });
  }, [config, nodes, edges]);
  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>(".board-viewport");
    if (!viewport) return;
    let previous = viewport.getBoundingClientRect();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const next = viewport.getBoundingClientRect();
      if (
        Math.abs(next.width - previous.width) < 1 &&
        Math.abs(next.height - previous.height) < 1
      )
        return;
      previous = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (flow.current?.getNodes().length)
          void flow.current.fitView({ padding: 0.16, duration: 120 });
      });
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    if (help) helpDialog.current?.showModal();
    else helpDialog.current?.close();
  }, [help]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const selectedNode = nodes.find((n) => n.id === selection);
  const selectedEdge = edges.find((e) => e.id === selection);
  const fileInput = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<
    "components" | "inspector" | "execution" | null
  >(null);
  const libraryVisible = panel === "components";
  const inspectorVisible = panel === "inspector";
  const executionCollapsed = panel !== "execution";
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [executionHeight, setExecutionHeight] = useState<number | undefined>();
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const selectExecutionTab = (next: string) => {
    setTab(next);
    setPanel("execution");
    setWorkspaceExpanded(["Interview", "Challenges"].includes(next));
  };
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (document.querySelector("dialog[open], #board-menu")) return;
      if (event.key === "Escape") {
        setFileDrop(false);
        dragDepth.current = 0;
        setPanel(null);
        setWorkspaceExpanded(false);
      }
      const target = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target.closest('input,textarea,select,[contenteditable="true"]')
      ) {
        event.preventDefault();
        setPanel("components");

        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>('[aria-label="Search components"]')
            ?.focus(),
        );
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);

  const boardDocument = (): Board => ({
    version: 1,
    nodes,
    edges,
    config,
    title,
    interview: brief,
  });
  const hasClient = nodes.some((n) => n.data.role === "client");
  const executionTab =
    hasClient || ["Interview", "Challenges"].includes(tab)
      ? tab
      : "Technology lab";
  const executionSize = `max(180px, min(${executionHeight ?? (["Traffic", "Technology lab"].includes(executionTab) ? 390 : 320)}px, calc(100dvh - 340px)))`;
  const busy =
    state.active ||
    state.kafka.active > 0 ||
    state.queueLab.inProgress.length > 0;
  const result =
    state.results.find((r) => r.id === requestId) || state.results[0];
  const traceRequest =
    requestId ?? (state.active ? state.events.at(-1)?.request : result?.id);
  const traceResult = state.results.find(
    (request) => request.id === traceRequest,
  );
  const events =
    traceResult?.trace ??
    state.events.filter((event) => event.request === traceRequest);
  const tracePath =
    traceResult?.path ??
    events.find((event) => event.text.startsWith("GET "))?.text.split(" ")[1] ??
    path;
  const runExperiment = (spec: ExperimentSpec) => {
    try {
      const board = parseBoard(serializeBoard(boardDocument()));
      const id = crypto.randomUUID();
      pendingRun.current = { id, board };
      setExperiment({ running: true, progress: 0, error: "" });
      message("experiment", { id, config: executionConfig(board), spec });
    } catch (error) {
      setExperiment({
        running: false,
        progress: 0,
        error:
          error instanceof Error ? error.message : "Invalid experiment setup",
      });
    }
  };
  const cancelExperiment = () => {
    pendingRun.current = undefined;
    message("cancelExperiment");
    setExperiment({ running: false, progress: 0, error: "" });
  };
  const localDocument = useMemo(() => {
    try {
      return {
        text: serializeWorkspace({
          board: { version: 1, nodes, edges, config, title, interview: brief },
          active: game.active,
          draft: game.draft,
          view: game.view,
        }),
        error: "",
      };
    } catch (error) {
      return {
        text: "",
        error:
          error instanceof Error
            ? error.message
            : "Check the board settings before saving.",
      };
    }
  }, [nodes, edges, config, title, brief, game.active, game.draft, game.view]);
  const writeLocal = useCallback(() => {
    try {
      if (!localDocument.text) throw new Error(localDocument.error);
      localStorage.setItem("liveboard-v1", localDocument.text);
      setSaveStatus("Saved");
      setSaveError("");
      return true;
    } catch (error) {
      setSaveStatus("Not saved");
      setSaveError(
        error instanceof Error &&
          error.name !== "QuotaExceededError" &&
          error.name !== "SecurityError"
          ? error.message
          : "Browser storage is unavailable or full. Download a copy.",
      );
      return false;
    }
  }, [localDocument]);
  useEffect(() => {
    if (localDocument.error) {
      setSaveStatus("Not saved");
      setSaveError(localDocument.error);
      return;
    }
    setSaveStatus("Saving…");
    const timer = setTimeout(writeLocal, 500);
    const flush = () => {
      writeLocal();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [localDocument, writeLocal]);
  const save = () => {
    if (writeLocal()) setToast("Workspace saved in this browser");
  };
  const add = (role: Role, position?: { x: number; y: number }) => {
    let id: string = role;
    if (["backend", "consumer", "worker"].includes(role)) {
      const available = Array.from({ length: 8 }, (_, i) =>
        i === 0 ? role : `${role}-${i + 1}`,
      ).find((id) => !nodes.some((n) => n.id === id));
      if (!available) {
        setToast(`This board already has eight ${role} instances.`);
        return;
      }
      id = available;
    } else if (nodes.some((n) => n.id === id)) {
      setSelection(id);
      setPanel("inspector");
      return;
    }
    const node = createNode(role, id, position);
    if (
      !position &&
      ["backend", "consumer", "worker"].includes(role) &&
      id !== role
    ) {
      const existing = nodes.filter((node) => node.data.role === role);
      node.position = {
        x: existing[0]?.position.x ?? node.position.x,
        y: Math.max(...existing.map((node) => node.position.y)) + 210,
      };
    }
    setNodes((ns) => [...ns, node]);
    setSelection(id);
    if (role === "cache")
      setConfig((current) => ({
        ...current,
        cache: { ...current.cache, technology: "redis" },
      }));
  };
  const loadBoard = (board: Board) => {
    setNodes(
      board.nodes.map((node) => ({
        ...node,
        measured: flow.current?.getInternalNode(node.id)?.measured,
      })),
    );
    setEdges(board.edges);
    setPanel(null);
    setWorkspaceExpanded(false);
    setConfig(board.config);
    setPath(board.config.route.replace(/:id\b/g, "1"));
    if (!board.nodes.length) {
      setPanel("components");
    }
    if (board.interview) setBrief(board.interview);
    setTitle(board.title);
    setSelection(
      board.nodes.find((n) => n.data.role === "balancer")?.id ??
        board.nodes[0]?.id ??
        "",
    );
    setRequestId(null);
    message("reset");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void flow.current?.fitView({ padding: 0.15 });
      }),
    );
  };
  const resetBoard = (kind: Scenario) => {
    game.leave();
    loadBoard(scenario(kind));
    const focus: Partial<Record<Scenario, string>> = {
      redis: "cache",
      kafka: "stream",
      queue: "queue",
      database: "database",
      gateway: "balancer",
      resilience: "backend",
    };
    if (focus[kind]) setSelection(focus[kind]!);
    setToast(kind === "empty" ? "New board" : "Template loaded");
  };
  const importBoard = async (file?: File) => {
    if (!file) return;
    const revision = ++importRevision.current;
    if (file.size > 3_000_000) {
      setToast("Import files must be smaller than 3 MB.");
      return;
    }
    try {
      const text = await file.text();
      if (revision !== importRevision.current) return;
      const format = JSON.parse(text)?.format;
      if (format === "liveboard-challenge-v1") {
        game.open(parseChallenge(text));
        setToast(
          "Exercise loaded. Diagnose the starter, then verify your fix.",
        );
        return;
      }
      if (format === "liveboard-submission-v1") {
        const submission = parseSubmission(text);
        game.review(submission.challenge, submission.solution);
        setToast(
          "Submission loaded. Run verification against the original exercise.",
        );
        return;
      }
      const board = parseBoard(text);
      game.leave();
      loadBoard(board);
      setToast("Board opened");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "The board could not be imported.",
      );
    }
  };
  const exportBoard = () => {
    try {
      parseBoard(serializeBoard(boardDocument()));
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Check the board settings before exporting.",
      );
      return;
    }
    const url = URL.createObjectURL(
      new Blob([serializeBoard(boardDocument())], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = boardFilename(title);
    a.click();
    URL.revokeObjectURL(url);
  };
  const renderedNodes: Node[] = nodes.map((n) => ({
    ...n,
    selected: n.id === selection,
    data: {
      ...n.data,
      tech: technology(n.data.role as Role, config),
      state,
      config,
      active: state.active && state.events.at(-1)?.component === n.id,
      requestPath: path,
      targets: edges
        .filter((edge) => edge.source === "balancer")
        .map((edge) => edge.target),
    },
  }));
  const renderedEdges: Edge[] = edges.map((edge) => {
    const traffic = state.transit.filter((message) => message.edge === edge.id);
    const forward = traffic.filter((message) => !message.reverse).length;
    const backward = traffic.length - forward;
    const active = traffic.length > 0;
    return {
      ...edge,
      type: "traffic",
      data: { forward, backward, playing },
      animated: active,
      className: active ? "edge-active" : "",
      style: {
        stroke:
          config.connectionOverrides[edge.id]?.online === false
            ? "#c17664"
            : active
              ? "#2d8b67"
              : "#b6c1bc",
        strokeDasharray:
          config.connectionOverrides[edge.id]?.online === false
            ? "5 4"
            : undefined,
        strokeWidth: active ? 2.5 : 1.5,
      },
    };
  });
  return (
    <div
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setFileDrop(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setFileDrop(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setFileDrop(false);
        if (event.dataTransfer.files.length !== 1) {
          setToast("Drop one board, exercise, or submission file at a time.");
          return;
        }
        void importBoard(event.dataTransfer.files[0]);
      }}
      style={
        {
          "--execution-space":
            !executionCollapsed && !workspaceExpanded ? executionSize : "0px",
        } as CSSProperties
      }
      className={`app-shell board-shell ${playing ? "" : "simulation-paused"} ${!libraryVisible ? "library-hidden" : ""} ${!inspectorVisible ? "inspector-hidden" : ""} ${!executionCollapsed && !workspaceExpanded ? "execution-open" : ""}`}
    >
      <BoardMenu
        title={title}
        saveStatus={saveStatus}
        saveError={saveError}
        onTitle={setTitle}
        onNew={() => resetBoard("empty")}
        onImport={() => fileInput.current?.click()}
        onExport={exportBoard}
        onSave={save}
        onHelp={() => setHelp(true)}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Import board file"
        onChange={(event) => {
          void importBoard(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="main-layout">
        <aside className="library">
          <div className="panel-heading">
            <h2>Components</h2>
            <span className="count">{catalog.length}</span>
            <button
              className="icon-button"
              aria-label="Close component library"
              onClick={() => setPanel(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="search-box">
            <Search size={15} />
            <input
              aria-label="Search components"
              placeholder="Search components…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <div className="library-scroll">
            {[
              "APPLICATION",
              "DATA & STORAGE",
              "MESSAGING",
              "TRAFFIC CONTROL",
            ].map((category) => (
              <section className="catalog-section" key={category}>
                <h3>{category}</h3>
                {catalog
                  .filter(
                    (c) =>
                      c.category === category &&
                      `${c.name} ${c.description} ${c.tech}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((c) => {
                    const Icon = icons[c.role];
                    return (
                      <button
                        className="catalog-item"
                        key={c.role}
                        onClick={() => add(c.role)}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/liveboard",
                            c.role,
                          )
                        }
                      >
                        <span className={`catalog-icon ${c.role}`}>
                          <Icon size={19} strokeWidth={1.6} />
                        </span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>{c.description}</small>
                        </span>
                        <Plus size={14} className="catalog-plus" />
                      </button>
                    );
                  })}
              </section>
            ))}
            <details className="board-templates">
              <summary>Templates</summary>
              <button
                onClick={() => {
                  selectExecutionTab("Challenges");
                  game.setView("gallery");
                }}
              >
                Incident challenges <ArrowUpRight size={15} />
              </button>
              <button onClick={() => resetBoard("cache")}>
                Cache-aside API <ArrowUpRight size={15} />
              </button>
              <button onClick={() => resetBoard("balanced")}>
                Load-balanced API <ArrowUpRight size={15} />
              </button>
              <button
                onClick={() => {
                  game.leave();
                  loadBoard(checkoutScenario());
                  setSelection("backend");
                  setPath("/checkout/1");
                  selectExecutionTab("Requests");
                }}
              >
                Checkout system <ArrowUpRight size={15} />
              </button>
              {(
                [
                  ["redis", "Redis cache"],
                  ["kafka", "Kafka stream"],
                  ["queue", "Message queue"],
                  ["database", "Primary and replica"],
                  ["gateway", "API gateway"],
                  ["resilience", "Dependency resilience"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  onClick={() => {
                    resetBoard(kind);
                    selectExecutionTab(
                      kind === "resilience" ? "Requests" : "Technology lab",
                    );
                  }}
                >
                  {label}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </details>
          </div>
        </aside>
        <main
          className={`center ${!executionCollapsed && workspaceExpanded && ["Interview", "Challenges"].includes(executionTab) ? "workspace-expanded" : ""}`}
        >
          <nav className="canvas-top" aria-label="Board tools">
            <div className="canvas-layout-controls">
              <button
                className={`board-tool ${libraryVisible ? "selected" : ""}`}
                aria-label={
                  libraryVisible ? "Hide component library" : "Add components"
                }
                aria-expanded={libraryVisible}
                onClick={() => {
                  setPanel(libraryVisible ? null : "components");
                }}
                title="Add components"
              >
                <Plus size={17} />
                <span>Add</span>
              </button>
              <button
                className={`board-tool ${inspectorVisible ? "selected" : ""}`}
                aria-label={
                  inspectorVisible ? "Hide inspector" : "Show inspector"
                }
                aria-expanded={inspectorVisible}
                onClick={() => {
                  setPanel(inspectorVisible ? null : "inspector");
                }}
                title="Inspector"
              >
                <PanelRightClose size={17} />
                <span>Inspect</span>
              </button>
              <button
                className={`board-tool ${!executionCollapsed && !["Interview", "Challenges"].includes(tab) ? "selected" : ""}`}
                aria-label={
                  executionCollapsed ||
                  ["Interview", "Challenges"].includes(tab)
                    ? "Show execution panel"
                    : "Hide execution panel"
                }
                aria-expanded={
                  !executionCollapsed &&
                  !["Interview", "Challenges"].includes(tab)
                }
                onClick={() => {
                  if (
                    !executionCollapsed &&
                    !["Interview", "Challenges"].includes(tab)
                  )
                    setPanel(null);
                  else
                    selectExecutionTab(
                      hasClient ? "Requests" : "Technology lab",
                    );
                }}
                title="Requests, traces, and traffic"
              >
                <Activity size={17} />
                <span>Run</span>
                {busy && <i className="tool-running-dot" />}
              </button>
              <span className="tool-divider" />
              <button
                className={`board-tool ${!executionCollapsed && tab === "Challenges" ? "selected" : ""}`}
                onClick={() =>
                  !executionCollapsed && tab === "Challenges"
                    ? setPanel(null)
                    : selectExecutionTab("Challenges")
                }
                title="Incident challenges"
              >
                <Trophy size={16} />
                <span>Challenges</span>
              </button>
              <button
                className={`board-tool ${!executionCollapsed && tab === "Interview" ? "selected" : ""}`}
                onClick={() =>
                  !executionCollapsed && tab === "Interview"
                    ? setPanel(null)
                    : selectExecutionTab("Interview")
                }
                title="Interview workspace"
              >
                <ClipboardList size={16} />
                <span>Interview</span>
              </button>
              <span className="tool-divider" />
              <button
                className="icon-button"
                aria-label={minimapVisible ? "Hide minimap" : "Show minimap"}
                aria-pressed={minimapVisible}
                title="Toggle minimap"
                onClick={() => setMinimapVisible((value) => !value)}
              >
                <Map size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Fit board"
                title="Fit board"
                onClick={() => flow.current?.fitView({ padding: 0.12 })}
              >
                <Expand size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Hide all panels"
                title="Hide all panels"
                onClick={() => {
                  setPanel(null);
                  setWorkspaceExpanded(false);
                  setMinimapVisible(false);
                }}
              >
                <PanelLeftClose size={17} />
              </button>
            </div>
          </nav>
          <div
            className="canvas"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const role = e.dataTransfer.getData(
                "application/liveboard",
              ) as Role;
              if (catalog.some((c) => c.role === role))
                add(
                  role,
                  flow.current?.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                );
            }}
          >
            <div className="board-viewport">
              <ReactFlow
                nodes={renderedNodes}
                edges={renderedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={(instance) => {
                  flow.current = instance;
                }}
                fitView={Boolean(saved?.board.nodes.length)}
                onNodeClick={(_, node) => {
                  setSelection(node.id);
                  setPanel("inspector");
                }}
                onEdgeClick={(_, edge) => {
                  setSelection(edge.id);
                  setPanel("inspector");
                }}
                onConnect={(connection) => {
                  const source = nodes.find((n) => n.id === connection.source);
                  const target = nodes.find((n) => n.id === connection.target);
                  if (source && target && canConnect(source, target))
                    setEdges((edges) =>
                      addEdge(createEdge(source.id, target.id), edges),
                    );
                  else setToast("These component ports cannot connect.");
                }}
                minZoom={0.15}
                maxZoom={1.5}
                defaultEdgeOptions={{ type: "traffic" }}
              >
                <Background color="#d8ded9" gap={20} size={1} />
                <Controls showInteractive={false} />
                {minimapVisible && (
                  <MiniMap
                    nodeColor={(n) =>
                      ({
                        client: "#b3c2de",
                        backend: "#bdb5d6",
                        cache: "#98c9af",
                        database: "#dfc794",
                        balancer: "#a8c6d4",
                      })[String(n.data.role)] || "#ccc"
                    }
                    maskColor="rgba(248,249,247,.7)"
                  />
                )}
              </ReactFlow>
            </div>
            {!nodes.length && !panel && (
              <div className="empty-board">
                <Layers size={32} />
                <h2>Untitled system</h2>
                <p>Add components, or drop a board or exercise file.</p>
                <button
                  className="save-button"
                  onClick={() => setPanel("components")}
                >
                  <Plus size={14} /> Add components <kbd>/</kbd>
                </button>
              </div>
            )}
            <div className="canvas-bottom">
              <span>
                <MousePointer2 size={12} /> Drag to move · Scroll to zoom
              </span>
              <div>
                <span className="legend-request" /> Request{" "}
                <span className="legend-response" /> Response
              </div>
            </div>
          </div>
          <section
            style={!workspaceExpanded ? { height: executionSize } : undefined}
            className={`execution ${executionCollapsed ? "execution-collapsed" : ""} ${["Interview", "Challenges"].includes(executionTab) ? "interview-expanded" : ["Traffic", "Technology lab"].includes(executionTab) ? "expanded" : ""}`}
          >
            {!executionCollapsed && !workspaceExpanded && (
              <ExecutionResizeHandle
                height={
                  executionHeight ??
                  (["Traffic", "Technology lab"].includes(executionTab)
                    ? 390
                    : 320)
                }
                onResize={setExecutionHeight}
              />
            )}
            <div className="execution-heading">
              <div>
                <span className={`live-indicator ${busy ? "busy" : ""}`} />
                <button
                  className="execution-toggle"
                  aria-label={
                    executionCollapsed
                      ? "Show execution panel"
                      : "Hide execution panel"
                  }
                  aria-expanded={!executionCollapsed}
                  onClick={() => {
                    setPanel(executionCollapsed ? "execution" : null);
                    if (!executionCollapsed) setWorkspaceExpanded(false);
                  }}
                >
                  {executionCollapsed ? (
                    <ChevronUp size={15} />
                  ) : (
                    <ChevronDown size={15} />
                  )}
                  <h2>
                    {["Interview", "Challenges"].includes(executionTab)
                      ? executionTab
                      : "Execution"}
                  </h2>
                </button>
                <span className="execution-status">
                  {busy ? "Running" : "Idle"}
                </span>
              </div>
              <div className="playback">
                {["Interview", "Challenges"].includes(executionTab) && (
                  <button
                    className="plain-button"
                    aria-label={
                      workspaceExpanded ? "Show board" : "Expand workspace"
                    }
                    onClick={() => setWorkspaceExpanded((value) => !value)}
                  >
                    <Expand size={13} />
                    {workspaceExpanded ? "Show board" : "Expand"}
                  </button>
                )}

                <span className="sim-clock">
                  <Clock3 size={12} />
                  {(state.now / 1000).toFixed(1)}s <small>simulated</small>
                </span>
                <button
                  aria-label={playing ? "Pause simulation" : "Play simulation"}
                  className="icon-button"
                  onClick={() => {
                    setPlaying(!playing);
                    message("play", { value: +!playing });
                  }}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  aria-label="Step simulation"
                  className="icon-button"
                  onClick={() => {
                    setPlaying(false);
                    message("play", { value: 0 });
                    message("step");
                  }}
                >
                  <SkipForward size={15} />
                </button>
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => {
                    setSpeed(+e.target.value);
                    message("speed", { value: +e.target.value });
                  }}
                >
                  <option value="0.5">0.5×</option>
                  <option value="1">1×</option>
                  <option value="2">2×</option>
                  <option value="4">4×</option>
                </select>
                <span className="control-divider" />
                <button
                  aria-label="Reset execution"
                  className="icon-button"
                  onClick={() => {
                    message("reset");
                    setRequestId(null);
                  }}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Close workspace panel"
                  title="Close panel"
                  onClick={() => setPanel(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            {!["Interview", "Challenges"].includes(executionTab) &&
              !hasClient &&
              nodes.some((node) => node.data.role === "producer") && (
                <div className="message-bar">
                  <span>Send an event to connected streams and queues</span>
                  <button onClick={() => message("produce", { count: 1 })}>
                    Produce 1
                  </button>
                  <button onClick={() => message("produce", { count: 10 })}>
                    Produce 10
                  </button>
                  <button
                    onClick={() => {
                      setSelection("producer");
                      setPanel("inspector");
                    }}
                  >
                    Producer settings
                  </button>
                </div>
              )}
            {!["Interview", "Challenges"].includes(executionTab) && (
              <div className="execution-tabs">
                {[
                  "Requests",
                  "Event log",
                  "Response",
                  "Traffic",
                  "Technology lab",
                ]
                  .filter(
                    (t) =>
                      hasClient ||
                      ["Technology lab", "Interview", "Challenges"].includes(t),
                  )
                  .map((t) => (
                    <button
                      key={t}
                      className={executionTab === t ? "active" : ""}
                      onClick={() => selectExecutionTab(t)}
                    >
                      {t === "Technology lab" ? "System state" : t}
                      {t === "Requests" && (
                        <span>{state.metrics.completed}</span>
                      )}
                      {t === "Traffic" && state.traffic.running && (
                        <span className="traffic-running-dot" />
                      )}
                    </button>
                  ))}
                {hasClient &&
                  !["Interview", "Challenges"].includes(executionTab) && (
                    <span className="request-stats">
                      {state.queue > 0 && <b>{state.queue} queued · </b>}
                      {state.reads} database reads <span>·</span>{" "}
                      {state.hits + state.misses
                        ? Math.round(
                            (state.hits / (state.hits + state.misses)) * 100,
                          )
                        : 0}
                      % cache hit rate
                    </span>
                  )}
              </div>
            )}
            <div className="execution-body">
              {executionTab === "Challenges" && (
                <Suspense
                  fallback={
                    <p className="lab-empty">Loading incident challenges…</p>
                  }
                >
                  <ChallengePanel
                    board={boardDocument()}
                    active={game.active}
                    draft={game.draft}
                    onDraft={game.setDraft}
                    view={game.view}
                    onView={game.setView}
                    report={game.report}
                    baseline={game.baseline}
                    status={game.status}
                    progress={game.progress}
                    hints={game.hints}
                    onHint={game.revealHint}
                    attempts={game.attempts}
                    onOpen={game.open}
                    onVerify={game.verify}
                    onCancel={game.cancel}
                    onToast={setToast}
                  />
                </Suspense>
              )}
              {executionTab === "Interview" && (
                <Suspense
                  fallback={
                    <p className="lab-empty">Loading interview workspace…</p>
                  }
                >
                  <InterviewPanel
                    brief={brief}
                    onBrief={setBrief}
                    clock={clock}
                    status={experiment}
                    runs={runs}
                    path={path}
                    currentConfig={executionConfig(boardDocument())}
                    onRun={runExperiment}
                    onCancel={cancelExperiment}
                    onLoadBrief={(id) => {
                      const item = briefs.find((b) => b.id === id);
                      if (!item) return;
                      loadBoard(scenario(item.scenario));
                      setBrief({
                        ...structuredClone(defaultBrief),
                        prompt: item.prompt,
                        requirements: item.requirements,
                      });
                      clock.reset(defaultBrief.minutes);
                      selectExecutionTab("Interview");
                    }}
                  />
                </Suspense>
              )}

              {executionTab === "Technology lab" && (
                <Suspense
                  fallback={<p className="lab-empty">Loading system state…</p>}
                >
                  <LabPanel
                    key={title}
                    config={config}
                    state={state}
                    nodes={nodes}
                    onMessage={message}
                    onSelect={(id) => {
                      setSelection(id);
                      setPanel("inspector");
                    }}
                  />
                </Suspense>
              )}
              {executionTab === "Traffic" && (
                <TrafficPanel
                  state={state}
                  path={path}
                  dependencies={edges
                    .filter(
                      (edge) =>
                        nodes.some(
                          (node) =>
                            node.id === edge.source &&
                            node.data.role === "backend",
                        ) &&
                        nodes.some(
                          (node) =>
                            node.id === edge.target &&
                            node.data.role === "backend",
                        ),
                    )
                    .map((edge) => edge.target)}
                  paused={!playing}
                  onTraffic={(rate, requestPath, running) =>
                    message("traffic", {
                      value: rate,
                      path: requestPath,
                      running,
                    })
                  }
                  onConfigure={() =>
                    setSelection(
                      nodes.find((n) => n.data.role === "balancer")?.id ??
                        nodes.find((n) => n.data.role === "backend")?.id ??
                        "backend",
                    )
                  }
                />
              )}
              {executionTab === "Requests" && (
                <>
                  {!state.results.length ? (
                    <div className="execution-empty">
                      <span className="empty-send">
                        <Send size={21} />
                      </span>
                      <div>
                        <strong>No requests yet.</strong>
                        <p>Send a request to inspect its response and trace.</p>
                      </div>
                      <ArrowUpRight size={18} />
                    </div>
                  ) : (
                    <>
                      <div className="request-table-head">
                        <span>REQUEST</span>
                        <span>STATUS</span>
                        <span>SOURCE</span>
                        <span>SIMULATED TIME</span>
                      </div>
                      <div className="request-rows">
                        {state.results.map((r) => (
                          <button
                            key={r.id}
                            className={`request-row ${requestId === r.id ? "chosen" : ""}`}
                            onClick={() => {
                              setRequestId(r.id);
                              selectExecutionTab("Event log");
                            }}
                          >
                            <span>
                              <small>#{String(r.id).padStart(3, "0")}</small>
                              <b>GET</b> {r.path}
                              <small title={r.backendId}>{r.backendName}</small>
                            </span>
                            <span
                              className={
                                r.status === 200 ? "success-text" : "error-text"
                              }
                            >
                              {r.status} {r.status === 200 ? "OK" : "Error"}
                            </span>
                            <span>{r.source}</span>
                            <span>
                              <span
                                title={`${r.wait} ms waiting in backend queue`}
                              >
                                {r.duration} ms
                                {r.wait > 0 && (
                                  <small> · {r.wait} queued</small>
                                )}
                              </span>{" "}
                              <ChevronRight size={12} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {executionTab === "Event log" && (
                <div className="event-log">
                  {events.length > 0 && (
                    <div className="trace-summary">
                      <span>Request #{events[0].request}</span>
                      <code>GET {tracePath}</code>
                      <span>
                        {traceResult?.backendName
                          ? `Handled by ${traceResult.backendName}`
                          : "Request body: empty"}
                      </span>
                    </div>
                  )}
                  {!events.length && (
                    <p className="muted">
                      Send a request to inspect each decision.
                    </p>
                  )}
                  {events.map((e) => (
                    <div key={e.id} className={`event ${e.kind}`}>
                      <time>{(e.time / 1000).toFixed(2)}s</time>
                      <span className="event-dot" />
                      <b>{e.component}</b>
                      <span>{e.text}</span>
                      <small>#{e.request}</small>
                    </div>
                  ))}
                </div>
              )}
              {executionTab === "Response" && (
                <div className="response-view">
                  {result ? (
                    <>
                      <span
                        className={
                          result.status === 200 ? "success-text" : "error-text"
                        }
                      >
                        {result.status} {result.status === 200 ? "OK" : "Error"}{" "}
                        · Request #{result.id} · {result.source}
                      </span>
                      <pre>{JSON.stringify(result.body, null, 2)}</pre>
                    </>
                  ) : (
                    <p className="muted">
                      The response will appear here after a request completes.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
        <div className="inspector-surface">
          <button
            className="icon-button panel-dismiss"
            aria-label="Close inspector"
            onClick={() => setPanel(null)}
          >
            <X size={16} />
          </button>
          {selectedEdge ? (
            <ConnectionInspector
              id={selectedEdge.id}
              source={selectedEdge.source}
              target={selectedEdge.target}
              config={config}
              onConfig={setConfig}
              onRemove={() => {
                setEdges((current) =>
                  current.filter((edge) => edge.id !== selectedEdge.id),
                );
                setSelection("");
              }}
            />
          ) : (
            <Inspector
              node={selectedNode}
              nodes={nodes}
              edges={edges}
              config={config}
              state={state}
              path={path}
              onPath={setPath}
              onConfig={setConfig}
              onSelect={setSelection}
              onRename={(name) =>
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === selection
                      ? { ...n, data: { ...n.data, name } }
                      : n,
                  ),
                )
              }
              onRemove={() => {
                setConfig((current) => {
                  const backendOverrides = { ...current.backendOverrides };
                  delete backendOverrides[selection];
                  const resilienceOverrides = {
                      ...current.resilienceOverrides,
                    },
                    connectionOverrides = { ...current.connectionOverrides };
                  delete resilienceOverrides[selection];
                  delete connectionOverrides[`${selection}-database`];
                  const serviceOverrides = { ...current.serviceOverrides };
                  delete serviceOverrides[selection];
                  const consumerOverrides = { ...current.consumerOverrides },
                    workerOverrides = { ...current.workerOverrides };
                  delete consumerOverrides[selection];
                  delete workerOverrides[selection];
                  return {
                    ...current,
                    backendOverrides,
                    consumerOverrides,
                    workerOverrides,
                    resilienceOverrides,
                    connectionOverrides,
                    serviceOverrides,
                  };
                });
                setNodes((ns) => ns.filter((n) => n.id !== selection));
                setEdges((es) =>
                  es.filter(
                    (e) => e.source !== selection && e.target !== selection,
                  ),
                );
              }}
              onMessage={message}
            />
          )}
        </div>
      </div>
      {nodes.length > 0 && !(panel === "execution" && workspaceExpanded) && (
        <div className="board-runbar" aria-label="Quick simulation controls">
          <button
            className="icon-button"
            aria-label={playing ? "Pause simulation" : "Play simulation"}
            title={playing ? "Pause simulation" : "Play simulation"}
            onClick={() => {
              setPlaying(!playing);
              message("play", { value: +!playing });
            }}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Step simulation"
            title="Step simulation"
            onClick={() => {
              setPlaying(false);
              message("play", { value: 0 });
              message("step");
            }}
          >
            <SkipForward size={16} />
          </button>
          <span className="quick-clock">{(state.now / 1000).toFixed(1)}s</span>
          <span className="tool-divider" />
          {hasClient ? (
            <>
              <code>GET</code>
              <input
                aria-label="Quick request path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    message("send", { path, count: traffic });
                    setRequestId(null);
                  }
                }}
              />
              <select
                aria-label="Quick request count"
                title="Requests per send"
                value={traffic}
                onChange={(event) => setTraffic(Number(event.target.value))}
              >
                <option value={1}>1×</option>
                <option value={10}>10×</option>
                <option value={50}>50×</option>
              </select>
              <button
                className="send-button"
                onClick={() => {
                  message("send", { path, count: traffic });
                  setRequestId(null);
                }}
              >
                <Play size={13} fill="currentColor" />
                Send request
              </button>
            </>
          ) : nodes.some((node) => node.data.role === "producer") ? (
            <button
              className="send-button"
              onClick={() => message("produce", { count: 1 })}
            >
              <Send size={14} />
              Produce event
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => setPanel("components")}
            >
              <Plus size={14} />
              Add components
            </button>
          )}
          {hasClient && (
            <button
              className="quick-results"
              onClick={() => selectExecutionTab("Requests")}
              title="Open request results"
            >
              {state.metrics.completed}{" "}
              {state.metrics.completed === 1 ? "result" : "results"}
              <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
      {fileDrop && (
        <div className="file-drop-overlay" role="status">
          <Download size={32} />
          <strong>Drop to open</strong>
          <span>Board, exercise, or submission · JSON</span>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        ref={helpDialog}
        className="help-modal"
        aria-label="Board controls"
        onCancel={() => setHelp(false)}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close help"
          onClick={() => setHelp(false)}
        >
          <X size={18} />
        </button>
        <span className="brand-icon">
          <Network size={23} />
        </span>
        <h2>Board controls</h2>
        <ul>
          <li>
            Press / to search components. Drag a component onto the board or
            click to add it.
          </li>
          <li>
            Connect ports to route requests and messages. Select a component or
            connection to configure it.
          </li>
          <li>
            Use Run to send requests, inspect responses, generate traffic, and
            inspect system state.
          </li>
          <li>
            Pause or step execution to inspect a decision. Orange arrows show
            requests. Blue arrows show responses.
          </li>
          <li>Press Escape to hide panels. Toggle Map to show the minimap.</li>
          <li>
            Changes save in this browser. Use the Board menu to download a copy
            or open a file. Drop a board, exercise, or submission file anywhere
            on the workspace.
          </li>
        </ul>
        <button className="save-button" onClick={() => setHelp(false)}>
          Close <ArrowRight size={14} />
        </button>
      </dialog>
    </div>
  );
}
export default App;
