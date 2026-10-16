import { useEffect, useState } from "react";
export default function useInterviewClock(minutes: number) {
  const [timer, setTimer] = useState({
    remaining: minutes * 60000,
    deadline: null as number | null,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (timer.deadline === null) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= timer.deadline!) clearInterval(interval);
    };
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [timer.deadline]);
  const remaining =
      timer.deadline === null
        ? timer.remaining
        : Math.max(0, timer.deadline - now),
    running = timer.deadline !== null && remaining > 0;
  return {
    remaining,
    running,
    toggle: () => {
      const time = Date.now();
      setNow(time);
      setTimer((current) =>
        current.deadline !== null && current.deadline > time
          ? { remaining: current.deadline - time, deadline: null }
          : {
              remaining: current.remaining,
              deadline: time + (current.remaining || minutes * 60000),
            },
      );
    },
    reset: (duration = minutes) => {
      setNow(Date.now());
      setTimer({ remaining: duration * 60000, deadline: null });
    },
  };
}
