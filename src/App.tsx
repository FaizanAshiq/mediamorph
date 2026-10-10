import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkTool,
  createEngine,
  ConvertContext,
  createConvertStore,
  createTauriSpawner,
  findTools,
  guardQuit,
  onDragAndDrop,
  pickVideo,
  probeMachine,
  SetupScreen,
  tauriComfort,
  tauriFiles,
  type Machine,
  type Tools,
} from '@/features/convert';
import { runTestPlan } from '@/e2e';
import { ConvertPage } from '@/pages/ConvertPage';

/** What this ffmpeg can do. If asking fails, assume the least: no fast mode, no text burn-in. */
const BARE_MACHINE: Machine = { filters: new Set(), encoders: new Set() };

export default function App() {
  const [tools, setTools] = useState<Tools | null | 'checking'>('checking');
  const [machine, setMachine] = useState<Machine>(BARE_MACHINE);
  const [dragging, setDragging] = useState(false);

  const check = useCallback(() => {
    setTools('checking');
    void findTools(checkTool).then(async (found) => {
      if (found) setMachine(await probeMachine(createTauriSpawner(found)).catch(() => BARE_MACHINE));
      setTools(found);
    });
  }, []);
  useEffect(() => check(), [check]);

  const store = useMemo(() => {
    if (!tools || tools === 'checking') return null;
    const spawner = createTauriSpawner(tools);
    return createConvertStore(createEngine({ spawner, files: tauriFiles }), { machine, comfort: tauriComfort });
  }, [tools, machine]);

  useEffect(() => {
    if (tools !== 'checking') void runTestPlan(tools, store);
  }, [tools, store]);

  useEffect(() => {
    if (!store) return;
    const offDrop = onDragAndDrop({
      hover: setDragging,
      drop: (paths) => {
        setDragging(false);
        void store.getState().open(paths);
      },
    });
    const offQuit = guardQuit(
      () => store.getState().running,
      () => store.getState().stop(),
    );
    return () => {
      void offDrop.then((off) => off());
      void offQuit.then((off) => off());
    };
  }, [store]);

  if (tools === 'checking') return null;
  if (!store) {
    return (
      <div className="flex h-full flex-col">
        <div data-tauri-drag-region className="h-[52px] shrink-0 bg-chrome" />
        <SetupScreen onCheckAgain={check} />
      </div>
    );
  }

  const openFile = () => void pickVideo().then((paths) => store.getState().open(paths));
  return (
    <ConvertContext.Provider value={store}>
      <ConvertPage dragging={dragging} onOpen={openFile} />
    </ConvertContext.Provider>
  );
}
