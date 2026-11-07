import { useState } from 'react';
import { Dialog } from './Dialog';
import { PublicLibraryPanel, type PublicLibraryFilters } from '../canvas/PublicLibraryPanel';
import './workspace-library.css';
export default function WorkspaceLibraryDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<PublicLibraryFilters>({ folderId: '', query: '', mediaType: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="工作区公共库"
      description={`${workspaceName} · 媒体与创作资产`}
      className="v2-public-library-dialog"
      busy={busy}
      onClose={onClose}
    >
      <div className="v2-public-library-body">
        <PublicLibraryPanel
          key={workspaceId}
          workspaceId={workspaceId}
          editable={false}
          filters={filters}
          onFiltersChange={setFilters}
          onBusyChange={setBusy}
          onImported={() => {}}
        />
      </div>
    </Dialog>
  );
}
