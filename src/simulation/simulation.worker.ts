import { createSimulationHost } from "./simulationHost";

const host = createSimulationHost((message) => postMessage(message));
onmessage = (event: MessageEvent) => host.handle(event.data);
setInterval(() => host.tick(), 50);
host.publish();
