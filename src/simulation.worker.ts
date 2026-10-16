import { Engine, type Config } from "./engine";
let engine = new Engine();
let playing = true;
let speed = 1;
function publish() {
  postMessage(engine.state);
}
onmessage = (
  event: MessageEvent<{
    type: string;
    config?: Config;
    path?: string;
    count?: number;
    value?: number;
  }>,
) => {
  const message = event.data;
  switch (message.type) {
    case "configure":
      engine.configure(message.config!);
      break;
    case "send":
      engine.send(message.path!, message.count);
      break;
    case "play":
      playing = !!message.value;
      break;
    case "speed":
      speed = message.value!;
      break;
    case "step":
      engine.step();
      break;
    case "advance":
      engine.advance(message.value!);
      break;
    case "expire":
      engine.state.entries = [];
      break;
    case "reset": {
      const config = engine.config;
      engine = new Engine();
      engine.configure(config);
      break;
    }
  }
  publish();
};
setInterval(() => {
  if (playing) {
    engine.advance(50 * speed);
    publish();
  }
}, 50);
publish();
