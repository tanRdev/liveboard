"use client";

import dynamic from "next/dynamic";

const Board = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="workspace-loading" role="status">
      Opening Liveboard…
    </div>
  ),
});

export default function BoardWorkspace() {
  return <Board />;
}
