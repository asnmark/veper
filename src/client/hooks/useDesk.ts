import { useCallback, useEffect, useState } from "react";
import type { DeskStatus, StoryRecord } from "../../shared/types.js";
import { getDesk, refreshFeeds, setStorySaved } from "../api.js";

export function useDesk() {
  const [desk, setDesk] = useState<DeskStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await getDesk();
      setDesk(next);
      setLoadError(null);
      setLoading(false);
    } catch {
      setLoadError("Redakcijske mize trenutno ni mogoče doseči.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const events = new EventSource("/api/events");
    const onUpdate = () => { void reload(); };
    events.addEventListener("desk-updated", onUpdate);
    const fallback = window.setInterval(() => { void reload(); }, 90_000);
    return () => {
      events.removeEventListener("desk-updated", onUpdate);
      events.close();
      window.clearInterval(fallback);
    };
  }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await refreshFeeds();
      const suffix = result.failedSourceCount > 0 ? ` · ${result.failedSourceCount} virov ni dosegljivih` : "";
      setNotice(`${result.sourceCount} virov uspešno osveženih${suffix}.`);
      await reload();
    } catch {
      setNotice("Osvežitev ni uspela; prikazani podatki ostajajo shranjeni.");
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const saveStory = useCallback(async (story: StoryRecord) => {
    const saved = !story.saved;
    setDesk((current) => current && ({
      ...current,
      stories: current.stories.map((entry) => entry.id === story.id ? { ...entry, saved } : entry),
    }));
    try {
      await setStorySaved(story.id, saved);
    } catch {
      setNotice("Izbrane zgodbe ni bilo mogoče shraniti.");
      await reload();
    }
  }, [reload]);

  return { desk, loading, loadError, refreshing, notice, refresh, saveStory };
}
