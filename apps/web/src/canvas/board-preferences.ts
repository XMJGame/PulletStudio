const key = (userId: string, projectId: string) => `pullet.board.last.${userId}.${projectId}`;

export function lastBoard(userId: string, projectId: string) {
  try {
    const id = localStorage.getItem(key(userId, projectId));
    return id && /^[a-f0-9-]{36}$/i.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
export function rememberBoard(userId: string, projectId: string, id: string) {
  try {
    localStorage.setItem(key(userId, projectId), id);
  } catch {
    /* Optional UI preference; access is checked by the API. */
  }
}
export function forgetBoard(userId: string, projectId: string) {
  try {
    localStorage.removeItem(key(userId, projectId));
  } catch {
    /* Optional preference. */
  }
}
