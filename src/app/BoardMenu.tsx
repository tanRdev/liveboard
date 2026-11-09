import { useEffect, useRef, useState } from "react";
import {
  Network,
  ChevronDown,
  FilePlus2,
  Upload,
  Download,
  CheckCheck,
  CircleHelp,
  Link2,
} from "lucide-react";
type Props = {
  title: string;
  saveStatus: string;
  saveError: string;
  onTitle: (title: string) => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onSave: () => void;
  onShare: () => void;
  onHelp: () => void;
};
export default function BoardMenu(props: Props) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        root.current
          ?.querySelector<HTMLButtonElement>(".board-menu-trigger")
          ?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const action = (run: () => void) => {
    setOpen(false);
    run();
  };
  return (
    <header ref={root} className="board-identity">
      <button
        className="board-menu-trigger"
        aria-label="Board menu"
        aria-expanded={open}
        aria-controls="board-menu"
        onClick={() => setOpen((value) => !value)}
        title="Board menu"
      >
        <Network size={20} />
        <ChevronDown size={11} />
      </button>
      <input
        aria-label="Board name"
        maxLength={80}
        value={props.title}
        onChange={(event) => props.onTitle(event.target.value)}
      />
      <span
        className={`local-save-status ${props.saveError ? "save-failed" : ""}`}
        role="status"
        title={props.saveError || "Changes save in this browser"}
      >
        {props.saveStatus}
      </span>
      {open && (
        <div
          id="board-menu"
          className="board-menu-popover"
          role="dialog"
          aria-label="Board actions"
        >
          <strong>
            liveboard <small>Local workspace</small>
          </strong>
          <button onClick={() => action(props.onNew)}>
            <FilePlus2 size={15} />
            New board
          </button>
          <button onClick={() => action(props.onImport)}>
            <Upload size={15} />
            Open board or exercise…
          </button>
          <button onClick={() => action(props.onExport)}>
            <Download size={15} />
            Download board
          </button>
          <button onClick={() => action(props.onSave)}>
            <CheckCheck size={15} />
            Save on this device
          </button>
          <button onClick={() => action(props.onShare)}>
            <Link2 size={15} />
            Copy share link
          </button>
          <hr />
          <button onClick={() => action(props.onHelp)}>
            <CircleHelp size={15} />
            Help and shortcuts
          </button>
        </div>
      )}
    </header>
  );
}
