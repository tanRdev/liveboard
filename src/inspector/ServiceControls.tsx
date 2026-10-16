import type { Dispatch, SetStateAction } from "react";
import type { Config } from "../simulation/engine";
import { components } from "../simulation/engine";
import { serviceSettings, type ServiceSettings } from "../simulation/services";
import { Numeric, Option } from "../shared/ui/fields";
export default function ServiceControls({
  id,
  config,
  onConfig,
}: {
  id: string;
  config: Config;
  onConfig: Dispatch<SetStateAction<Config>>;
}) {
  const settings = serviceSettings(config, id);
  function update(patch: Partial<ServiceSettings>) {
    onConfig((current) => ({
      ...current,
      serviceOverrides: {
        ...current.serviceOverrides,
        [id]: { ...current.serviceOverrides[id], ...patch },
      },
    }));
  }
  const connections = new Set(config.links);
  const targets = components(config).filter(
    (part) => part.role === "backend" && connections.has(`${id}-${part.id}`),
  );
  return (
    <>
      <h3 className="inspector-subtitle">Service behavior</h3>
      <Option
        label="Request handler"
        value={settings.mode}
        choices={[
          ["data", "Read cache and database"],
          ["handler", "Call services and return a response"],
        ]}
        onChange={(mode) => update({ mode: mode as ServiceSettings["mode"] })}
      />
      {settings.mode === "handler" && (
        <>
          <Option
            label="Dependency calls"
            value={settings.calls}
            choices={[
              ["parallel", "Parallel · wait for all replies"],
              ["sequential", "Sequential · call in board order"],
            ]}
            onChange={(calls) =>
              update({ calls: calls as ServiceSettings["calls"] })
            }
          />
          <Numeric
            label="Dependency deadline (ms)"
            value={settings.dependencyTimeout}
            onChange={(dependencyTimeout) => update({ dependencyTimeout })}
          />
          <Option
            label="Publish after success"
            value={settings.publish}
            choices={[
              ["none", "No event"],
              ["queue", "Queue message"],
              ["stream", "Kafka event"],
            ]}
            onChange={(publish) =>
              update({ publish: publish as ServiceSettings["publish"] })
            }
          />
          <p className="inspector-help">
            {targets.length
              ? `Calls ${targets.map((part) => part.name).join(", ")}. Each service uses its own capacity and queue.`
              : "Connect this service to another backend to add a dependency. Without dependencies, it returns a local response."}
          </p>
          <p className="inspector-help">
            The caller keeps its capacity slot until all replies arrive. A
            failed dependency fails the request. Events publish only after
            success.
          </p>
        </>
      )}
    </>
  );
}
