// A pull-to-refresh (or any other trigger) asks every mounted data hook to reload.
export const REFRESH_EVENT = 'valuehub:refresh'
export const requestRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT))
