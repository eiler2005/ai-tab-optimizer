import { useEffect } from 'react';
import { useTopics } from './topic-store';

export function useTopicAdvicePolling() {
  useEffect(() => {
    let pending = false; let lastPoll = 0; let disposed = false;
    const poll = async () => {
      if (disposed || pending || useTopics.getState().pairJob?.status !== 'running' && Date.now() - lastPoll < 10_000) return;
      lastPoll = Date.now(); pending = true;
      try { await useTopics.getState().loadPairReview(); } catch { /* The server may be offline; local topic organization remains available. */ }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 750);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
}
