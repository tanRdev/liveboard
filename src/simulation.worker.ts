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
    running?: boolean;
    command?: string;
    groupId?: string;
    record?: { id: string; name: string; email: string };
  }>,
) => {
  const message = event.data;
  switch (message.type) {
    case "produce":
      engine.produce(message.count);
      break;
    case "cacheCommand":
      engine.cacheCommand(message.command ?? "");
      break;
    case "commit":
      engine.kafka.now = engine.state.now;
      engine.kafka.commit(message.groupId ?? "");
      break;
    case "replay":
      engine.kafka.replay(message.groupId ?? "", engine.state.now);
      break;
    case "ack":
      engine.queueLab.ackAll(engine.state.now);
      break;
    case "redrive":
      engine.queueLab.redrive(engine.state.now);
      break;
    case "dbWrite":
      if (message.record)
        engine.database.write(
          message.record,
          engine.state.now,
          engine.config.online,
        );
      break;
    case "dbRead":
      if (engine.config.online)
        engine.database.read(message.path ?? "1", engine.state.now);
      else engine.database.state.reply = "Read failed · database offline";
      break;
    case "configure":
      engine.configure(message.config!);
      break;
    case "traffic":
      engine.setTraffic(message.value!, message.path!, !!message.running);
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
  engine.syncLabs();
  publish();
};
setInterval(() => {
  if (playing) {
    engine.advance(50 * speed);
    publish();
  }
}, 50);
publish();
