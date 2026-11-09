import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type SettingsSection = 'instances' | 'workflows' | 'api';
export const SettingsLayout = createContext<{
  navigation: HTMLElement | null;
  section: SettingsSection;
  provider: 'ModelScope' | 'Agnes AI';
  showDetail: () => void;
}>({ navigation: null, section: 'instances', provider: 'ModelScope', showDetail: () => {} });
export function SettingsNavigation({ section, children }: { section: SettingsSection; children: ReactNode }) {
  const layout = useContext(SettingsLayout);
  return layout.navigation
    ? createPortal(
        <div className="settings-context-nav" hidden={layout.section !== section}>
          {children}
        </div>,
        layout.navigation,
      )
    : null;
}
