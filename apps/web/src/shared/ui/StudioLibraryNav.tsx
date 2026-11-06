import { StudioButton } from './StudioUI';
import '../styles/studio-library.css';

export type LibraryPane = 'list' | 'detail';

export function StudioLibraryNav({
  pane,
  onChange,
  list,
  detail,
}: {
  pane: LibraryPane;
  onChange: (pane: LibraryPane) => void;
  list: string;
  detail: string;
}) {
  return (
    <nav className="v2-library-nav" aria-label="切换工作区面板">
      <StudioButton
        variant="ghost"
        icon="layers"
        aria-pressed={pane === 'list'}
        onClick={() => onChange('list')}
      >
        {list}
      </StudioButton>
      <StudioButton
        variant="ghost"
        icon="note"
        aria-pressed={pane === 'detail'}
        onClick={() => onChange('detail')}
      >
        {detail}
      </StudioButton>
    </nav>
  );
}
