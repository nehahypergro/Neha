// Who is editing. There are no accounts yet, so the name lives in this browser and travels with every change record.
export const getUserName = () => { try { return localStorage.getItem('hg:user') || ''; } catch { return ''; } };
export const setUserName = (n) => { try { localStorage.setItem('hg:user', String(n || '').trim().slice(0, 60)); } catch {} };
