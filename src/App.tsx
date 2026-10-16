import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Expand,
  FilePlus2,
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
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  defaults,
  initialSnapshot,
  type Config,
  type Role,
  type Snapshot,
} from "./engine";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import TrafficPanel from "./TrafficPanel";
import { AutoFit, ComponentNode, TrafficEdge } from "./BoardNodes";
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
} from "./board";
import { icons } from "./visuals";
import { technology } from "./settings";
const InterviewPanel = lazy(() => import("./InterviewPanel"));
const LabPanel = lazy(() => import("./LabPanel"));
import { briefs, defaultBrief, type InterviewBrief } from "./interview";
import type { ExperimentSpec, ExperimentReport } from "./experiments";
import type { RecordedRun, ExperimentStatus } from "./InterviewPanel";
import useInterviewClock from "./useInterviewClock";
import { ConnectionInspector } from "./ResilienceControls";
import Inspector from "./Inspector";
const edgeTypes = { traffic: TrafficEdge };
const nodeTypes = { component: ComponentNode };
function boardPrompt(nodes: Node[], config: Config): [string, string] {
  if (Object.keys(config.connectionOverrides).length)
    return [
      "DEPENDENCY RESILIENCE",
      "Can retries recover a failure without exhausting the request budget?",
    ];
  if (nodes.some((n) => n.data.role === "stream"))
    return [
      "KAFKA EVENT STREAM",
      "What happens when a consumer stops before committing?",
    ];
  if (nodes.some((n) => n.data.role === "queue"))
    return [
      "MESSAGE DELIVERY",
      "What happens when a worker fails before acknowledgment?",
    ];
  if (nodes.some((n) => n.data.role === "balancer"))
    return config.gateway.technology === "api-gateway"
      ? ["API GATEWAY", "How much traffic can the token bucket admit?"]
      : ["LOAD BALANCING", "What happens when one backend goes offline?"];
  if (
    nodes.some((n) => n.data.role === "database") &&
    !nodes.some((n) => n.data.role === "cache")
  )
    return [
      "DATABASE CONSISTENCY",
      "When does a replica show a committed write?",
    ];
  return [
    "CACHE-ASIDE PATTERN",
    "What happens when the same request arrives twice?",
  ];
}
function App() {
  const [saved] = useState(() => {
    try {
      const text = localStorage.getItem("liveboard-v1");
      return text ? parseBoard(text) : undefined;
    } catch {
      // A damaged local document starts with the example board.
      return undefined;
    }
  });
  const [example] = useState(() => scenario("cache"));
  const [nodes, setNodes, onNodesChange] = useNodesState(
    saved?.nodes || example.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    saved?.edges || example.edges,
  );
  const [config, setConfig] = useState<Config>({
    ...defaults,
    ...saved?.config,
  });
  const [brief, setBrief] = useState<InterviewBrief>(
    () => saved?.interview ?? structuredClone(defaultBrief),
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
  const [title, setTitle] = useState(saved?.title || "User profile API");
  const [state, setState] = useState<Snapshot>(initialSnapshot);
  const [selection, setSelection] = useState("cache");
  const [search, setSearch] = useState("");
  const [path, setPath] = useState("/users/1");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState("Requests");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const [traffic, setTraffic] = useState(1);
  const flow = useRef<ReactFlowInstance | null>(null);
  const worker = useRef<Worker | null>(null);
  const message = (type: string, extra = {}) =>
    worker.current?.postMessage({ type, ...extra });
  useEffect(() => {
    const w = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      const data = e.data;
      if (data.type === "snapshot") {
        setState(data.state);
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
    const canvas = document.querySelector(".canvas");
    if (!canvas) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          void flow.current?.fitView({ padding: 0.16 });
        });
      });
    });
    observer.observe(canvas);
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
  const [focused, setFocused] = useState(false);
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
    hasClient || tab === "Interview" ? tab : "Technology lab";
  const busy =
    state.active ||
    state.kafka.active > 0 ||
    state.queueLab.inProgress.length > 0;
  const prompt = boardPrompt(nodes, config);
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
  const save = () => {
    try {
      const text = serializeBoard(boardDocument());
      parseBoard(text);
      localStorage.setItem("liveboard-v1", text);
      setToast("Board saved on this device");
    } catch (error) {
      setToast(
        error instanceof Error && error.name !== "QuotaExceededError"
          ? error.message
          : "Storage is full. Export your board instead.",
      );
    }
  };
  const add = (role: Role) => {
    let id: string = role;
    if (["backend", "consumer", "worker"].includes(role)) {
      const available = [role, `${role}-2`, `${role}-3`, `${role}-4`].find(
        (id) => !nodes.some((n) => n.id === id),
      );
      if (!available) {
        setToast(`This board already has four ${role} instances.`);
        return;
      }
      id = available;
    } else if (nodes.some((n) => n.id === id)) {
      setSelection(id);
      return;
    }
    const node = createNode(role, id);
    if (["backend", "consumer", "worker"].includes(role) && id !== role) {
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
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void flow.current?.fitView({ padding: 0.15 });
      }),
    );
  };
  const loadBoard = (board: Board) => {
    setNodes(
      board.nodes.map((node) => ({
        ...node,
        measured: flow.current?.getInternalNode(node.id)?.measured,
      })),
    );
    setEdges(board.edges);
    setConfig(board.config);
    if (board.interview) setBrief(board.interview);
    setTitle(board.title);
    setSelection(
      board.nodes.find((n) => n.data.role === "balancer")?.id ??
        board.nodes[0]?.id ??
        "cache",
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
    setToast(
      kind === "empty"
        ? "Empty board ready. Add components from the library."
        : "Scenario loaded. Send a request to begin.",
    );
  };
  const importBoard = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setToast("Board files must be smaller than 1 MB.");
      return;
    }
    try {
      const board = parseBoard(await file.text());
      loadBoard(board);
      setToast("Board imported. Save to keep it on this device.");
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
    a.download = "liveboard.json";
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
      className={`app-shell ${playing ? "" : "simulation-paused"} ${focused ? "focus-mode" : ""}`}
    >
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Network size={22} />
          </span>
          liveboard<span className="beta">BETA</span>
        </a>
        <div className="top-divider" />
        <div className="workspace">
          Personal workspace <ChevronDown size={13} />
        </div>
        <div className="header-right">
          <span className="local-label">
            <span className="status-dot" /> Local workspace
          </span>
          <button
            className="icon-button"
            aria-label="Help"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <span className="avatar">JD</span>
        </div>
      </header>
      <div className="projectbar">
        <div className="project-title">
          <span className="board-icon">
            <Layers size={19} />
          </span>
          <input
            aria-label="Board name"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="project-badge">Sandbox</span>
        </div>
        <div className="project-actions">
          <button
            className={`plain-button ${tab === "Interview" ? "interview-selected" : ""}`}
            onClick={() =>
              setTab(tab === "Interview" ? "Requests" : "Interview")
            }
          >
            Interview workspace
          </button>
          <button className="plain-button" onClick={() => resetBoard("empty")}>
            <FilePlus2 size={15} /> New board
          </button>
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
          <button
            className="plain-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} /> Import
          </button>
          <button className="plain-button" onClick={exportBoard}>
            <Download size={15} /> Export
          </button>
          <button className="save-button" onClick={save}>
            <CheckCheck size={15} /> Save board
          </button>
        </div>
      </div>
      <div className="main-layout">
        <aside className="library">
          <div className="panel-heading">
            <h2>Components</h2>
            <span className="count">{catalog.length}</span>
          </div>
          <p className="muted library-intro">
            The building blocks of your system.
          </p>
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
                        e.dataTransfer.setData("application/liveboard", c.role)
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
          <div className="library-foot">
            <div className="coming">
              <Box size={16} />
              <span>More building blocks ahead</span>
            </div>
            <p>
              Build with up to four backend instances.
              <br />
              Route traffic. Compare. Break things.
            </p>
          </div>
          <div className="scenario-card">
            <span className="scenario-eyebrow">
              <Zap size={13} /> START WITH A SCENARIO
            </span>
            <strong>A little cache. A big difference.</strong>
            <p>
              Explore hits, misses, and what happens when the database goes
              down.
            </p>
            <button onClick={() => resetBoard("cache")}>
              Load cache-aside example <ArrowUpRight size={15} />
            </button>
            <button onClick={() => resetBoard("balanced")}>
              Load balanced system <ArrowUpRight size={15} />
            </button>
            {(
              [
                ["redis", "Redis memory lab"],
                ["kafka", "Kafka replay lab"],
                ["queue", "Queue delivery lab"],
                ["database", "Database consistency lab"],
                ["gateway", "API gateway lab"],
                ["resilience", "Dependency resilience lab"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                onClick={() => {
                  resetBoard(kind);
                  setTab(kind === "resilience" ? "Requests" : "Technology lab");
                }}
              >
                {label}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </aside>
        <main className="center">
          <div className="canvas-top">
            <div className="canvas-tabs">
              <span className="active">
                <Network size={14} /> Architecture
              </span>
              <span className="canvas-caption">
                Build it. Run it. Understand it.
              </span>
            </div>
            <button
              className="plain-button focus-button"
              onClick={() => setFocused(!focused)}
            >
              <Expand size={13} />
              {focused ? "Show panels" : "Focus canvas"}
            </button>
            <button
              className="icon-button"
              title="Fit board"
              onClick={() => flow.current?.fitView({ padding: 0.16 })}
            >
              <Expand size={15} />
            </button>
          </div>
          <div
            className="canvas"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const role = e.dataTransfer.getData(
                "application/liveboard",
              ) as Role;
              if (catalog.some((c) => c.role === role)) add(role);
            }}
          >
            <div className="canvas-info">
              <span className="scenario-label">
                <span className="tiny-dot" />
                {prompt[0]}
              </span>
              <h1>Good systems start with a question.</h1>
              <p>{prompt[1]}</p>
            </div>
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(instance) => {
                flow.current = instance;
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    void instance.fitView({ padding: 0.16 });
                  }),
                );
              }}
              onNodeClick={(_, node) => setSelection(node.id)}
              onEdgeClick={(_, edge) => setSelection(edge.id)}
              onConnect={(connection) => {
                const source = nodes.find((n) => n.id === connection.source);
                const target = nodes.find((n) => n.id === connection.target);
                if (source && target && canConnect(source, target))
                  setEdges((edges) =>
                    addEdge(createEdge(source.id, target.id), edges),
                  );
                else
                  setToast(
                    "Connect a client to a backend or balancer. Backends connect to cache and database.",
                  );
              }}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              minZoom={0.35}
              maxZoom={1.5}
              defaultEdgeOptions={{ type: "traffic" }}
            >
              <AutoFit structureKey={nodes.map((node) => node.id).join(",")} />
              <Background color="#d8ded9" gap={20} size={1} />
              <Controls showInteractive={false} />
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
            </ReactFlow>
            {!nodes.length && (
              <div className="empty-board">
                <Layers size={32} />
                <h2>Your next system starts here.</h2>
                <p>
                  Add a client, backend, cache, and database.
                  <br />
                  Drag between the ports to connect them.
                </p>
                <button
                  className="save-button"
                  onClick={() => resetBoard("cache")}
                >
                  Or load the example <ArrowRight size={14} />
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
            className={`execution ${executionTab === "Interview" ? "interview-expanded" : ["Traffic", "Technology lab"].includes(executionTab) ? "expanded" : ""}`}
          >
            <div className="execution-heading">
              <div>
                <span className={`live-indicator ${busy ? "busy" : ""}`} />
                <h2>Execution</h2>
                <span className="execution-status">
                  {busy ? "Running" : "Ready to explore"}
                </span>
              </div>
              <div className="playback">
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
              </div>
            </div>
            {executionTab !== "Interview" &&
              (hasClient ? (
                <div className="request-bar">
                  <span className="method">
                    GET <ChevronDown size={11} />
                  </span>
                  <input
                    aria-label="Request path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        message("send", { path, count: traffic });
                        setRequestId(null);
                      }
                    }}
                  />
                  <select
                    aria-label="Traffic volume"
                    value={traffic}
                    onChange={(e) => setTraffic(+e.target.value)}
                  >
                    <option value="1">Single request</option>
                    <option value="10">Burst · 10 requests</option>
                    <option value="50">Burst · 50 requests</option>
                  </select>
                  <button
                    className="send-button"
                    onClick={() => {
                      message("send", { path, count: traffic });
                      setRequestId(null);
                    }}
                  >
                    <Play size={13} fill="currentColor" /> Send request
                  </button>
                </div>
              ) : (
                <div className="message-bar">
                  <span>Send an event to connected streams and queues</span>
                  <button onClick={() => message("produce", { count: 1 })}>
                    Produce 1
                  </button>
                  <button onClick={() => message("produce", { count: 10 })}>
                    Produce 10
                  </button>
                  <button onClick={() => setSelection("producer")}>
                    Producer settings
                  </button>
                </div>
              ))}
            <div className="execution-tabs">
              {[
                "Requests",
                "Event log",
                "Response",
                "Traffic",
                "Technology lab",
                "Interview",
              ]
                .filter(
                  (t) =>
                    hasClient || t === "Technology lab" || t === "Interview",
                )
                .map((t) => (
                  <button
                    key={t}
                    className={executionTab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "Requests" && <span>{state.metrics.completed}</span>}
                    {t === "Traffic" && state.traffic.running && (
                      <span className="traffic-running-dot" />
                    )}
                  </button>
                ))}
              {hasClient && executionTab !== "Interview" && (
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
            <div className="execution-body">
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
                      setTab("Interview");
                    }}
                  />
                </Suspense>
              )}

              {executionTab === "Technology lab" && (
                <Suspense
                  fallback={
                    <p className="lab-empty">Loading technology lab…</p>
                  }
                >
                  <LabPanel
                    key={title}
                    config={config}
                    state={state}
                    nodes={nodes}
                    onMessage={message}
                    onSelect={setSelection}
                  />
                </Suspense>
              )}
              {executionTab === "Traffic" && (
                <TrafficPanel
                  state={state}
                  path={path}
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
                        <strong>A request is worth a thousand diagrams.</strong>
                        <p>
                          Send your first request to see your system in motion.
                        </p>
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
                              setTab("Event log");
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
                  n.id === selection ? { ...n, data: { ...n.data, name } } : n,
                ),
              )
            }
            onRemove={() => {
              setConfig((current) => {
                const backendOverrides = { ...current.backendOverrides };
                delete backendOverrides[selection];
                const resilienceOverrides = { ...current.resilienceOverrides },
                  connectionOverrides = { ...current.connectionOverrides };
                delete resilienceOverrides[selection];
                delete connectionOverrides[`${selection}-database`];
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
      <footer className="statusbar">
        <span>
          <span className="status-dot" /> All systems are simulated
        </span>
        <span>
          {nodes.length} components <i>·</i> {edges.length} connections
        </span>
        <span className="footer-right">
          A space to think in systems.
          <span className="footer-brand">liveboard</span>
        </span>
      </footer>
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
        aria-label="Getting started"
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
        <h2>Follow a request.</h2>
        <p>
          Send GET /users/1. The backend checks the cache, reads the database,
          and stores the result.
        </p>
        <ol>
          <li>Send the same request again to see a cache hit.</li>
          <li>Select the cache and expire its entries.</li>
          <li>Select the database and switch it offline.</li>
          <li>Send a request again to inspect the failure.</li>
        </ol>
        <p>
          Pause and step through each decision. Use New board to assemble the
          scenario yourself. Load a technology lab to configure Redis, Kafka,
          RabbitMQ, SQS, database reads, or an API gateway. Select a component
          to change its technology and controls. Produce events in streaming
          scenarios. Inspect offsets, messages, and decisions in Technology lab.
        </p>
        <button className="save-button" onClick={() => setHelp(false)}>
          Start exploring <ArrowRight size={14} />
        </button>
      </dialog>
    </div>
  );
}
export default App;
