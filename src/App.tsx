import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useUpdateNodeInternals,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  Download,
  Expand,
  FilePlus2,
  Globe,
  Layers,
  MousePointer2,
  Network,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { defaults, type Config, type Role, type Snapshot } from "./engine";
import "@xyflow/react/dist/style.css";
import "./styles.css";
const icons = { client: Globe, backend: Code2, cache: Zap, database: Database };
const catalog: {
  role: Role;
  name: string;
  description: string;
  category: string;
  tech: string;
}[] = [
  {
    role: "client",
    name: "Client",
    description: "Where every request begins",
    category: "APPLICATION",
    tech: "HTTP client",
  },
  {
    role: "backend",
    name: "Backend service",
    description: "Routes, logic & dependencies",
    category: "APPLICATION",
    tech: "Node.js",
  },
  {
    role: "cache",
    name: "Cache",
    description: "Fast access. Fewer reads.",
    category: "DATA & STORAGE",
    tech: "Key-value cache",
  },
  {
    role: "database",
    name: "Database",
    description: "A source of truth for your data",
    category: "DATA & STORAGE",
    tech: "Relational database",
  },
];
const positions = {
  client: { x: 40, y: 215 },
  backend: { x: 355, y: 215 },
  cache: { x: 705, y: 65 },
  database: { x: 705, y: 350 },
};
const seedNodes: Node[] = catalog.map((c) => ({
  id: c.role,
  type: "component",
  position: positions[c.role],
  data: { ...c },
}));
const seedEdges: Edge[] = defaults.links.map((id) => {
  const [source, target] = id.split("-");
  return {
    id,
    source,
    target,
    type: "traffic",
    label:
      target === "backend"
        ? "HTTP"
        : target === "cache"
          ? "GET / SET"
          : "QUERY",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  };
});
const empty: Snapshot = {
  now: 0,
  events: [],
  results: [],
  entries: [],
  reads: 0,
  hits: 0,
  misses: 0,
  queue: 0,
  active: false,
};
type Board = {
  version: 1;
  nodes: Node[];
  edges: Edge[];
  config: Config;
  title: string;
};
function restore(): Board | undefined {
  try {
    const b = JSON.parse(localStorage.getItem("liveboard-v1") || "null");
    if (
      b?.version === 1 &&
      Array.isArray(b.nodes) &&
      b.nodes.every(
        (n: Node) =>
          catalog.some((c) => c.role === n.id) &&
          Number.isFinite(n.position?.x) &&
          Number.isFinite(n.position?.y),
      ) &&
      Array.isArray(b.edges) &&
      b.config?.records &&
      b.config.ttl > 0 &&
      b.config.capacity > 0
    )
      return b;
  } catch {
    /* A damaged local document starts with the example board. */
  }
}
function ComponentNode({ id, data, selected }: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, updateNodeInternals]);
  const role = data.role as Role;
  const Icon = icons[role];
  const state = data.state as Snapshot;
  const config = data.config as Config;
  return (
    <div
      className={`component-node ${role} ${selected ? "selected" : ""} ${data.active ? "node-active" : ""}`}
    >
      {role !== "client" && <Handle type="target" position={Position.Left} />}
      <div className="node-heading">
        <span className={`node-icon ${role}`}>
          <Icon size={21} strokeWidth={1.7} />
        </span>
        <div>
          <strong>{String(data.name)}</strong>
          <span>{String(data.tech)}</span>
        </div>
        <span
          className={`status-dot ${role === "database" && !config.online ? "offline" : ""}`}
        />
      </div>
      <div className="node-content">
        {role === "client" && (
          <>
            <div className="node-code">
              <b>GET</b> /users/1
            </div>
            <div className="node-detail">
              <span>Requests sent</span>
              <strong>
                {state.events.filter((e) => e.text.endsWith(" sent")).length}
              </strong>
            </div>
          </>
        )}
        {role === "backend" && (
          <>
            <div className="node-code">
              <b>GET</b> {config.route}
            </div>
            <div className="node-detail">
              <span>
                <span className="tiny-dot" /> Cache-aside
              </span>
              <span>{state.queue ? `${state.queue} waiting` : "Ready"}</span>
            </div>
            {state.queue > 0 && (
              <div className="queue-bar">
                {Array.from({ length: Math.min(state.queue, 16) }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            )}
          </>
        )}
        {role === "cache" && (
          <>
            <div className="node-detail">
              <span>Entries</span>
              <strong>
                {state.entries.length} <em>/ {config.capacity}</em>
              </strong>
            </div>
            {state.entries.length ? (
              state.entries.slice(0, 2).map((e) => (
                <div className="cache-entry" key={e.key}>
                  <code>{e.key}</code>
                  <span>
                    <Clock3 size={10} />{" "}
                    {Math.max(0, Math.ceil((e.expires - state.now) / 1000))}s
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-cache">No entries yet</div>
            )}
            <div className="node-footer">
              <span>
                <i className="tiny-dot" /> {state.hits} hits
              </span>
              <span>{state.misses} misses</span>
              <span>{config.eviction}</span>
            </div>
          </>
        )}
        {role === "database" && (
          <>
            <div className="db-table">
              <span>▤ &nbsp; users</span>
              <span>{Object.keys(config.records).length} records</span>
            </div>
            <div className="node-detail">
              <span>Total reads</span>
              <strong>{state.reads}</strong>
            </div>
            <div className="node-footer">
              <span className={!config.online ? "error-text" : ""}>
                {config.online ? "● Available" : "● Offline"}
              </span>
              <span>{config.delay} ms / read</span>
            </div>
          </>
        )}
      </div>
      {["client", "backend"].includes(role) && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
function TrafficEdge(props: EdgeProps) {
  const [path, x, y] = getSmoothStepPath(props);
  const active = !!props.data?.active;
  const reverse = !!props.data?.reverse;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        markerEnd={reverse ? undefined : props.markerEnd}
        markerStart={reverse ? props.markerEnd : undefined}
      />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {active && (
        <circle
          className="traffic-packet"
          r="4"
          fill={reverse ? "#8a9fba" : "#56885d"}
          stroke="white"
          strokeWidth="1.5"
          style={{
            offsetPath: `path("${path}")`,
            animationDirection: reverse ? "reverse" : "normal",
            animationPlayState: props.data?.playing ? "running" : "paused",
          }}
        />
      )}
    </>
  );
}
const edgeTypes = { traffic: TrafficEdge };
const nodeTypes = { component: ComponentNode };
function App() {
  const [saved] = useState(restore);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    saved?.nodes || seedNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    saved?.edges || seedEdges,
  );
  const [config, setConfig] = useState<Config>(saved?.config || defaults);
  const [title, setTitle] = useState(saved?.title || "User profile API");
  const [state, setState] = useState<Snapshot>(empty);
  const [selection, setSelection] = useState<Role>("cache");
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
    w.onmessage = (e) => setState(e.data);
    return () => w.terminate();
  }, []);
  useEffect(() => {
    message("configure", {
      config: {
        ...config,
        roles: nodes.map((n) => n.id),
        links: edges.map((e) => `${e.source}-${e.target}`),
      },
    });
  }, [config, nodes, edges]);
  useEffect(() => {
    if (help) helpDialog.current?.showModal();
    else helpDialog.current?.close();
  }, [help]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const update = (patch: Partial<Config>) =>
    setConfig((c) => ({ ...c, ...patch }));
  const selectedCatalog = catalog.find((c) => c.role === selection)!;
  const SelectedIcon = icons[selection];
  const result =
    state.results.find((r) => r.id === requestId) || state.results[0];
  const events = state.events.filter(
    (e) =>
      e.request === (requestId || result?.id || state.events.at(-1)?.request),
  );
  const save = () => {
    const board: Board = {
      version: 1,
      nodes: nodes.map((n) => ({
        ...n,
        data: { ...n.data },
      })),
      edges,
      config,
      title,
    };
    try {
      localStorage.setItem("liveboard-v1", JSON.stringify(board));
      setToast("Board saved on this device");
    } catch {
      setToast("Storage is full. Export your board instead.");
    }
  };
  const add = (role: Role) => {
    if (nodes.some((n) => n.id === role)) {
      setSelection(role);
      setToast(
        `${(catalog.find((c) => c.role === role) || catalog[0]).name} selected on board`,
      );
      return;
    }
    const node = seedNodes.find((n) => n.id === role);
    if (!node) return;
    setNodes((ns) => [...ns, node]);
    setSelection(role);
  };
  const resetBoard = (example: boolean) => {
    setNodes(example ? seedNodes : []);
    setEdges(example ? seedEdges : []);
    setConfig(structuredClone(defaults));
    setRequestId(null);
    message("reset");
    setToast(
      example
        ? "Cache-aside example loaded"
        : "Empty board ready. Add components from the library.",
    );
  };
  const exportBoard = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              nodes: nodes.map((n) => ({
                ...n,
                data: { ...n.data },
              })),
              edges,
              config,
              title,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
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
      state,
      config,
      active: state.active && state.events.at(-1)?.component === n.id,
    },
  }));
  const renderedEdges: Edge[] = edges.map((e) => ({
    ...e,
    type: "traffic",
    data: { active: state.edge === e.id, reverse: state.reverse, playing },
    animated: state.edge === e.id,
    className: `${state.edge === e.id ? "edge-active" : ""} ${state.reverse ? "reverse" : ""}`,
    style: {
      stroke: state.edge === e.id ? "#2d8b67" : "#b6c1bc",
      strokeWidth: state.edge === e.id ? 2.5 : 1.5,
    },
  }));
  return (
    <div className={`app-shell ${playing ? "" : "simulation-paused"}`}>
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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="project-badge">Sandbox</span>
        </div>
        <div className="project-actions">
          <button className="plain-button" onClick={() => resetBoard(false)}>
            <FilePlus2 size={15} /> New board
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
            <span className="count">4</span>
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
          {["APPLICATION", "DATA & STORAGE"].map((category) => (
            <section className="catalog-section" key={category}>
              <h3>{category}</h3>
              {catalog
                .filter(
                  (c) =>
                    c.category === category &&
                    `${c.name} ${c.description}`
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
              Queues, load balancers, and more.
              <br />
              First, make the fundamentals click.
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
            <button onClick={() => resetBoard(true)}>
              Load cache-aside example <ArrowUpRight size={15} />
            </button>
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
                <span className="tiny-dot" /> CACHE-ASIDE PATTERN
              </span>
              <h1>Good systems start with a question.</h1>
              <p>What happens when the same request arrives twice?</p>
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
              onNodeClick={(_, node) => setSelection(node.id as Role)}
              onConnect={(c) => {
                if (
                  (c.source === "client" && c.target === "backend") ||
                  (c.source === "backend" &&
                    ["cache", "database"].includes(c.target))
                )
                  setEdges((es) =>
                    addEdge(
                      {
                        ...c,
                        id: `${c.source}-${c.target}`,
                        type: "traffic",
                        markerEnd: { type: MarkerType.ArrowClosed },
                      },
                      es,
                    ),
                  );
                else
                  setToast(
                    "Connect client to backend, then backend to cache or database.",
                  );
              }}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              minZoom={0.35}
              maxZoom={1.5}
              defaultEdgeOptions={{ type: "traffic" }}
            >
              <Background color="#d8ded9" gap={20} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) =>
                  ({
                    client: "#b3c2de",
                    backend: "#bdb5d6",
                    cache: "#98c9af",
                    database: "#dfc794",
                  })[n.id] || "#ccc"
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
                  onClick={() => resetBoard(true)}
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
          <section className="execution">
            <div className="execution-heading">
              <div>
                <span
                  className={`live-indicator ${state.active ? "busy" : ""}`}
                />
                <h2>Execution</h2>
                <span className="execution-status">
                  {state.active ? "Running" : "Ready to explore"}
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
            <div className="execution-tabs">
              {["Requests", "Event log", "Response"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                  {t === "Requests" && <span>{state.results.length}</span>}
                </button>
              ))}
              <span className="request-stats">
                {state.queue > 0 && <b>{state.queue} queued · </b>}
                {state.reads} database reads <span>·</span>{" "}
                {state.hits + state.misses
                  ? Math.round((state.hits / (state.hits + state.misses)) * 100)
                  : 0}
                % cache hit rate
              </span>
            </div>
            <div className="execution-body">
              {tab === "Requests" && (
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
                              {r.duration} ms <ChevronRight size={12} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {tab === "Event log" && (
                <div className="event-log">
                  {events.length > 0 && (
                    <div className="trace-summary">
                      <span>Request #{events[0].request}</span>
                      <code>GET {result?.path || path}</code>
                      <span>Request body: empty</span>
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
              {tab === "Response" && (
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
        <aside className="inspector">
          <div className="panel-heading">
            <h2>Inspector</h2>
            <SlidersHorizontal size={15} />
          </div>
          <div className="inspector-component">
            <span className={`catalog-icon ${selection}`}>
              <SelectedIcon size={22} />
            </span>
            <div>
              <strong>{selectedCatalog.name}</strong>
              <span>Component configuration</span>
            </div>
            <button
              className="icon-button"
              title="Remove component"
              onClick={() => {
                setNodes((ns) => ns.filter((n) => n.id !== selection));
                setEdges((es) =>
                  es.filter(
                    (e) => e.source !== selection && e.target !== selection,
                  ),
                );
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="inspector-tabs">
            <button
              className="active"
              onClick={() =>
                document
                  .querySelector(".inspector-scroll")
                  ?.scrollTo({ top: 0, behavior: "smooth" })
              }
            >
              <Settings2 size={13} /> Configure
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("live-state")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              <Activity size={13} /> Live state
            </button>
          </div>
          <div className="inspector-scroll">
            <label className="field-label" htmlFor="component-name">
              NAME
            </label>
            <input
              className="field"
              id="component-name"
              aria-label="Component name"
              value={String(
                nodes.find((n) => n.id === selection)?.data.name ||
                  selectedCatalog.name,
              )}
              onChange={(e) =>
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === selection
                      ? { ...n, data: { ...n.data, name: e.target.value } }
                      : n,
                  ),
                )
              }
            />
            <div className="field-label">
              TECHNOLOGY <span className="subtle-badge">Preset</span>
            </div>
            <div id="technology" className="technology-field">
              <SelectedIcon size={15} />
              {selectedCatalog.tech}
              <Check size={13} />
            </div>
            <p className="field-help">
              {selection === "cache"
                ? "In-memory key-value storage with expiry and eviction."
                : selection === "database"
                  ? "Seeded records with key lookup and modeled read delay."
                  : selection === "backend"
                    ? "HTTP routes with cache-aside dependency calls."
                    : "Sends HTTP requests and receives responses."}
            </p>
            <div className="section-divider" />
            <h3 className="inspector-subtitle">
              {selection === "cache"
                ? "Cache behavior"
                : selection === "backend"
                  ? "Request behavior"
                  : selection === "database"
                    ? "Database behavior"
                    : "Client behavior"}
            </h3>
            {selection === "cache" && (
              <>
                <label className="field-label" htmlFor="cache-ttl">
                  TIME TO LIVE <CircleHelp size={12} />
                </label>
                <div className="unit-field">
                  <input
                    id="cache-ttl"
                    aria-label="Cache time to live"
                    type="number"
                    min="1"
                    max="3600"
                    value={config.ttl}
                    onChange={(e) =>
                      update({ ttl: Math.max(1, +e.target.value) })
                    }
                  />
                  <span>seconds</span>
                </div>
                <p className="field-help">
                  How long an entry stays in the cache.
                </p>
                <label className="field-label" htmlFor="cache-capacity">
                  CAPACITY
                </label>
                <div className="unit-field">
                  <input
                    id="cache-capacity"
                    aria-label="Cache capacity"
                    type="number"
                    min="1"
                    max="1000"
                    value={config.capacity}
                    onChange={(e) =>
                      update({ capacity: Math.max(1, +e.target.value) })
                    }
                  />
                  <span>entries</span>
                </div>
                <label className="field-label" htmlFor="eviction">
                  EVICTION POLICY
                </label>
                <select
                  className="field"
                  id="eviction"
                  aria-label="Eviction policy"
                  value={config.eviction}
                  onChange={(e) =>
                    update({ eviction: e.target.value as Config["eviction"] })
                  }
                >
                  <option value="LRU">Least recently used (LRU)</option>
                  <option value="FIFO">First in, first out (FIFO)</option>
                </select>
                <p className="field-help">
                  When full, remove the{" "}
                  {config.eviction === "LRU"
                    ? "least recently accessed"
                    : "oldest stored"}{" "}
                  entry.
                </p>
                <div className="field-label">CACHE KEY</div>
                <div id="cache-key" className="code-field">
                  user:<span>{"{id}"}</span>
                </div>
              </>
            )}
            {selection === "backend" && (
              <>
                <label className="field-label" htmlFor="route">
                  GET ROUTE
                </label>
                <input
                  className="field"
                  id="route"
                  aria-label="Backend route"
                  value={config.route}
                  onChange={(e) => update({ route: e.target.value })}
                />
                <label className="field-label" htmlFor="timeout">
                  DEPENDENCY TIMEOUT
                </label>
                <div className="unit-field">
                  <input
                    id="timeout"
                    aria-label="Backend timeout"
                    type="number"
                    min="1"
                    value={config.timeout}
                    onChange={(e) =>
                      update({ timeout: Math.max(1, +e.target.value) })
                    }
                  />
                  <span>ms</span>
                </div>
                <div className="info-note">
                  <Zap size={15} />
                  <p>
                    Check the cache first. On a miss, read the database and
                    store the result.
                  </p>
                </div>
                <p className="field-help">
                  One active request. Additional requests wait in the visible
                  queue.
                </p>
              </>
            )}
            {selection === "database" && (
              <>
                <label className="field-label" htmlFor="availability">
                  AVAILABILITY
                </label>
                <button
                  id="availability"
                  className={`availability ${config.online ? "" : "disabled"}`}
                  onClick={() => update({ online: !config.online })}
                >
                  <span className="status-dot" />
                  {config.online ? "Database online" : "Database offline"}
                  <span className="toggle">
                    <i />
                  </span>
                </button>
                <label className="field-label" htmlFor="read-delay">
                  READ DELAY
                </label>
                <div className="unit-field">
                  <input
                    id="read-delay"
                    aria-label="Database read delay"
                    type="number"
                    min="1"
                    value={config.delay}
                    onChange={(e) =>
                      update({ delay: Math.max(1, +e.target.value) })
                    }
                  />
                  <span>ms</span>
                </div>
                <div className="field-label">SEED RECORDS · USERS</div>
                {Object.values(config.records).map((record) => (
                  <div className="record" key={record.id}>
                    <span className="record-avatar">{record.name[0]}</span>
                    <div>
                      <strong>{record.name}</strong>
                      <small>id: {record.id}</small>
                    </div>
                  </div>
                ))}
                <button
                  className="secondary-button"
                  onClick={() => {
                    const id = String(
                      Math.max(0, ...Object.keys(config.records).map(Number)) +
                        1,
                    );
                    update({
                      records: {
                        ...config.records,
                        [id]: {
                          id,
                          name: `User ${id}`,
                          email: `user${id}@example.com`,
                        },
                      },
                    });
                  }}
                >
                  <Plus size={13} /> Add seed record
                </button>
              </>
            )}
            {selection === "client" && (
              <>
                <label className="field-label" htmlFor="client-path">
                  REQUEST PATH
                </label>
                <input
                  className="field"
                  id="client-path"
                  aria-label="Client request path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <div className="info-note">
                  <Globe size={16} />
                  <p>
                    Send a request from the execution panel. Select a completed
                    request to inspect each decision.
                  </p>
                </div>
              </>
            )}
            <div className="section-divider" />
            <div id="live-state" className="state-heading">
              <h3 className="inspector-subtitle">Live state</h3>
              <span>
                <span className="tiny-dot" /> LIVE
              </span>
            </div>
            {selection === "cache" ? (
              <>
                <div className="state-metrics">
                  <div>
                    <span>Entries</span>
                    <b>
                      {state.entries.length}
                      <small> / {config.capacity}</small>
                    </b>
                  </div>
                  <div>
                    <span>Hit rate</span>
                    <b>
                      {state.hits + state.misses
                        ? Math.round(
                            (state.hits / (state.hits + state.misses)) * 100,
                          )
                        : 0}
                      <small>%</small>
                    </b>
                  </div>
                </div>
                <div className="cache-state">
                  {state.entries.length ? (
                    state.entries.map((e) => (
                      <div key={e.key}>
                        <code>{e.key}</code>
                        <span>
                          {Math.max(
                            0,
                            Math.ceil((e.expires - state.now) / 1000),
                          )}
                          s
                        </span>
                      </div>
                    ))
                  ) : (
                    <>
                      <Database size={20} />
                      <span>Your cache is empty.</span>
                      <small>Send a request to fill it.</small>
                    </>
                  )}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => {
                    message("expire");
                    setToast("All cache entries expired");
                  }}
                >
                  <Clock3 size={13} /> Expire all entries
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    message("advance", { value: (config.ttl + 1) * 1000 })
                  }
                >
                  Advance simulated time by {config.ttl + 1}s{" "}
                  <ArrowRight size={12} />
                </button>
              </>
            ) : (
              <div className="state-metrics">
                <div>
                  <span>
                    {selection === "database" ? "Reads" : "Completed"}
                  </span>
                  <b>
                    {selection === "database"
                      ? state.reads
                      : state.results.length}
                  </b>
                </div>
                <div>
                  <span>
                    {selection === "database" ? "Records" : "Waiting"}
                  </span>
                  <b>
                    {selection === "database"
                      ? Object.keys(config.records).length
                      : state.queue}
                  </b>
                </div>
              </div>
            )}
          </div>
          <div className="inspector-foot">
            <Check size={13} /> Changes apply to the next decision
          </div>
        </aside>
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
          scenario yourself.
        </p>
        <button className="save-button" onClick={() => setHelp(false)}>
          Start exploring <ArrowRight size={14} />
        </button>
      </dialog>
    </div>
  );
}
export default App;
