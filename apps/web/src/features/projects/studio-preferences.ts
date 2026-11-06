export function readStudioTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem('pullet.canvas.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function saveStudioTheme(theme: 'light' | 'dark') {
  try {
    localStorage.setItem('pullet.canvas.theme', theme);
  } catch {
    /* Optional browser preference. */
  }
}
const recentKey = (userId: string, workspaceId: string) => `pullet.studio.recent.${userId}.${workspaceId}`;
export function readRecentProjects(userId: string, workspaceId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userId, workspaceId)) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
export function rememberProject(userId: string, workspaceId: string, id: string): string[] {
  const ids = [id, ...readRecentProjects(userId, workspaceId).filter((value) => value !== id)].slice(0, 12);
  try {
    localStorage.setItem(recentKey(userId, workspaceId), JSON.stringify(ids));
  } catch {
    /* Optional browser preference. */
  }
  return ids;
}
