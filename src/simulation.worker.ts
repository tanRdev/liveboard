import { ChallengeRunner, type ChallengeDefinition } from "./challenges";
import type { Board } from "./board";
import { ExperimentRunner, type ExperimentSpec } from "./experiments";
import { Engine, type Config } from "./engine";
let engine = new Engine();
let playing = true;
let speed = 1;
let experiment: { id: string; runner: ExperimentRunner } | undefined;
function pumpExperiment() {
  const current = experiment;
  if (!current) return;
  try {
    for (let i = 0; i < 30 && !current.runner.finished; i++)
      current.runner.tick();
    if (experiment !== current) return;
    if (current.runner.finished) {
      postMessage({
        type: "experimentComplete",
        id: current.id,
        report: current.runner.report,
      });
      experiment = undefined;
    } else {
      postMessage({
        type: "experimentProgress",
        id: current.id,
        progress: current.runner.progress(),
      });
      setTimeout(pumpExperiment, 0);
    }
  } catch (error) {
    postMessage({
      type: "experimentError",
      id: current.id,
      error: error instanceof Error ? error.message : "Experiment failed",
    });
    experiment = undefined;
  }
}
let challenge: { id: string; runner: ChallengeRunner } | undefined;
function pumpChallenge() {
  const current = challenge;
  if (!current) return;
  try {
    for (let i = 0; i < 30 && !current.runner.finished; i++)
      current.runner.tick();
    if (challenge !== current) return;
    if (current.runner.finished) {
      postMessage({
        type: "challengeComplete",
        id: current.id,
        report: current.runner.report,
      });
      challenge = undefined;
    } else {
      postMessage({
        type: "challengeProgress",
        id: current.id,
        progress: current.runner.progress(),
      });
      setTimeout(pumpChallenge, 0);
    }
  } catch (error) {
    postMessage({
      type: "challengeError",
      id: current.id,
      error:
        error instanceof Error
          ? error.message
          : "Challenge verification failed",
    });
    challenge = undefined;
  }
}
function publish() {
  postMessage({ type: "snapshot", state: engine.state });
}
onmessage = (
  event: MessageEvent<{
    type: string;
    spec?: ExperimentSpec;
    definition?: ChallengeDefinition;
    board?: Board;
    id?: string;
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
    case "challenge":
      try {
        challenge = {
          id: message.id!,
          runner: new ChallengeRunner(message.definition!, message.board!),
        };
        setTimeout(pumpChallenge, 0);
      } catch (error) {
        postMessage({
          type: "challengeError",
          id: message.id,
          error: error instanceof Error ? error.message : "Invalid challenge",
        });
      }
      return;
    case "cancelChallenge":
      challenge = undefined;
      return;
    case "experiment":
      try {
        experiment = {
          id: message.id!,
          runner: new ExperimentRunner(message.config!, message.spec!),
        };
        setTimeout(pumpExperiment, 0);
      } catch (error) {
        postMessage({
          type: "experimentError",
          id: message.id,
          error: error instanceof Error ? error.message : "Experiment failed",
        });
      }
      return;
    case "cancelExperiment":
      experiment = undefined;
      return;
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
