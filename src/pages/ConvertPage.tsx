import { EmptyState, FileView, TitleBar, useConvert } from '@/features/convert';

export function ConvertPage({ dragging, onOpen }: { dragging: boolean; onOpen(): void }) {
  const hasFile = useConvert((s) => s.file !== null);
  return (
    <div className="flex h-full flex-col bg-paper">
      <TitleBar onOpen={onOpen} />
      {hasFile ? <FileView /> : <EmptyState dragging={dragging} onChoose={onOpen} />}
    </div>
  );
}
